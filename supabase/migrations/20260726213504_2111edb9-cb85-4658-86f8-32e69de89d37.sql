-- 0075_construction_governance.sql
do $$ begin create type public.gov_doc_status as enum ('draft','submitted','under_review','approved','rejected','superseded'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tbt_status as enum ('scheduled','held','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ptw_type as enum ('hot_work','confined_space','working_at_height','electrical','excavation','lifting','general'); exception when duplicate_object then null; end $$;
do $$ begin create type public.ptw_status as enum ('requested','active','suspended','closed','expired','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.si_status as enum ('issued','acknowledged','completed','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tq_status as enum ('draft','submitted','answered','closed','void'); exception when duplicate_object then null; end $$;

create table if not exists public.method_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  ms_number text not null,
  title text not null,
  activity text not null,
  revision text not null default 'R0',
  status public.gov_doc_status not null default 'draft',
  file_path text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, ms_number, revision)
);

create table if not exists public.toolbox_talks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  tbt_number text not null,
  talk_date date not null,
  topic text not null,
  presenter uuid references public.profiles(id),
  location text,
  status public.tbt_status not null default 'scheduled',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tbt_number)
);

create table if not exists public.toolbox_talk_attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  talk_id uuid not null references public.toolbox_talks(id) on delete cascade,
  worker_name text not null,
  trade text,
  employer text,
  signature_path text,
  attended boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permits_to_work (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  ptw_number text not null,
  permit_type public.ptw_type not null,
  location text not null,
  description text not null,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  status public.ptw_status not null default 'requested',
  isolations jsonb not null default '[]',
  isolations_confirmed boolean not null default false,
  requested_by uuid references public.profiles(id),
  issued_by uuid references public.profiles(id),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ptw_number),
  check (valid_to > valid_from)
);

create table if not exists public.site_instructions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  si_number text not null,
  instruction text not null,
  issued_to text not null,
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  status public.si_status not null default 'issued',
  due_date date,
  acknowledged_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, si_number)
);

create table if not exists public.technical_queries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  tq_number text not null,
  subject text not null,
  question text not null,
  response text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status public.tq_status not null default 'draft',
  rfi_id uuid references public.rfis(id) on delete set null,
  due_date date,
  raised_by uuid references public.profiles(id),
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tq_number)
);

-- indexes
create index if not exists ms_project_status_idx on public.method_statements (company_id, project_id, status);
create index if not exists tbt_project_date_idx on public.toolbox_talks (company_id, project_id, talk_date desc);
create index if not exists tbta_talk_idx on public.toolbox_talk_attendance (talk_id);
create index if not exists ptw_project_validity_idx on public.permits_to_work (company_id, project_id, status, valid_to);
create index if not exists si_project_status_idx on public.site_instructions (company_id, project_id, status);
create index if not exists tq_project_status_idx on public.technical_queries (company_id, project_id, status);

-- grants
grant select, insert, update on public.method_statements to authenticated;
grant select, insert, update on public.toolbox_talks to authenticated;
grant select, insert, update, delete on public.toolbox_talk_attendance to authenticated;
grant select, insert, update on public.permits_to_work to authenticated;
grant select, insert, update on public.site_instructions to authenticated;
grant select, insert, update on public.technical_queries to authenticated;
grant all on public.method_statements to service_role;
grant all on public.toolbox_talks to service_role;
grant all on public.toolbox_talk_attendance to service_role;
grant all on public.permits_to_work to service_role;
grant all on public.site_instructions to service_role;
grant all on public.technical_queries to service_role;

-- rls
alter table public.method_statements enable row level security;
alter table public.toolbox_talks enable row level security;
alter table public.toolbox_talk_attendance enable row level security;
alter table public.permits_to_work enable row level security;
alter table public.site_instructions enable row level security;
alter table public.technical_queries enable row level security;

drop policy if exists method_statements_select on public.method_statements;
create policy method_statements_select on public.method_statements
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists method_statements_write on public.method_statements;
create policy method_statements_write on public.method_statements
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists site_instructions_select on public.site_instructions;
create policy site_instructions_select on public.site_instructions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists site_instructions_write on public.site_instructions;
create policy site_instructions_write on public.site_instructions
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists technical_queries_select on public.technical_queries;
create policy technical_queries_select on public.technical_queries
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists technical_queries_write on public.technical_queries;
create policy technical_queries_write on public.technical_queries
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('engineering_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists toolbox_talks_select on public.toolbox_talks;
create policy toolbox_talks_select on public.toolbox_talks
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists toolbox_talks_write on public.toolbox_talks;
create policy toolbox_talks_write on public.toolbox_talks
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists toolbox_talk_attendance_select on public.toolbox_talk_attendance;
create policy toolbox_talk_attendance_select on public.toolbox_talk_attendance
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists toolbox_talk_attendance_write on public.toolbox_talk_attendance;
create policy toolbox_talk_attendance_write on public.toolbox_talk_attendance
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists permits_to_work_select on public.permits_to_work;
create policy permits_to_work_select on public.permits_to_work
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists permits_to_work_write on public.permits_to_work;
create policy permits_to_work_write on public.permits_to_work
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('hse_admin'::public.app_role)
    or public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

-- updated_at triggers
drop trigger if exists trg_updated_at on public.method_statements;
create trigger trg_updated_at before update on public.method_statements for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.toolbox_talks;
create trigger trg_updated_at before update on public.toolbox_talks for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.toolbox_talk_attendance;
create trigger trg_updated_at before update on public.toolbox_talk_attendance for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.permits_to_work;
create trigger trg_updated_at before update on public.permits_to_work for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.site_instructions;
create trigger trg_updated_at before update on public.site_instructions for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.technical_queries;
create trigger trg_updated_at before update on public.technical_queries for each row execute function public.set_updated_at();