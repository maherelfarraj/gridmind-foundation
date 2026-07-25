-- P-091 — NCRs + submittals + transmittals

do $$ begin create type public.ncr_source as enum ('inspection','punch_item','observation','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ncr_disposition as enum ('pending','rework','repair','use_as_is','scrap'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ncr_status as enum ('open','in_progress','closed','void'); exception when duplicate_object then null; end $$;
do $$ begin create type public.submittal_status as enum ('draft','submitted','under_review','approved','approved_as_noted','revise_resubmit','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.transmittal_direction as enum ('outgoing','incoming'); exception when duplicate_object then null; end $$;

create table if not exists public.ncrs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  ncr_number text not null,
  source public.ncr_source not null default 'other',
  source_id uuid,
  discipline text,
  area text,
  description text not null,
  root_cause text,
  disposition public.ncr_disposition not null default 'pending',
  corrective_action text,
  status public.ncr_status not null default 'open',
  cost_impact numeric(14,2),
  currency_code text references public.currencies(code),
  raised_by uuid references public.profiles(id),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ncr_number)
);

create table if not exists public.submittals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  submittal_number text not null,
  title text not null,
  spec_section text,
  revision text not null default 'R0',
  status public.submittal_status not null default 'draft',
  due_date date,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  file_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, submittal_number, revision)
);

create table if not exists public.transmittals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  transmittal_number text not null,
  direction public.transmittal_direction not null default 'outgoing',
  from_party text not null,
  to_party text not null,
  subject text not null,
  items jsonb not null default '[]'::jsonb,
  response_due date,
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, transmittal_number)
);

grant select, insert, update on public.ncrs to authenticated;
grant select, insert, update on public.submittals to authenticated;
grant select, insert, update on public.transmittals to authenticated;
grant all on public.ncrs, public.submittals, public.transmittals to service_role;

alter table public.ncrs enable row level security;
alter table public.submittals enable row level security;
alter table public.transmittals enable row level security;

drop policy if exists ncrs_select on public.ncrs;
drop policy if exists ncrs_write on public.ncrs;
drop policy if exists submittals_select on public.submittals;
drop policy if exists submittals_write on public.submittals;
drop policy if exists transmittals_select on public.transmittals;
drop policy if exists transmittals_write on public.transmittals;

create policy ncrs_select on public.ncrs for select to authenticated
  using (public.is_company_member(company_id));
create policy ncrs_write on public.ncrs for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('foreman') or
    public.has_company_role('field_technician') or
    public.has_company_role('company_admin')
  ))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('foreman') or
    public.has_company_role('field_technician') or
    public.has_company_role('company_admin')
  ));

create policy submittals_select on public.submittals for select to authenticated
  using (public.is_company_member(company_id));
create policy submittals_write on public.submittals for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('engineering_admin') or
    public.has_company_role('company_admin')
  ))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('engineering_admin') or
    public.has_company_role('company_admin')
  ));

create policy transmittals_select on public.transmittals for select to authenticated
  using (public.is_company_member(company_id));
create policy transmittals_write on public.transmittals for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('engineering_admin') or
    public.has_company_role('company_admin')
  ))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin') or
    public.has_company_role('engineering_admin') or
    public.has_company_role('company_admin')
  ));

create index if not exists ncrs_project_status_idx on public.ncrs(company_id, project_id, status);
create index if not exists submittals_project_status_idx on public.submittals(company_id, project_id, status);
create index if not exists submittals_number_idx on public.submittals(company_id, project_id, submittal_number);
create index if not exists transmittals_project_idx on public.transmittals(company_id, project_id, direction);

drop trigger if exists trg_updated_at_ncrs on public.ncrs;
create trigger trg_updated_at_ncrs before update on public.ncrs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at_submittals on public.submittals;
create trigger trg_updated_at_submittals before update on public.submittals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_updated_at_transmittals on public.transmittals;
create trigger trg_updated_at_transmittals before update on public.transmittals
  for each row execute function public.set_updated_at();
