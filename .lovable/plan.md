## P-022 reconciliation — spec vs. what shipped

Previous turn shipped `/settings/invites` + `/accept-invite`. This spec locks the route to `/settings/users`, adds admin-count business rules, and requires the accept page to enroll brand-new users inline (set password or Google) rather than punting to `/signup`. Reusing `create_invite` / `redeem_invite` RPCs is already in place.

### Changes

**1. Rename & re-scope the admin page**
- Move `src/routes/_authenticated/settings.invites.tsx` → `src/routes/_authenticated/settings.users.tsx` (URL `/settings/users`).
- Sidebar entry: rename "Team invites" → "Users", link `/settings/users`. Keep it visible to everyone in nav; the page itself gates actions server-side.
- Page shows two sections: (a) current members table (from `user_roles` joined to `profiles` scoped to active company), (b) invites table (existing).
- Empty state when zero invites.

**2. Admin gate + count rules (server-enforced, mirrored in UI)**
- New server fn `getCompanyAdminSnapshot({ companyId })` (createServerFn + requireSupabaseAuth): returns `{ isAdmin, adminCount, members }` computed via a single query against `user_roles`; `isAdmin` = current user has `company_admin` or `super_admin` in that company.
- `createInvite` handler adds a pre-flight check: if `adminCount === 0` and requested role !== `company_admin`, throw an error `first_admin_required` — "The first company admin must be bootstrapped by a super admin. Invite a company_admin first." (`create_invite` RPC already enforces the "only admins can invite" branch; this extra rule prevents the chicken-and-egg case with an actionable message.)
- UI: hide "Invite member" button unless `isAdmin`. When `adminCount === 1`, render amber banner using semantic tokens (`bg-warning/10 text-warning-foreground border-warning/30` — add tokens if missing, or use `bg-accent` fallback that already exists) with copy: "We recommend at least 2 company admins to avoid lockout."
- Role `<Select>` continues to filter out `super_admin`.

**3. Accept-invite: inline enrollment for new users**
- Keep `src/routes/accept-invite.tsx` route path.
- Replace the "sign in / create account redirect" branch with an inline flow that first peeks the invite (public, unauthenticated peek):
  - Add `peekInviteAnonymous({ token })` server fn (no auth middleware) that uses the service-role admin client to read only `email`, `role`, `company_id → name`, `status`, `expires_at` by `token_hash`. Returns the same discriminated union but without the "wrong_account" branch (no session yet).
  - Existing authenticated `peekInvite` stays for the signed-in path.
- Signed-out UI states from the peek:
  - `invalid` / `revoked` / `expired` → branded error card, same as today. Expired copy: "Ask your admin to resend."
  - `valid` → show invited email (read-only) and two tabs:
    - **Set password** (react-hook-form + zod, min 8 + number, matches signup schema) → `supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/accept-invite?token=${token}` } })`. If the project has auto-confirm on (it does per prior turn), the session is live immediately and we call `redeemInviteRpc` in the same handler, then navigate to `/dashboard`. If auto-confirm is off, show a "check your inbox" state; the email link brings them back and the signed-in branch redeems.
    - **Continue with Google** → `lovable.auth.signInWithOAuth("google", { redirect_uri: `${origin}/accept-invite?token=${token}` })`. On return, signed-in branch handles redemption.
- Signed-in branch is unchanged: peek → confirm → `redeemInviteRpc` → navigate `/dashboard`. Wrong-account branch remains (sign-out CTA). Re-using an accepted token surfaces the DB error verbatim as toast ("invite is not pending (status=accepted)").

**4. Client bearer attacher requirement**
- `peekInviteAnonymous` is unauthenticated but the `attachSupabaseAuth` middleware still needs to run without throwing — it already writes `user: null` on no session, so this is fine. No changes to `src/start.ts`.

**5. Cleanup**
- Delete the interim `settings.invites.tsx` (replaced by `settings.users.tsx`); no route alias — nothing links to `/settings/invites` yet outside our own sidebar.
- Update the unit test file only if imports move.

### Technical notes

- `create_invite` / `redeem_invite` already: (a) enforce `is_company_admin` on creation, (b) hash the token, (c) enforce 7-day expiry (`expires_at` default in migration 0006), (d) write `invite.created` / `invite.accepted` to `audit_logs` via `write_audit_log`. We call them via RPC and add zero SQL in this batch.
- `getCompanyAdminSnapshot` reads through the authenticated per-request client — `user_roles` RLS already lets company members read their own company's roles, so no policy changes.
- Amber warning: if `warning` token isn't in the design system, use existing `bg-accent text-accent-foreground border-accent` with an `AlertTriangle` icon rather than adding raw colors.
- Anonymous peek uses `supabaseAdmin` (already dynamically imported to keep the server-only module out of the client bundle) and projects only safe columns (`email`, `role`, `status`, `expires_at`, `company_id` + `companies.name`). No PII beyond the invitee's own email is returned.
- The `/accept-invite` path already strips `?token=` from error logs (P-022 shipped this).

### Verification (live as demo-admin)

- `/settings/users` renders the members list + invites table, with "Invite member" button visible.
- Role `<Select>` omits `super_admin`.
- With exactly 1 company_admin, amber banner shows.
- Sending an invite creates `invite.created` in `audit_logs` and a `pending` row.
- Accept link with a bad token → invalid card; expired → resend copy; valid new-user path → set password → session established → `/dashboard`; valid signed-in path → one-click join.
- Re-using an accepted token surfaces the "not pending" error.
- `invite.accepted` in audit log and a new `user_roles` row after acceptance.
- `bun run test:unit` still green (existing tests unaffected).