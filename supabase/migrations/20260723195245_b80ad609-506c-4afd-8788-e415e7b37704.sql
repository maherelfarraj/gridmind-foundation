-- Reset (all tables empty; safe drop to fix wrong enum values)
drop table if exists public.user_roles;
drop table if exists public.profiles cascade;
drop table if exists public.companies cascade;
drop type  if exists public.app_role;

-- Extension
create extension if not exists pgcrypto;

-- app_role enum (correct 20 values, exact order)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'super_admin','company_admin','billing_admin','project_admin',
      'engineering_admin','procurement_admin','construction_admin',
      'hse_admin','finance_admin','legal_admin','om_admin','scada_admin',
      'engineer','sales','procurement_officer','foreman','field_technician',
      'client_viewer','investor_viewer','lender_viewer'
    );
  end if;
end $$;

-- companies
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  plan_tier   text not null default 'starter'
              check (plan_tier in ('starter','growth','enterprise')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- profiles (id = auth.users.id)
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

-- user_roles (user_id -> profiles.id)
create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  unique (user_id, company_id, role)
);

-- Lookup indexes
create index if not exists idx_profiles_company_id
  on public.profiles (company_id);
create index if not exists idx_user_roles_user_company
  on public.user_roles (user_id, company_id);