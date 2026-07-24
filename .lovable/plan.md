
# P-022 — Invite flow UI + accept-invite route

Puts the 0006 SQL surface (`public.create_invite`, `public.redeem_invite`, `invites` table + RLS) to work with two user-facing flows: **admins send/manage invites** and **recipients accept** them. All DB access goes through protected `createServerFn` RPCs using the P-021 `attachSupabaseAuth` middleware — no service-role key on this path.

## Server functions (`src/lib/invites.functions.ts`)

All use `.middleware([attachSupabaseAuth])` + `requireSupabaseAuth`, zod-validated. RLS + SECURITY DEFINER functions do the authorization work; the RPC layer only forwards.

- `listInvites({ companyId })` — SELECT from `invites` (RLS filters to admin/super_admin of that company). Returns id, email, role, status, expires_at, created_at, invited_by.
- `createInvite({ companyId, email, role })` — calls `rpc('create_invite', …)`. Returns `{ token, acceptUrl }` where `acceptUrl = ${origin}/accept-invite?token=<hex>`. Token is shown **once** in the UI (copy button + toast) — never persisted client-side, never logged. Origin comes from the request URL captured server-side.
- `revokeInvite({ inviteId })` — `UPDATE invites SET status='revoked'` (RLS gate). Only allowed when current status is `pending`.
- `resendInvite({ inviteId })` — revoke existing pending row, then call `create_invite` again with same email/role/company; returns fresh `{ token, acceptUrl }`.
- `redeemInviteRpc({ token })` — calls `rpc('redeem_invite', …)`; returns `{ companyId }`.
- `peekInvite({ token })` — client-side lookup of pending invite by hashing token and matching against `invites` visible under `invites_self_select` (email == JWT email). Returns `{ companyName, role, email, expiresAt }` or `{ status: 'invalid' | 'expired' | 'wrong_account' }` for the preview screen. No token hashing on the client — done server-side.

Token is never sent back after creation via list endpoints; only the freshly-created plaintext is returned to the admin who just issued it.

## Admin UI — `src/routes/_authenticated/settings.invites.tsx`

Lives under the existing `_authenticated` layout (no separate `(app)` group exists yet; matches current file layout).

- Header: "Team invites" + "New invite" button.
- Table (shadcn `Table`): Email · Role · Status badge · Expires · Invited by · Actions (Copy link if just-created, Resend, Revoke).
- "New invite" dialog: react-hook-form + zod (`email` citext, `role` = app_role enum minus `super_admin` unless caller is super_admin). On success, replace the dialog body with a read-only "Invite link" panel showing the accept URL, a Copy button, and an "I've shared it" close. Sonner toasts for success/errors.
- Data via TanStack Query: `queryOptions(['invites', companyId], listInvites)` — loader `ensureQueryData` + `useSuspenseQuery` per `tanstack-query-integration`. Mutations `invalidateQueries(['invites', companyId])`.
- CompanyId comes from the existing company-switcher localStorage value (P-007). If none is selected, redirect to `/dashboard` with a toast.
- Sidebar (`src/components/app-sidebar.tsx`): add "Team invites" link under Settings, visible only when `has_company_role(currentCompany, 'company_admin' | 'super_admin')` — role check via `getCurrentUserRoles` (P-021) rather than a new RPC.
- Route `head()`: unique title/description ("Team invites — GridMind EPC").

## Public accept-invite route — `src/routes/accept-invite.tsx`

Top-level route (NOT under `_authenticated` — the recipient may not have a session yet, and never has a company binding until redemption succeeds).

Flow:

