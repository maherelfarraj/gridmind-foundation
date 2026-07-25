-- 0045_commissioning_core.sql — P-093
do $$ begin
  create type public.commissioning_test_type as enum
    ('insulation_resistance','hipot','iv_curve','string_test',
     'continuity','earth_resistance','functional','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.commissioning_test_status as enum
    ('not_started','scheduled','in_progress','passed','failed','on_hold');
exception when duplicate_object then null; end $$;

create table if not exists public.commissioning_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  area text not null,
  equipment_ref text,
  string_ref text,
  test_type public.commissioning_test_type not null,
  status public.commissioning_test_status not null default 'not_started',
  assigned_to uuid references public.profiles(id),
  planned_date date,
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb not null default '{}',
  utility_witness_required boolean not null default false,
  utility_witness_name text,
  utility_witnessed_at timestamptz,
  witness_file_path text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.performance_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  test_type text not null default 'performance_ratio'
    check (test_type in ('performance_ratio','capacity','energy_yield')),
  status text not null default 'planned'
    check (status in ('planned','running','complete','failed')),
  contract_value numeric(6,3),
  measured_value numeric(8,3),
  unit text not null default '%',
  period_start date,
  period_end date,
  metered_energy_mwh numeric(14,3),
  plane_of_array_kwh_m2 numeric(12,2),
  results jsonb not null default '{}',
  report_file_path text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.punch_signoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  punch_item_id uuid not null references public.qaqc_punch_items(id) on delete cascade,
  category text not null check (category in ('A','B','C')),
  signoff_party text not null check (signoff_party in ('contractor','client','utility')),
  signed_by uuid references public.profiles(id),
  signer_name text,
  signed_at timestamptz not null default now(),
  evidence_file_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (punch_item_id, signoff_party)
);

-- GRANTs before RLS
grant select on public.commissioning_tests, public.performance_tests,
  public.punch_signoffs to authenticated;
grant insert, update, delete on public.commissioning_tests to authenticated;
grant insert, update on public.performance_tests to authenticated;
grant insert, update on public.punch_signoffs to authenticated;
grant all on public.commissioning_tests, public.performance_tests,
  public.punch_signoffs to service_role;

alter table public.commissioning_tests enable row level security;
alter table public.performance_tests enable row level security;
alter table public.punch_signoffs enable row level security;

drop policy if exists commissioning_tests_select on public.commissioning_tests;
create policy commissioning_tests_select on public.commissioning_tests
  for select to authenticated using (is_company_member(company_id));

drop policy if exists commissioning_tests_write on public.commissioning_tests;
create policy commissioning_tests_write on public.commissioning_tests
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('engineer')
    or has_company_role('field_technician') or has_company_role('foreman')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('engineer')
    or has_company_role('field_technician') or has_company_role('foreman')));

drop policy if exists performance_tests_select on public.performance_tests;
create policy performance_tests_select on public.performance_tests
  for select to authenticated using (is_company_member(company_id));

drop policy if exists performance_tests_write on public.performance_tests;
create policy performance_tests_write on public.performance_tests
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('engineer')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('engineer')));

drop policy if exists punch_signoffs_select on public.punch_signoffs;
create policy punch_signoffs_select on public.punch_signoffs
  for select to authenticated using (is_company_member(company_id));

drop policy if exists punch_signoffs_write on public.punch_signoffs;
create policy punch_signoffs_write on public.punch_signoffs
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('foreman')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('company_admin')
    or has_company_role('project_admin') or has_company_role('foreman')));

create index if not exists commissioning_tests_project_idx
  on public.commissioning_tests(company_id, project_id, status);
create index if not exists commissioning_tests_assignee_idx
  on public.commissioning_tests(assigned_to, status);
create index if not exists performance_tests_project_idx
  on public.performance_tests(company_id, project_id, test_type, status);
create index if not exists punch_signoffs_item_idx
  on public.punch_signoffs(punch_item_id);
create index if not exists punch_signoffs_project_idx
  on public.punch_signoffs(company_id, project_id, category);

do $$
declare t text;
begin
  foreach t in array array['commissioning_tests','performance_tests','punch_signoffs'] loop
    execute format('drop trigger if exists trg_%I_updated on public.%I', t, t);
    execute format('create trigger trg_%I_updated before update on public.%I
      for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;