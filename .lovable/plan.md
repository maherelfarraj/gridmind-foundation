## P-024 — Company Admin: users & roles

Extends existing `/settings/users` (P-022) with role management. Keep the Invite dialog, invites list, and lockout warning as-is.

### Server (new `src/lib/roles.functions.ts`)

All fns: `createServerFn` + `attachSupabaseAuth` + `requireSupabaseAuth`, zod-validated, audit-logged via `write_audit_log` RPC.

- `listCompanyMembers({ companyId })` — replaces the members portion of `getCompanyAdminSnapshot`. Selects `profiles(id, full_name, email, avatar_url)` for `company_id = :companyId` (RLS-scoped), then `user_roles(user_id, role)` for those ids. Returns `Array<{ userId, fullName, email, avatarUrl, roles: AppRole[] }>` plus `{ adminCount, isAdmin }`. Keep `getCompanyAdminSnapshot` too (still used by invite pre-flight); this fn is the richer read.
- `grantRole({ companyId, targetUserId, role })`:
  1. Reject `role === 'super_admin'` in the validator.
  2. `supabase.rpc('assert_can_grant_role', { p_target_user_id, p_company_id, p_role })` — the DB is the source of truth; throw if it errors.
  3. `insert into user_roles ... on conflict do nothing` via `.upsert({ user_id, company_id, role }, { onConflict: 'user_id,company_id,role', ignoreDuplicates: true })`.
  4. `write_audit_log('role.granted', 'user_roles', <inserted id or target user id>, { target_user, role, company_id })`.
- `revokeRole({ companyId, targetUserId, role })`:
  1. Reject `role === 'super_admin'`.
  2. Same `assert_can_grant_role` RPC first (defense in depth — DB blocks non-admin callers).
  3. Last-admin guard: if `role === 'company_admin'`, count `user_roles where company_id=:c and role='company_admin'`; if count ≤ 1 AND that row belongs to `targetUserId`, throw `{ statusCode: 409, message: 'Cannot revoke the last company admin.' }`.
  4. `delete from user_roles where user_id=:t and company_id=:c and role=:r`.
  5. Audit `role.revoked` with same metadata shape.

### Route grouping & constants (`src/lib/role-groups.ts`)

Static grouping used by the sheet (super_admin excluded):

```text
Administration:   company_admin, billing_admin, project_admin
Department:       engineering_admin, procurement_admin, construction_admin,
                  hse_admin, finance_admin, legal_admin, om_admin, scada_admin
Operational:      engineer, sales, procurement_officer, foreman, field_technician
External viewers: client_viewer, investor_viewer, lender_viewer
```

Total: 19. Compile-time assertion that the flattened list equals `Constants.public.Enums.app_role` minus `super_admin` so future enum additions fail typecheck until grouped.

### UI changes to `src/routes/_authenticated/settings.users.tsx`

- Swap the members table read to `listCompanyMembers`; add `avatar_url` avatar cell.
- Add a search input (client-side filter on name + email).
- Add "Export CSV" button — generates `members.csv` (name, email, roles joined by `|`) via a Blob + `URL.createObjectURL`.
- Skeleton rows during load; existing empty/error states retained.
- Row action button "Manage roles" opens a shadcn `Sheet` for the selected member showing 4 grouped sections of `Switch` toggles (labels humanized). Toggling:
  - Optimistically update the row's `roles` array in the React Query cache (`setQueryData` on `['company-members', companyId]`).
  - Call `grantRole` / `revokeRole`; on error, rollback the cache snapshot and `toast.error(err.message)`; on success `toast.success`.
  - Disable the toggle while its mutation is pending.
- Access: page still visible to any signed-in member (matches existing gate). "Manage roles" button only rendered when `snapshot.isAdmin` OR viewer has `super_admin`; server RPCs remain the authoritative check.

### Cross-company negative check (verification only, no code change)

After the UI ships, from demo-admin's session (Demo EPC), call `grantRole` targeting a Test Co B user id → expect the `assert_can_grant_role` RPC to raise `forbidden: cross-company role grant blocked`; confirm no `user_roles` row created and no audit written.

### Live checklist (run after implementation)

1. `/settings/users` shows members table with Demo Admin's `super_admin` + `company_admin` badges and the second invited user.
2. Manage roles sheet renders exactly 19 roles across 4 groups, `finance_admin` in Department admins.
3. Grant `engineer` to user 2 → badge appears → `role.granted` in `audit_logs` with correct metadata; revoke → `role.revoked` logged.
4. Attempt to revoke your own `company_admin` while `adminCount === 1` → toast "Cannot revoke the last company admin"; no DB change, no audit row.
5. Search filters both name and email; CSV downloads; skeleton/empty/error states visible.
6. Cross-company grant attempt from Demo session against Test Co B user → RPC rejects with `forbidden: cross-company role grant blocked`.

### Files touched

- New: `src/lib/roles.functions.ts`, `src/lib/role-groups.ts`
- Edited: `src/routes/_authenticated/settings.users.tsx`
- No migration; existing `assert_can_grant_role`, `write_audit_log`, and `user_roles` RLS already in place.
