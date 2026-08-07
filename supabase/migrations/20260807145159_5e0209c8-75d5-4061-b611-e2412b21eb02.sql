-- GC-11 — Portfolio Scenario & Risk Forecasting (non-posting what-if overlays)

create type public.portfolio_scenario_status as enum ('draft','shared','locked','archived');

create type public.portfolio_scenario_driver as enum (
  'etc_adjust',
  'commitment_timing',
  'cash_timing',
  'change_probability',
  'risk_threat',
  'risk_opportunity',
  'contingency_draw',
  'contingency_release',
  'schedule_delay',
  'escalation',
  'inflation',
  'fx_shock'
);

create type public.portfolio_scenario_fx_mode as enum ('snapshot','current','shock');

-- ---------------------------------------------------------------------------
-- Scenario header
-- ---------------------------------------------------------------------------
create table public.portfolio_scenarios (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  purpose text,
  notes text,
  status public.portfolio_scenario_status not null default 'draft',
  -- Anchored approved basis (never mutated by the scenario)
  source_period date not null,
  source_basis text not null default 'period_end' check (source_basis in ('period_end','latest')),
  reporting_currency text not null check (reporting_currency ~ '^[A-Z]{3}$'),
  fx_mode public.portfolio_scenario_fx_mode not null default 'snapshot',
  fx_shock_pct numeric not null default 0 check (fx_shock_pct between -90 and 500),
  horizon_months integer not null default 12 check (horizon_months between 1 and 60),
  source_versions jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  config_version integer not null default 1,
  revision integer not null default 1 check (revision >= 1),
  copied_from_id uuid references public.portfolio_scenarios(id) on delete set null,
  locked_at timestamptz,
  locked_by uuid references public.profiles(id),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, owner_id, name)
);

create index portfolio_scenarios_company_idx
  on public.portfolio_scenarios (company_id, status, updated_at desc);
create index portfolio_scenarios_owner_idx
  on public.portfolio_scenarios (owner_id, status, updated_at desc);
create index portfolio_scenarios_period_idx
  on public.portfolio_scenarios (company_id, source_period, reporting_currency);
create index portfolio_scenarios_lineage_idx
  on public.portfolio_scenarios (copied_from_id) where copied_from_id is not null;

grant select, insert, update, delete on public.portfolio_scenarios to authenticated;
grant all on public.portfolio_scenarios to service_role;
alter table public.portfolio_scenarios enable row level security;

create policy "psc_select" on public.portfolio_scenarios
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (
      owner_id = auth.uid()
      or (status in ('shared','locked','archived')
          and (public.has_company_role('finance_admin'::public.app_role)
               or public.has_company_role('company_admin'::public.app_role)))
    )
  );

create policy "psc_insert" on public.portfolio_scenarios
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and owner_id = auth.uid()
    and status = 'draft'
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  );

