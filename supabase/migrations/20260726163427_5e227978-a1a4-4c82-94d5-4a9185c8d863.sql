-- 0066_pv_simulations.sql — PV yield simulations + results. Idempotent.

create table if not exists public.pv_simulations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  layout_id uuid references public.pv_layouts(id) on delete set null,
  site_config_id uuid references public.pv_site_configs(id) on delete set null,
  name text not null,
  status text not null default 'complete'
    check (status in ('draft','running','complete','approved','superseded')),
  engine_id text not null default 'gridmind-yield-v2',
  calc_version int not null default 2,
  inputs jsonb not null default '{}',
  input_sources jsonb not null default '{}',
  is_baseline boolean not null default false,
  approval_instance_id uuid references public.approval_instances(id),
  computed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pv_simulation_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  simulation_id uuid not null references public.pv_simulations(id) on delete cascade,
  monthly jsonb not null default '[]',
  annual jsonb not null default '{}',
  loss_chain jsonb not null default '[]',
  p_scenarios jsonb not null default '{}',
  engine_id text not null default 'gridmind-yield-v2',
  calc_version int not null default 2,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pv_simulations enable row level security;
alter table public.pv_simulation_results enable row level security;

drop policy if exists pv_sim_select on public.pv_simulations;
create policy pv_sim_select on public.pv_simulations for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_sim_write on public.pv_simulations;
create policy pv_sim_write on public.pv_simulations for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists pv_simres_select on public.pv_simulation_results;
create policy pv_simres_select on public.pv_simulation_results for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_simres_write on public.pv_simulation_results;
create policy pv_simres_write on public.pv_simulation_results for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop trigger if exists trg_pv_sim_updated on public.pv_simulations;
create trigger trg_pv_sim_updated before update on public.pv_simulations
  for each row execute function public.set_updated_at();
drop trigger if exists trg_pv_simres_updated on public.pv_simulation_results;
create trigger trg_pv_simres_updated before update on public.pv_simulation_results
  for each row execute function public.set_updated_at();

create unique index if not exists pv_sim_one_baseline_idx
  on public.pv_simulations (project_id) where is_baseline;
create index if not exists pv_sim_project_idx on public.pv_simulations (project_id, status);
create index if not exists pv_simres_sim_idx on public.pv_simulation_results (simulation_id);

create or replace function public.pv_sim_enforce_baseline_approval()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_baseline and new.status <> 'approved' then
    raise exception 'simulation must be approved before joining the project baseline';
  end if;
  return new; end $$;
drop trigger if exists trg_pv_sim_baseline on public.pv_simulations;
create trigger trg_pv_sim_baseline before insert or update on public.pv_simulations
  for each row execute function public.pv_sim_enforce_baseline_approval();

grant select, insert, update, delete on public.pv_simulations to authenticated;
grant select, insert, update, delete on public.pv_simulation_results to authenticated;
grant all on public.pv_simulations to service_role;
grant all on public.pv_simulation_results to service_role;

-- Seed rule + single engineering_admin step per company.
create or replace function public.ensure_pv_simulation_rule(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
begin
  insert into public.approval_rules
    (company_id, rule_key, name, description, entity_type, sla_hours, is_active)
  values
    (p_company_id, 'pv_simulation_baseline', 'PV simulation baseline approval',
     'Engineering sign-off on a PV energy-yield simulation baseline.', 'pv_simulation', 72, true)
  on conflict (company_id, rule_key) do nothing;

  select id into v_rule_id
    from public.approval_rules
   where company_id = p_company_id and rule_key = 'pv_simulation_baseline';

  if v_rule_id is null then
    return null;
  end if;

  insert into public.approval_chain_steps (company_id, rule_id, step_order, role, sla_hours)
  values (p_company_id, v_rule_id, 1, 'engineering_admin'::public.app_role, 72)
  on conflict (rule_id, step_order) do nothing;

  return v_rule_id;
end;
$$;

revoke all on function public.ensure_pv_simulation_rule(uuid) from public, anon;
grant execute on function public.ensure_pv_simulation_rule(uuid) to authenticated;

do $$
declare r record;
begin
  for r in select id from public.companies loop
    perform public.ensure_pv_simulation_rule(r.id);
  end loop;
end $$;
