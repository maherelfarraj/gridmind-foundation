-- P-071 planning baseline: WBS, schedule, baselines, risks

-- Enums (guarded)
do $$ begin
  create type wbs_item_type as enum ('phase','package','discipline','task_group');
exception when duplicate_object then null; end $$;

do $$ begin
  create type schedule_task_status as enum ('not_started','in_progress','completed','on_hold','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type risk_status as enum ('open','mitigating','realized','closed');
exception when duplicate_object then null; end $$;

-- Tables
create table if not exists public.wbs_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id uuid references public.wbs_items(id),
  code text not null,
  name text not null,
  item_type wbs_item_type not null default 'package',
  discipline text,
  description text,
  sort_order int not null default 0,
  budgeted_amount numeric(14,2),
  currency_code text references public.currencies(code),
  ifc_package_ref text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table if not exists public.schedule_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  name text not null,
  discipline text,
  start_date date not null,
  end_date date not null,
  progress_pct numeric(5,2) not null default 0,
  status schedule_task_status not null default 'not_started',
  predecessor_ids uuid[] not null default '{}',
  is_milestone boolean not null default false,
  sort_order int not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check (progress_pct >= 0 and progress_pct <= 100)
);

create table if not exists public.baseline_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  snapshot jsonb not null default '[]',
  locked boolean not null default false,
  locked_by uuid references public.profiles(id),
  locked_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.risks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'schedule',
  probability int not null check (probability between 1 and 5),
  impact int not null check (impact between 1 and 5),
  score int generated always as (probability * impact) stored,
  status risk_status not null default 'open',
  owner_id uuid references public.profiles(id),
  mitigation text,
  contingency_amount numeric(14,2),
  currency_code text references public.currencies(code),
  target_close_date date,
  identified_at date not null default current_date,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Grants (baseline_snapshots + risks: no DELETE — append-only)
grant select on public.wbs_items, public.schedule_tasks, public.baseline_snapshots, public.risks to authenticated;
grant insert, update, delete on public.wbs_items, public.schedule_tasks to authenticated;
grant insert, update on public.baseline_snapshots, public.risks to authenticated;
grant all on public.wbs_items, public.schedule_tasks, public.baseline_snapshots, public.risks to service_role;

-- RLS
alter table public.wbs_items enable row level security;
alter table public.schedule_tasks enable row level security;
alter table public.baseline_snapshots enable row level security;
alter table public.risks enable row level security;

drop policy if exists wbs_select on public.wbs_items;
create policy wbs_select on public.wbs_items for select to authenticated
  using (is_company_member(company_id));

drop policy if exists wbs_write on public.wbs_items;
create policy wbs_write on public.wbs_items for all to authenticated
  using (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('finance_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('finance_admin') or has_company_role('company_admin')));

drop policy if exists sched_select on public.schedule_tasks;
create policy sched_select on public.schedule_tasks for select to authenticated
  using (is_company_member(company_id));

drop policy if exists sched_write on public.schedule_tasks;
create policy sched_write on public.schedule_tasks for all to authenticated
  using (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('construction_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('construction_admin') or has_company_role('company_admin')));

drop policy if exists baseline_select on public.baseline_snapshots;
create policy baseline_select on public.baseline_snapshots for select to authenticated
  using (is_company_member(company_id));

drop policy if exists baseline_write on public.baseline_snapshots;
create policy baseline_write on public.baseline_snapshots for all to authenticated
  using (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('company_admin')));

drop policy if exists risks_select on public.risks;
create policy risks_select on public.risks for select to authenticated
  using (is_company_member(company_id));

drop policy if exists risks_write on public.risks;
create policy risks_write on public.risks for all to authenticated
  using (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('hse_admin') or has_company_role('finance_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('project_admin') or has_company_role('hse_admin') or has_company_role('finance_admin') or has_company_role('company_admin')));

-- updated_at triggers
drop trigger if exists set_updated_at_wbs_items on public.wbs_items;
create trigger set_updated_at_wbs_items before update on public.wbs_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_schedule_tasks on public.schedule_tasks;
create trigger set_updated_at_schedule_tasks before update on public.schedule_tasks
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_baseline_snapshots on public.baseline_snapshots;
create trigger set_updated_at_baseline_snapshots before update on public.baseline_snapshots
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_risks on public.risks;
create trigger set_updated_at_risks before update on public.risks
  for each row execute function public.set_updated_at();

-- Indexes
create index if not exists wbs_project_idx on public.wbs_items(project_id, parent_id, sort_order);
create index if not exists sched_project_idx on public.schedule_tasks(project_id, start_date);
create index if not exists sched_wbs_idx on public.schedule_tasks(wbs_item_id);
create index if not exists baseline_project_idx on public.baseline_snapshots(project_id, created_at);
create index if not exists risks_project_idx on public.risks(project_id, status, score desc);
