## P-011 — Migration 0003: Tenancy RLS + GRANTs

Create `supabase/migrations/0003_tenancy_rls.sql` (idempotent) that locks down `companies`, `profiles`, `user_roles`.

### 1. Internal helper (avoid user_roles recursion)

```sql
create or replace function public.is_company_admin(_company_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.company_id = _company_id
      and ur.role = 'company_admin'::public.app_role
  );
$$;
revoke execute on function public.is_company_admin(uuid) from public, anon;
grant execute on function public.is_company_admin(uuid) to authenticated, service_role;
```

### 2. GRANTs (before enabling RLS)

```sql
revoke all on public.companies, public.profiles, public.user_roles from anon;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update, delete on public.profiles  to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.companies, public.profiles, public.user_roles to service_role;
```

No `anon` grants — tenancy is auth-only.

### 3. Enable RLS + drop-if-exists policies (idempotent)

```sql
alter table public.companies  enable row level security;
alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;
```

### 4. Policy matrix

**companies**
- SELECT: `is_company_member(id)`
- UPDATE: `has_company_role('company_admin')` (using + check both scoped to `id`)
- INSERT: `has_role(auth.uid(), 'super_admin')`
- DELETE: `has_role(auth.uid(), 'super_admin')`

**profiles**
- SELECT: `is_company_member(company_id)`
- INSERT: `id = auth.uid()` OR `has_role(auth.uid(), 'super_admin')`
- UPDATE (self): `id = auth.uid()` with check `id = auth.uid() and company_id = (select company_id from profiles where id = auth.uid())` (prevent company jump)
- UPDATE (admin): `has_company_role('company_admin') and is_company_member(company_id)`

**user_roles** (uses `is_company_admin`, never selects from `user_roles`)
- SELECT: `is_company_member(company_id)`
- INSERT: `is_company_admin(company_id)` OR `has_role(auth.uid(), 'super_admin')`
- UPDATE: same as INSERT
- DELETE: same as INSERT

All policies wrapped in `drop policy if exists ... ; create policy ...` for idempotency, scoped `to authenticated`.

### 5. Deliverable

Single migration file applied via `supabase--migration`. No code changes elsewhere. Linter warnings for the three tables should clear; the four SECURITY DEFINER helper warnings from P-010 remain (intentional).
