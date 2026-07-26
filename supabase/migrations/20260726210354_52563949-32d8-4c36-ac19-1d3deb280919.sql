-- 0074_cwp_controls.sql
do $$ begin create type public.cwp_status as enum ('draft','planned','in_progress','on_hold','complete','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.look_ahead_status as enum ('draft','published','locked'); exception when duplicate_object then null; end $$;
do $$ begin create type public.delay_cause as enum ('weather','material','design','labor','equipment','client','permit','access','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.recovery_plan_status as enum ('draft','active','achieved','abandoned'); exception when duplicate_object then null; end $$;

create table if not exists public.construction_work_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cwp_number text not null,
  title text not null,
  description text,
  discipline text not null default 'general',
  area text,
  wbs_item_id uuid references public.wbs_items(id),
  planned_start date,
  planned_end date,
  status public.cwp_status not null default 'draft',
  weight numeric(7,3) not null default 1 check (weight >= 0),
  progress_pct numeric(5,2) not null default 0 check (progress_pct >= 0 and progress_pct <= 100),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cwp_number),
  check (planned_end is null or planned_start is null or planned_end >= planned_start)
);

create table if not exists public.look_ahead_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  week_start date not null,
  status public.look_ahead_status not null default 'draft',
  entries jsonb not null default '[]',
  notes text,
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, week_start)
);

create table if not exists public.progress_weighting_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  discipline text not null,
  name text not null,
  uom text not null,
  target_qty numeric(14,3) not null check (target_qty > 0),
  weight_pct numeric(5,2) not null check (weight_pct >= 0 and weight_pct <= 100),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delay_analysis (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  schedule_task_id uuid references public.schedule_tasks(id) on delete set null,
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  weather_delay_id uuid references public.weather_delays(id) on delete set null,
  delay_date date not null,
  cause public.delay_cause not null,
  lost_days numeric(6,2) not null default 0 check (lost_days >= 0),
  narrative text,
  eot_claim boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recovery_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  delay_analysis_id uuid references public.delay_analysis(id) on delete set null,
  plan_number text not null,
  title text not null,
  actions jsonb not null default '[]',
  target_recovery_date date,
  status public.recovery_plan_status not null default 'draft',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, plan_number)
);

alter table public.schedule_tasks add column if not exists cwp_id uuid references public.construction_work_packages(id) on delete set null;
alter table public.schedule_tasks add column if not exists is_critical boolean not null default false;

-- Indexes
create index if not exists cwp_project_status_idx on public.construction_work_packages (company_id, project_id, status);
create index if not exists cwp_wbs_idx on public.construction_work_packages (wbs_item_id);
create index if not exists la_project_week_idx on public.look_ahead_plans (company_id, project_id, week_start);
create index if not exists pwr_company_discipline_idx on public.progress_weighting_rules (company_id, discipline);
create index if not exists delay_project_date_idx on public.delay_analysis (company_id, project_id, delay_date);
create index if not exists schedule_tasks_cwp_idx on public.schedule_tasks (cwp_id);
create index if not exists schedule_tasks_critical_idx on public.schedule_tasks (company_id, project_id) where is_critical;

-- updated_at triggers
drop trigger if exists trg_updated_at on public.construction_work_packages;
create trigger trg_updated_at before update on public.construction_work_packages for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.look_ahead_plans;
create trigger trg_updated_at before update on public.look_ahead_plans for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.progress_weighting_rules;
create trigger trg_updated_at before update on public.progress_weighting_rules for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.delay_analysis;
create trigger trg_updated_at before update on public.delay_analysis for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.recovery_plans;
create trigger trg_updated_at before update on public.recovery_plans for each row execute function public.set_updated_at();

-- GRANTs
grant select, insert, update, delete on public.construction_work_packages to authenticated;
grant select, insert, update, delete on public.look_ahead_plans to authenticated;
grant select, insert, update, delete on public.delay_analysis to authenticated;
grant select, insert, update on public.progress_weighting_rules to authenticated;
grant select, insert, update on public.recovery_plans to authenticated;
grant all on public.construction_work_packages to service_role;
grant all on public.look_ahead_plans to service_role;
grant all on public.delay_analysis to service_role;
grant all on public.progress_weighting_rules to service_role;
grant all on public.recovery_plans to service_role;

-- RLS
alter table public.construction_work_packages enable row level security;
alter table public.look_ahead_plans enable row level security;
alter table public.progress_weighting_rules enable row level security;
alter table public.delay_analysis enable row level security;
alter table public.recovery_plans enable row level security;

drop policy if exists cwp_select on public.construction_work_packages;
create policy cwp_select on public.construction_work_packages
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists cwp_write on public.construction_work_packages;
create policy cwp_write on public.construction_work_packages
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists look_ahead_select on public.look_ahead_plans;
create policy look_ahead_select on public.look_ahead_plans
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists look_ahead_write on public.look_ahead_plans;
create policy look_ahead_write on public.look_ahead_plans
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists delay_analysis_select on public.delay_analysis;
create policy delay_analysis_select on public.delay_analysis
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists delay_analysis_write on public.delay_analysis;
create policy delay_analysis_write on public.delay_analysis
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists pwr_select on public.progress_weighting_rules;
create policy pwr_select on public.progress_weighting_rules
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists pwr_write on public.progress_weighting_rules;
create policy pwr_write on public.progress_weighting_rules
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists recovery_plans_select on public.recovery_plans;
create policy recovery_plans_select on public.recovery_plans
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists recovery_plans_write on public.recovery_plans;
create policy recovery_plans_write on public.recovery_plans
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));