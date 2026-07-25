-- P-098 — turnover_packages and export_packages
create table if not exists public.turnover_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  status text not null default 'compiling'
    check (status in ('compiling','ready','delivered','accepted')),
  sections jsonb not null default '[]',
  index_pdf_path text,
  compiled_by uuid references public.profiles(id),
  compiled_at timestamptz,
  delivered_at timestamptz,
  accepted_by text,
  accepted_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.export_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id) on delete cascade,
  package_type text not null,
  title text not null,
  file_path text,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.turnover_packages, public.export_packages to authenticated;
grant insert, update on public.turnover_packages, public.export_packages to authenticated;
grant all on public.turnover_packages, public.export_packages to service_role;

alter table public.turnover_packages enable row level security;
alter table public.export_packages enable row level security;

drop policy if exists turnover_packages_select on public.turnover_packages;
create policy turnover_packages_select on public.turnover_packages
  for select to authenticated using (is_company_member(company_id));

drop policy if exists turnover_packages_write on public.turnover_packages;
create policy turnover_packages_write on public.turnover_packages
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')));

drop policy if exists export_packages_select on public.export_packages;
create policy export_packages_select on public.export_packages
  for select to authenticated using (is_company_member(company_id));

drop policy if exists export_packages_write on public.export_packages;
create policy export_packages_write on public.export_packages
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')));

create index if not exists turnover_packages_project_idx
  on public.turnover_packages(company_id, project_id);
create index if not exists export_packages_project_idx
  on public.export_packages(company_id, project_id, package_type);

drop trigger if exists trg_turnover_packages_updated on public.turnover_packages;
create trigger trg_turnover_packages_updated before update
  on public.turnover_packages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_export_packages_updated on public.export_packages;
create trigger trg_export_packages_updated before update
  on public.export_packages
  for each row execute function public.set_updated_at();