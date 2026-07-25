do $$ begin create type public.mobilization_category as enum ('cabins_facilities','fencing_security','hse_induction','utilities_comms','access_logistics','permits_licenses'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mobilization_status as enum ('not_started','in_progress','complete'); exception when duplicate_object then null; end $$;

create table if not exists public.mobilization_checklists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  name text not null,
  status public.mobilization_status not null default 'not_started',
  items jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, name)
);

grant select on public.mobilization_checklists to authenticated;
grant insert, update on public.mobilization_checklists to authenticated;
grant all on public.mobilization_checklists to service_role;

alter table public.mobilization_checklists enable row level security;

create policy mobilization_select on public.mobilization_checklists
  for select to authenticated
  using (is_company_member(company_id));

create policy mobilization_write on public.mobilization_checklists
  for all to authenticated
  using (
    is_company_member(company_id)
    and (
      has_company_role('construction_admin'::app_role)
      or has_company_role('foreman'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  )
  with check (
    is_company_member(company_id)
    and (
      has_company_role('construction_admin'::app_role)
      or has_company_role('foreman'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  );

create index if not exists mobilization_project_idx
  on public.mobilization_checklists(company_id, project_id, status);

drop trigger if exists trg_mobilization_updated_at on public.mobilization_checklists;
create trigger trg_mobilization_updated_at
  before update on public.mobilization_checklists
  for each row execute function public.set_updated_at();