## Plan — Fix 0001 enum, then P-010 (0002 RLS helpers)

Migration 0001 was applied with the wrong `app_role` enum values. Since all three tables (`companies`, `profiles`, `user_roles`) are empty, we drop and recreate cleanly, then land the RLS helpers.

### Step 1 — Rewrite `supabase/migrations/0001_tenancy_core.sql`

Same file, same structure (pgcrypto, companies with slug, profiles with `id = auth.users(id)` + `company_id NOT NULL`, user_roles with `unique(user_id, company_id, role)`, two lookup indexes, no GRANT, no RLS). Only the enum body changes to the correct 20 values in this exact order:

```
super_admin, company_admin, billing_admin, project_admin,
engineering_admin, procurement_admin, construction_admin,
hse_admin, finance_admin, legal_admin, om_admin, scada_admin,
engineer, sales, procurement_officer, foreman, field_technician,
client_viewer, investor_viewer, lender_viewer
```

Prepend a reset block (safe: tables are empty):

```sql
drop table if exists public.user_roles;
drop table if exists public.profiles cascade;
drop table if exists public.companies cascade;
drop type  if exists public.app_role;
```

Apply via `supabase--migration`. Then verify with `supabase--read_query`:

```sql
select enumlabel from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'app_role'
order by e.enumsortorder;
```

Paste the result back for your check. Only proceed to Step 2 once the list matches exactly.

### Step 2 — Create `supabase/migrations/0002_rls_helpers.sql`

Four helpers, all `security definer set search_path = public`. Read helpers `stable`; the assert function `plpgsql`, returns `void`.

**`has_role(user_id uuid, role app_role) returns boolean`** — stable sql. `exists (select 1 from public.user_roles ur where ur.user_id = has_role.user_id and ur.role = has_role.role)`.

**`has_company_role(role app_role) returns boolean`** — stable sql. Resolves the caller's company from `auth.jwt() -> 'app_metadata' ->> 'company_id'`, falling back to `(select company_id from public.profiles where id = auth.uid())`. Returns true iff a matching `user_roles` row exists for `(auth.uid(), resolved_company_id, role)`.

**`is_company_member(company_id uuid) returns boolean`** — stable sql. True iff `auth.uid()` has any `user_roles` row for that `company_id`, OR their `profiles.company_id` equals it.

**`assert_can_grant_role(target_user_id uuid, company_id uuid, role app_role) returns void`** — plpgsql. Validation only, no insert:
- Raise `exception` if `target_user_id`'s `profiles.company_id` differs from the passed `company_id` (block cross-company grants).
- Raise `exception` if `role = 'super_admin'` and the caller (`auth.uid()`) does not already have `super_admin` via `has_role`.

**Privileges:** `revoke execute ... from public, anon;` `grant execute ... to authenticated, service_role;` for all four.

Apply via `supabase--migration`.

### Not in scope

- No GRANTs / no RLS on tables (that's migration 0003).
- No changes to app code — `src/integrations/supabase/types.ts` regenerates after each migration; the stale enum in `src/lib/permissions.ts` is a Batch 03 concern, not P-010.

Reply "go" to run Step 1.