create policy "psc_update" on public.portfolio_scenarios
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      (owner_id = auth.uid() and status = 'draft')
      or public.has_company_role('finance_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      (owner_id = auth.uid() and status in ('draft','shared','locked','archived'))
      or public.has_company_role('finance_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );

create policy "psc_delete" on public.portfolio_scenarios
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and owner_id = auth.uid()
    and status = 'draft'
  );

create trigger trg_psc_updated before update on public.portfolio_scenarios
  for each row execute function public.set_updated_at();

-- Locked scenarios are immutable except for archiving.
create or replace function public.portfolio_scenarios_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'scenario_locked: only draft scenarios can be deleted';
    end if;
    return old;
  end if;

  if old.status = 'locked' then
    if new.status not in ('locked','archived') then
      raise exception 'scenario_locked: a locked scenario cannot return to %', new.status;
    end if;
    if (new.name, new.purpose, new.notes, new.source_period, new.source_basis,
        new.reporting_currency, new.fx_mode, new.fx_shock_pct, new.horizon_months,
        new.source_versions, new.config)
       is distinct from
       (old.name, old.purpose, old.notes, old.source_period, old.source_basis,
        old.reporting_currency, old.fx_mode, old.fx_shock_pct, old.horizon_months,
        old.source_versions, old.config) then
      raise exception 'scenario_locked: locked scenarios are immutable';
    end if;
  end if;

  if old.status = 'archived' and new.status <> 'archived' then
    raise exception 'scenario_archived: archived scenarios cannot be reopened';
  end if;

  if new.status = 'locked' and old.status <> 'locked' then
    new.locked_at := now();
    new.locked_by := auth.uid();
  end if;
  if new.status = 'archived' and old.status <> 'archived' then
    new.archived_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.portfolio_scenarios_guard() from public, anon;

create trigger trg_psc_guard before update or delete on public.portfolio_scenarios
  for each row execute function public.portfolio_scenarios_guard();

-- ---------------------------------------------------------------------------
-- Assumptions (what-if overlay lines)
-- ---------------------------------------------------------------------------
create table public.portfolio_scenario_assumptions (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.portfolio_scenarios(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  cost_code_id uuid references public.cost_codes(id) on delete set null,
  driver public.portfolio_scenario_driver not null,
  period_month date,
  label text,
  amount numeric,
  pct numeric check (pct is null or pct between -100 and 1000),
  probability numeric check (probability is null or probability between 0 and 1),
  delay_months integer check (delay_months is null or delay_months between -36 and 36),
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  source_table text,
  source_id uuid,
  note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index psa_scenario_idx
  on public.portfolio_scenario_assumptions (scenario_id, sort_order, created_at);
create index psa_project_idx
  on public.portfolio_scenario_assumptions (company_id, project_id, driver);
create index psa_source_idx
  on public.portfolio_scenario_assumptions (source_table, source_id) where source_id is not null;
create index psa_period_idx
  on public.portfolio_scenario_assumptions (scenario_id, period_month);

grant select, insert, update, delete on public.portfolio_scenario_assumptions to authenticated;
grant all on public.portfolio_scenario_assumptions to service_role;
alter table public.portfolio_scenario_assumptions enable row level security;

create policy "psa_select" on public.portfolio_scenario_assumptions
  for select to authenticated
  using (exists (
    select 1 from public.portfolio_scenarios s
    where s.id = portfolio_scenario_assumptions.scenario_id
  ));

create policy "psa_write" on public.portfolio_scenario_assumptions
  for all to authenticated
  using (exists (
    select 1 from public.portfolio_scenarios s
    where s.id = portfolio_scenario_assumptions.scenario_id
      and s.company_id = portfolio_scenario_assumptions.company_id
      and s.status = 'draft'
      and (s.owner_id = auth.uid()
           or public.has_company_role('finance_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role))
  ))
  with check (exists (
    select 1 from public.portfolio_scenarios s
    where s.id = portfolio_scenario_assumptions.scenario_id
      and s.company_id = portfolio_scenario_assumptions.company_id
      and s.status = 'draft'
      and (s.owner_id = auth.uid()
           or public.has_company_role('finance_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role))
  ));

create trigger trg_psa_updated before update on public.portfolio_scenario_assumptions
  for each row execute function public.set_updated_at();

create or replace function public.portfolio_scenario_assumptions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.portfolio_scenario_status;
begin
  select s.status into st from public.portfolio_scenarios s
   where s.id = coalesce(new.scenario_id, old.scenario_id);
  if st is null then
    return coalesce(new, old);
  end if;
  if st <> 'draft' then
    raise exception 'scenario_locked: assumptions are read-only once a scenario is % ', st;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.portfolio_scenario_assumptions_guard() from public, anon;

create trigger trg_psa_guard
  before insert or update or delete on public.portfolio_scenario_assumptions
  for each row execute function public.portfolio_scenario_assumptions_guard();

-- ---------------------------------------------------------------------------
-- Immutable lifecycle history
-- ---------------------------------------------------------------------------
create table public.portfolio_scenario_events (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.portfolio_scenarios(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  action text not null,
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index pse_scenario_idx on public.portfolio_scenario_events (scenario_id, created_at desc);
create index pse_company_idx on public.portfolio_scenario_events (company_id, created_at desc);

grant select, insert on public.portfolio_scenario_events to authenticated;
grant all on public.portfolio_scenario_events to service_role;
alter table public.portfolio_scenario_events enable row level security;

create policy "pse_select" on public.portfolio_scenario_events
  for select to authenticated
  using (exists (
    select 1 from public.portfolio_scenarios s
    where s.id = portfolio_scenario_events.scenario_id
  ));

create policy "pse_insert" on public.portfolio_scenario_events
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.portfolio_scenarios s
      where s.id = portfolio_scenario_events.scenario_id
        and s.company_id = portfolio_scenario_events.company_id
    )
  );
