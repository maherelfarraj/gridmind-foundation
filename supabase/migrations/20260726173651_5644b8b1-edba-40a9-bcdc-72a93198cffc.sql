-- 0068_layout_optimization.sql — terrain/civil-aware PV layout optimization scenario runs
do $$ begin
  create type public.layout_scenario_type as enum (
    'max_capacity','min_grading','min_cable_length','min_road_length',
    'lowest_epc_cost','max_energy_yield','balanced'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.layout_optimization_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  run_ref text not null,
  name text not null,
  scenario_type public.layout_scenario_type not null,
  status text not null default 'draft'
    check (status in ('draft','running','completed','under_review','approved','superseded','failed')),
  revision_code text not null default 'A',
  surface_id uuid references public.terrain_surfaces(id) on delete set null,
  weights jsonb not null default '{"capacity":0.20,"grading":0.15,"cable_length":0.15,"road_length":0.10,"epc_cost":0.20,"energy_yield":0.20}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  results jsonb,
  chosen_candidate integer,
  score numeric,
  approval_instance_id uuid references public.approval_instances(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, run_ref),
  unique (project_id, name, revision_code)
);

create index if not exists layout_opt_runs_project_idx on public.layout_optimization_runs(project_id);
create index if not exists layout_opt_runs_company_idx on public.layout_optimization_runs(company_id);
create index if not exists layout_opt_runs_status_idx on public.layout_optimization_runs(project_id, status);

drop trigger if exists trg_layout_opt_runs_updated on public.layout_optimization_runs;
create trigger trg_layout_opt_runs_updated before update on public.layout_optimization_runs
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.layout_optimization_runs to authenticated;

alter table public.layout_optimization_runs enable row level security;

drop policy if exists layout_opt_runs_select on public.layout_optimization_runs;
create policy layout_opt_runs_select on public.layout_optimization_runs for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists layout_opt_runs_write on public.layout_optimization_runs;
create policy layout_opt_runs_write on public.layout_optimization_runs for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('engineering_admin') or public.has_company_role('engineer')
    or public.has_company_role('project_admin') or public.has_role(auth.uid(),'super_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('engineering_admin') or public.has_company_role('engineer')
    or public.has_company_role('project_admin') or public.has_role(auth.uid(),'super_admin')));