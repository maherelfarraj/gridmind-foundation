create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum (
    'super_admin','company_admin','billing_admin','project_admin',
    'engineering_admin','procurement_admin','construction_admin',
    'hse_admin','finance_admin','legal_admin','om_admin','scada_admin',
    'engineer','sales','procurement_officer','foreman','field_technician',
    'client_viewer','investor_viewer','lender_viewer'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_tier text not null default 'starter'
    check (plan_tier in ('starter','growth','enterprise')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  full_name text,
  email text,
  locale text not null default 'en',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_company_id_idx on public.profiles(company_id);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, company_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles(user_id);
create index if not exists user_roles_company_id_idx on public.user_roles(company_id);

-- Helper needed by RLS policies
-- (will be replaced by canonical definition in migration 0002)
create or replace function public.has_role(p_user_id uuid, p_role public.app_role)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = p_role
  );
$$;

revoke all on function public.has_role(uuid, public.app_role) from anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- Required grants
revoke all on public.companies, public.profiles, public.user_roles from anon;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.companies, public.profiles, public.user_roles to service_role;

-- Enable RLS
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- RLS policies

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_company_member(id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies for update to authenticated
  using (public.is_company_admin(id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies for insert to authenticated
  with check (public.has_role(auth.uid(),'super_admin'));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies for delete to authenticated
  using (public.has_role(auth.uid(),'super_admin'));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_company_member(company_id) or id = auth.uid() or public.has_role(auth.uid(),'super_admin'));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.has_role(auth.uid(),'super_admin'));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (id = auth.uid() or public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles for update to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));