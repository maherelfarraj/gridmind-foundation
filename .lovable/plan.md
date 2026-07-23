## P-019 — Create module gating and audit retention tables

Prerequisite for P-020. Two tables are missing from `public` after the tenancy rebuild and need to be recreated with RLS, grants, and the audit helper function.

### Tables to create

1. `public.module_access_rules`
   - `id uuid primary key default gen_random_uuid()`
   - `company_id uuid not null references public.companies(id) on delete cascade`
   - `module text not null`
   - `enabled boolean not null default true`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()`
   - unique `(company_id, module)`
   - index on `company_id`

2. `public.audit_log_retention_policies`
   - `id uuid primary key default gen_random_uuid()`
   - `company_id uuid not null references public.companies(id) on delete cascade`
   - `entity text not null`
   - `retention_days int not null default 2555 check (retention_days >= 90)`
   - `created_at timestamptz not null default now()`
   - `updated_at timestamptz not null default now()`
   - unique `(company_id, entity)`

### Functions / triggers

- Recreate `public.write_audit_log(action, entity, entity_id, metadata)` as a `SECURITY DEFINER` function that reads the caller's company from `public.profiles`, inserts into `public.audit_logs`, and returns the new row id.
- Add `update_updated_at_column` trigger to both new tables (function already exists).

### Grants and RLS

- Revoke all from `anon` on both tables.
- Grant `authenticated`: `SELECT/INSERT/UPDATE/DELETE` on `module_access_rules`; `SELECT/INSERT/UPDATE/DELETE` on `audit_log_retention_policies`.
- Grant `ALL` on both tables to `service_role`.
- Enable RLS on both tables.
- Policies on `module_access_rules`: select for company members/super admins; write for company admins/super admins.
- Policies on `audit_log_retention_policies`: select for company members/super admins; write for company admins/super admins.
- Revoke anon `EXECUTE` on `write_audit_log`; grant `EXECUTE` to `authenticated` and `service_role`.

## P-020 — Create idempotent demo seed script

Create `supabase/seed.sql` containing the idempotent statements provided in the request. The script will be applied with the Supabase insert tool (data operation) after P-019 is green.

### Seed contents (in order)

1. **Demo company**: upsert `Demo EPC Co`, slug `demo`, plan_tier `enterprise`.
2. **Currencies**: upsert the six currencies (`USD`, `EUR`, `MAD`, `JOD`, `AED`, `CNY`) with symbols and minor units.
3. **Module gating**: insert one explicit `module_access_rules` row per module key for the demo company, all `enabled = true`.
4. **Audit retention**: insert `audit_log_retention_policies` rows for `financial` (2555 days) and `default` (400 days) for the demo company.
5. **Demo admin**: anonymous PL/pgSQL block that finds `auth.users` by `demo-admin@gridmindepc.com`, upserts their `profiles` row into the demo company, and grants `company_admin` and `super_admin` roles. No direct `auth.users` insert; idempotent via `on conflict`.

### Verification

After P-020 is applied:
- `select * from public.companies where slug = 'demo'` returns one enterprise row.
- `select count(*) from public.currencies` returns 6.
- `select count(*) from public.module_access_rules where company_id = (select id from companies where slug='demo')` returns 9.
- `select count(*) from public.audit_log_retention_policies where company_id = (select id from companies where slug='demo')` returns 2.
- After signing up `demo-admin@gridmindepc.com` in the app and re-running the seed, `select role from public.user_roles where user_id = (select id from auth.users where email='demo-admin@gridmindepc.com')` returns `company_admin` and `super_admin`.