## P-025 — Bulk invite + invite status tracking

Extends `/settings/users` (P-022, P-024). Server enforcement uses existing `create_invite` SECURITY DEFINER + `requireSupabaseAuth`; UI gates rendering by `snapshot.isAdmin`. No migration.

### New: `bulkCreateInvites` in `src/lib/invites.functions.ts`

Signature (createServerFn POST, `attachSupabaseAuth`, `requireSupabaseAuth`):

```ts
input: {
  companyId: uuid,
  rows: Array<{ email: string /* lowercased, trimmed */, role: app_role }> // 1..100
}
```

Zod schema rejects `super_admin`, invalid emails, and >100 rows. Handler:

1. Verify caller is company admin: `supabase.rpc('is_company_admin', { _company_id })`; throw 403 otherwise (defense in depth on top of `create_invite`'s own gate).
2. Deduplicate rows client-side already; server also dedupes on lowercased email + role (keep first occurrence).
3. Read current `user_roles` count where `role = 'company_admin'` for the company. If `adminCount === 0`, filter to rows with `role === 'company_admin'` and record the rest as `skipped:'no_admin_yet'`.
4. Pull existing pending invites for the company (`select email` where `status = 'pending'`) and current member emails (`profiles` in-company) to precompute per-row skip reasons: `already_member`, `already_pending`.
5. For each surviving row, call `supabase.rpc('create_invite', { p_company_id, p_email, p_role })` sequentially. On per-row error, record `{ email, role, error: msg }` and continue — don't fail the whole batch.
6. After the loop, write ONE audit via `write_audit_log('invite.bulk_sent', 'invites', null, { count: successes.length, roles: unique(successes.role) })`.
7. Return `{ created: Array<{ email, role, acceptUrl }>, skipped: Array<{ email, role, reason }>, failed: Array<{ email, role, error }> }`. `acceptUrl` derived same way as single invite.

### UI: split `/settings/users` into two tabs

Replace the current sequential Members / Invitations sections with a shadcn `Tabs` (`Members` default, `Invitations`). Keep the existing header, admin-only "Invite member" button, and lockout warning. Add a second admin-only button next to it: **"Bulk invite"**.

#### Bulk invite dialog (`src/components/bulk-invite-dialog.tsx`)

- Textarea, monospace, placeholder shows `email,role` example. Optional header row `email,role` is skipped case-insensitively.
- "Preview" button parses rows client-side (comma or tab separator, trim, lowercase email, lowercase role). For each row compute status:
  - `invalid_email` (zod email fails)
  - `unknown_role` — not in `app_role`; suggest closest via Levenshtein against `GRANTABLE_ROLES` (from `role-groups.ts`); show suggestion as an inline "Use X?" button that patches the row.
  - `super_admin_forbidden` — role is `super_admin`.
  - `duplicate_in_paste` — repeated (email,role) later in list.
  - `already_member` — email matches any member from the current `listCompanyMembers` cache.
  - `already_pending` — email matches any pending invite from the current `listInvites` cache.
  - `ok` otherwise.
- Preview table columns: Email, Role (editable Select), Status badge, Note. Rows with non-`ok` status are excluded from send; user can edit inline (email input, role select) which re-runs validation for that row. Row 1 remains editable so the user can fix and re-preview without repasting.
- Footer summary: "N of M rows will be invited." Disabled Send when zero.
- Send: calls `bulkCreateInvites` with the `ok` rows (max 100 enforced). Shows loading spinner. On success replaces dialog body with a results panel: successes list (with individual copy link + "Copy all links" button), skipped list grouped by reason, failed list. Sonner toast summarizes counts. Invalidates `invites` + `company-members` queries. Keeps dialog open until user dismisses.

Rate-limit UX: if `bulkCreateInvites` throws (e.g., DB rate-limit), toast the message, keep the preview intact so user can retry.

#### Invitations tab

Rebuild the existing invites table into a `data-table`-style block within the tab:

- Toolbar: search input (filters `email`, case-insensitive), status `Select` (`All`, `Pending`, `Accepted`, `Expired`, `Revoked`), refresh icon.
- Derived status: any row where `status === 'pending'` and `new Date(expires_at) < now` renders as `expired` and gates actions accordingly (server `revoke_invite` still targets `status = 'pending'`; derivation is display-only).
- Columns: Email, Role (badge via `humanizeRole`), Status (badge, variant per status), Invited by (fetch names via `listCompanyMembers` cache — fall back to short user id), Sent (from `created_at`), Expires. Skeleton rows (3) while `invitesQuery.isLoading`; empty state "No invites sent yet" with a hint to click Invite/Bulk when admin.
- Row actions column (admin only): `Resend` and `Revoke`. Enabled only when derived status is `pending` or `expired`. Behavior:
  - Resend uses existing `resendInvite` (already: revokes prior + creates new invite with new token/expiry via `create_invite`). Add an extra `write_audit_log('invite.resent', ...)` server-side (see server tweaks). Shows the new link in the existing single-invite issued-link dialog.
  - Revoke: existing `revokeInvite`; server-side add `write_audit_log('invite.revoked', 'invites', inviteId, { email, role, company_id })`.

Members tab remains exactly as P-024 (avatars, search, CSV, manage-roles sheet).

### Small server tweaks (`invites.functions.ts`)

- `resendInvite`: after `create_invite` succeeds, call `write_audit_log('invite.resent','invites', <old inviteId>, { email, role, company_id })`.
- `revokeInvite`: read the invite row first to capture `{ email, role, company_id }`, then update, then `write_audit_log('invite.revoked','invites', inviteId, meta)`.
- No changes to `create_invite` (already audits `invite.created`); the bulk audit is a single additional `invite.bulk_sent` summary row.
- `listInvites`: add `email` search index-friendly ordering already present; add nothing new — filtering is client-side.

### Files touched

- New: `src/components/bulk-invite-dialog.tsx`
- Edited: `src/lib/invites.functions.ts` (add `bulkCreateInvites`, add audit calls in resend/revoke), `src/routes/_authenticated/settings.users.tsx` (Tabs shell, Bulk invite trigger, invitations toolbar/filter/derived-expired, invited-by name join)
- Reused: `src/lib/role-groups.ts` for role labels + fuzzy suggestions; `src/components/ui/tabs`, `select`, `dialog`, `textarea`, `table`, `badge`, `skeleton`

### Verification checklist (run after implementation)

1. Bulk paste with the four sample rows → preview flags rows 2, 3, 4 with the exact reasons; only row 1 is send-eligible.
2. Send with only `good1@test.com` → results panel shows 1 created (with copy link); `invite.bulk_sent` audit exists with `count=1, roles=['engineer']`.
3. Manually POST a bulk request containing `super_admin` (bypassing client) → server 400 from zod, no rows inserted, no audit.
4. Invitations tab: pending invite appears with 7-day expiry; Resend produces a new token + new expiry, `invite.resent` audit row logged; Revoke sets status revoked, `invite.revoked` audit row logged.
5. Accept-invite page loaded with a revoked link → existing branded revoked state (peekInviteAnonymous already returns `{ status: 'revoked' }`).
6. Status filter + email search operate on the invitations table without refetching.