1. Read `?token=` via `Route.useSearch()` (zod-validated: 64 hex chars).
2. If no Supabase session → render "Sign in to accept your invitation" card with two buttons: **Sign in** → `/login?redirect=/accept-invite?token=…`, **Create account** → `/signup?redirect=/accept-invite?token=…&email=<from peek if available>`. Update `(auth)/route.tsx` guard + login/signup submit handlers to honor a `redirect` search param (currently they hardcode `/`).
3. If session exists → `useSuspenseQuery(peekInvite)`:
   - `invalid` → branded "This invitation link is not valid." with link to `/`.
   - `expired` → "This invitation has expired. Ask your administrator to resend it."
   - `wrong_account` → "This invitation was sent to <email>. Sign out and sign in with that account." + Sign-out button.
   - valid pending → show "You've been invited to join **{companyName}** as **{role}**." + "Accept invitation" button.
4. On accept → `redeemInviteRpc({ token })` → toast success → `router.navigate({ to: '/dashboard' })` + `queryClient.invalidateQueries()` for roles/company-related keys.
5. `head()`: title "Accept invitation — GridMind EPC", `robots: noindex`.
6. `errorComponent` + `notFoundComponent` per `tanstack-errors-notfound`.

## Auth route tweaks

- `src/routes/(auth)/route.tsx`: keep session-exists redirect, but honor `search.redirect` (whitelist: must start with `/` and not `//`).
- `src/routes/(auth)/login.tsx` and `signup.tsx`: after successful sign-in / email confirmation, navigate to `search.redirect ?? '/'`. Google OAuth `redirectTo` becomes `${origin}/accept-invite?token=…` when the redirect param points there — otherwise unchanged.

## Tests (`tests/unit/invites.functions.test.ts`)

Mock `attachSupabaseAuth` context + `supabase.rpc`:
- `createInvite` unauthenticated → 401 JSON (from `requireSupabaseAuth`).
- `createInvite` authenticated → forwards args to `rpc('create_invite')`, returns `{ token, acceptUrl }` shape.
- `redeemInviteRpc` propagates DB errors (invalid token, wrong account, expired) as thrown errors with useful messages.
- `peekInvite` maps DB `not found` / expired / email-mismatch to the four documented statuses.

Full-suite `tests/api/invites.api.test.ts` skeleton (marked `.skip` unless `INTEGRATION=1`) — real Supabase round-trip is optional and gated.

## Technical notes

- No new migrations; 0006 already ships `create_invite` (citext, app_role) and `redeem_invite(text)`, plus `invites_self_select` letting recipients read their own pending row by JWT email — that's what powers `peekInvite`.
- `email` column is `citext`; the RPCs accept `text` via Supabase's coerce, but we still `.toLowerCase().trim()` in zod before sending.
- Never render the raw token in URLs we log; server-side `error-capture` already strips query strings for `/accept-invite` — add that route to its allowlist so the full URL (with token) never reaches structured logs.
- Sidebar visibility gate reuses `getCurrentUserRoles` (P-021). No new SECURITY DEFINER helpers.
- No changes to `src/integrations/supabase/*` auto-generated files.

## Files touched

Created:
- `src/lib/invites.functions.ts`
- `src/routes/_authenticated/settings.invites.tsx`
- `src/routes/accept-invite.tsx`
- `tests/unit/invites.functions.test.ts`
- `tests/api/invites.api.test.ts` (skipped by default)

Modified:
- `src/routes/(auth)/route.tsx`, `login.tsx`, `signup.tsx` — honor `redirect` search param.
- `src/components/app-sidebar.tsx` — add "Team invites" link, admin-gated.
- `src/lib/error-capture.ts` — strip `?token=…` when path is `/accept-invite`.

## Acceptance checks

- [ ] Admin creates invite → gets a one-time link; list refreshes with `pending` row.
- [ ] Non-admin cannot see or create invites (RLS + sidebar hidden).
- [ ] Recipient signed out at `/accept-invite?token=…` → prompted to sign in / sign up with redirect preserved.
- [ ] Recipient signed in with matching email → sees company + role, accepts, lands on `/dashboard` with role granted.
- [ ] Wrong-account, expired, revoked, and invalid tokens each render distinct, branded messages — never the raw error page.
- [ ] Token never appears in server logs or the client console.
- [ ] `bun run test:unit` still green (P-021 tests + new invites tests).
