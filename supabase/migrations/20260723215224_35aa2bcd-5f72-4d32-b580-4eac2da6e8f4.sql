
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  plan_tier text not null default 'starter',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  full_name text,
  avatar_url text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, company_id, role)
);

create index if not exists user_roles_user_idx on public.user_roles(user_id);
create index if not exists user_roles_company_idx on public.user_roles(company_id);
create index if not exists profiles_company_idx on public.profiles(company_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Update helper (keep existing parameter name _company_id to preserve dependent policies)
create or replace function public.is_company_admin(_company_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.company_id = _company_id
      and ur.role in ('company_admin','super_admin')
  );
$$;

revoke all on function public.is_company_admin(uuid) from anon;
grant execute on function public.is_company_admin(uuid) to authenticated, service_role;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

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
  using (public.is_company_member(company_id) or id = auth.uid()
         or public.has_role(auth.uid(),'super_admin'));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() or public.has_role(auth.uid(),'super_admin'));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_company_admin(company_id)
         or public.has_role(auth.uid(),'super_admin'))
  with check (id = auth.uid() or public.is_company_admin(company_id)
              or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles for select to authenticated
  using (public.is_company_member(company_id)
         or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (public.is_company_admin(company_id)
              or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_update on public.user_roles;
create policy user_roles_update on public.user_roles for update to authenticated
  using (public.is_company_admin(company_id)
         or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id)
              or public.has_role(auth.uid(),'super_admin'));

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (public.is_company_admin(company_id)
         or public.has_role(auth.uid(),'super_admin'));

revoke all on public.companies, public.profiles, public.user_roles from anon;
grant select, insert, update, delete on public.companies to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;
grant all on public.companies, public.profiles, public.user_roles to service_role;
