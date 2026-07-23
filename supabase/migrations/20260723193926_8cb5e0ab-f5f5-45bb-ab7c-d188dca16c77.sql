-- 1. Extension
create extension if not exists pgcrypto;

-- 2. Drop legacy profiles shape
drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table    if exists public.profiles;

-- 3. app_role enum (guarded)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'platform_admin','company_owner','company_admin',
      'project_manager','project_engineer','site_engineer',
      'procurement_manager','finance_manager','accountant',
      'safety_officer','quality_manager','commissioning_engineer',
      'om_manager','om_technician','field_technician',
      'partner_contractor','sales_manager','crm_user',
      'viewer','guest'
    );
  end if;
end $$;

-- 4. companies
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  plan_tier   text not null default 'starter'
              check (plan_tier in ('starter','growth','enterprise')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 5. profiles
create table if not exists public.profiles (
  id          uuid primary key
              references auth.users(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete restrict,
  full_name   text,
  email       text,
  locale      text not null default 'en',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 6. user_roles
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  unique (user_id, company_id, role)
);

-- 7. Lookup indexes
create index if not exists idx_profiles_company_id
  on public.profiles (company_id);
create index if not exists idx_user_roles_user_company
  on public.user_roles (user_id, company_id);