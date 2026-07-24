## Corrective migration for `public.invites`

Fixes the schema gap found in the audit and installs the admin management policy per the original 0006 spec. Also adopts the new standing verification rule.

### Migration SQL

```sql
-- 1. Add missing role column (table is empty, safe to NOT NULL immediately)
alter table public.invites add column if not exists role public.app_role;
alter table public.invites alter column role set not null;

-- 2. Replace admin policy: full management (needed for revoke = UPDATE status)
drop policy if exists invites_admin_all on public.invites;
create policy invites_admin_all on public.invites
  for all to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

-- 3. Leave invites_self_select untouched
```

`accepted_by` column is kept as-is (harmless).

### Post-migration verification (shown unprompted)

Run and display:
- Column list of `public.invites` (name, type, nullable, default) via `information_schema.columns`
- Full policy list of `public.invites` via `pg_policies` (name, cmd, roles, using, with check)

### New standing rule (adopted)

After every migration, I will show the columns and RLS policies of every affected table, unprompted — no more "table exists" as sole verification.

### P-022 live checklist (after migration is green)

1. Sign in preview as `demo-admin@gridmindepc.com`.
2. Navigate to `/settings/users`, open Invite dialog, invite a second email (you provide) with role `project_manager` (or your choice, excluding super_admin).
3. Verify: row appears in `public.invites` with correct role/company/status=pending, and `audit_logs` has `invite.created` entry.
4. Open the accept link in a fresh session, complete enrollment, redeem.
5. Verify: `invites.status='accepted'`, `user_roles` row created, `audit_logs` has `invite.accepted`.
6. Report results; if green → `next → P-023`.

### What I need from you

- Approve this plan so I can apply the migration.
- The second email address to use for the live invite test.
