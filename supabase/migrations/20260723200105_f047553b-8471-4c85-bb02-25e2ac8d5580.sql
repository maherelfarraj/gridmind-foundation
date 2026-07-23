
-- Internal helper (avoids recursion in user_roles policies)
create or replace function public.is_company_admin(_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.company_id = _company_id
      and ur.role = 'company_admin'::public.app_role
  );
$$;

revoke execute on function public.is_company_admin(uuid) from public;
revoke execute on function public.is_company_admin(uuid) from anon;
grant execute on function public.is_company_admin(uuid) to authenticated;
grant execute on function public.is_company_admin(uuid) to service_role;

-- GRANTs: auth-only tenancy tables
revoke all on public.companies  from anon;
revoke all on public.profiles   from anon;
revoke all on public.user_roles from anon;

grant select, insert, update, delete on public.companies  to authenticated;
grant select, insert, update, delete on public.profiles   to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;

grant all on public.companies  to service_role;
grant all on public.profiles   to service_role;
grant all on public.user_roles to service_role;

-- Enable RLS
alter table public.companies  enable row level security;
alter table public.profiles   enable row level security;
alter table public.user_roles enable row level security;

-- ============================================================
-- companies
-- ============================================================
drop policy if exists "companies_select_members"    on public.companies;
drop policy if exists "companies_update_admin"      on public.companies;
drop policy if exists "companies_insert_super"      on public.companies;
drop policy if exists "companies_delete_super"      on public.companies;

create policy "companies_select_members"
  on public.companies
  for select
  to authenticated
  using (public.is_company_member(id));

create policy "companies_update_admin"
  on public.companies
  for update
  to authenticated
  using (
    public.is_company_member(id)
    and public.has_company_role('company_admin'::public.app_role)
  )
  with check (
    public.is_company_member(id)
    and public.has_company_role('company_admin'::public.app_role)
  );

create policy "companies_insert_super"
  on public.companies
  for insert
  to authenticated
  with check (public.has_role(auth.uid(), 'super_admin'::public.app_role));

create policy "companies_delete_super"
  on public.companies
  for delete
  to authenticated
  using (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- ============================================================
-- profiles
-- ============================================================
drop policy if exists "profiles_select_members"     on public.profiles;
drop policy if exists "profiles_insert_self_or_super" on public.profiles;
drop policy if exists "profiles_update_self"        on public.profiles;
drop policy if exists "profiles_update_admin"       on public.profiles;

create policy "profiles_select_members"
  on public.profiles
  for select
  to authenticated
  using (public.is_company_member(company_id));

create policy "profiles_insert_self_or_super"
  on public.profiles
  for insert
  to authenticated
  with check (
    id = auth.uid()
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

create policy "profiles_update_self"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_company_role('company_admin'::public.app_role)
  )
  with check (
    public.is_company_member(company_id)
    and public.has_company_role('company_admin'::public.app_role)
  );

-- ============================================================
-- user_roles  (uses is_company_admin to avoid recursion)
-- ============================================================
drop policy if exists "user_roles_select_members"  on public.user_roles;
drop policy if exists "user_roles_insert_admin"    on public.user_roles;
drop policy if exists "user_roles_update_admin"    on public.user_roles;
drop policy if exists "user_roles_delete_admin"    on public.user_roles;

create policy "user_roles_select_members"
  on public.user_roles
  for select
  to authenticated
  using (public.is_company_member(company_id));

create policy "user_roles_insert_admin"
  on public.user_roles
  for insert
  to authenticated
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

create policy "user_roles_update_admin"
  on public.user_roles
  for update
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

create policy "user_roles_delete_admin"
  on public.user_roles
  for delete
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );
