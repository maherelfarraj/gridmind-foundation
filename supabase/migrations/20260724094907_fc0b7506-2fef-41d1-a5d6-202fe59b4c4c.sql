create table public.project_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  archetype public.project_archetype not null,
  description text,
  is_system boolean not null default false,
  default_gates jsonb not null default '[]',
  default_budget_lines jsonb not null default '[]',
  default_departments public.project_department[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name, archetype)
);

alter table public.projects
  add constraint projects_template_fk
  foreign key (template_id) references public.project_templates(id);

create table public.project_pv_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  module_type text,
  tracker_type text not null default 'fixed'
    check (tracker_type in ('fixed','single_axis','dual_axis')),
  tilt_deg numeric(5,2), gcr numeric(5,4), dc_ac_ratio numeric(5,3),
  dc_capacity_mwp numeric(12,3), inverter_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_bess_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  chemistry text not null default 'lfp'
    check (chemistry in ('lfp','nmc','flow','other')),
  power_mw numeric(12,3), energy_mwh numeric(12,3),
  duration_hours numeric(5,2), pcs_count int, container_count int,
  cycles_per_day numeric(4,2), augmentation_strategy text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_substation_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  voltage_kv numeric(8,2), transformer_count int,
  transformer_mva numeric(8,2), bay_count int,
  busbar_scheme text, grid_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_sld_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  hv_voltage_kv numeric(8,2), mv_voltage_kv numeric(8,2),
  lv_voltage_kv numeric(8,2),
  voltage_levels jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_scada_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  protocol text not null default 'modbus_tcp'
    check (protocol in ('modbus_tcp','iec61850','dnp3','opc_ua')),
  polling_interval_sec int not null default 5,
  points_count int, historian_retention_days int not null default 400,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_yield_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  p50_mwh numeric(14,2), p90_mwh numeric(14,2),
  ghi_kwh_m2 numeric(8,2), losses_pct numeric(5,2),
  degradation_pct numeric(5,3), availability_pct numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_pvsyst_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  pvsyst_version text, meteo_source text, sim_report_url text,
  near_shading_pct numeric(5,2), albedo numeric(4,2),
  bifacial boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_financial_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  currency_code text not null default 'USD' references public.currencies(code),
  capex_total numeric(16,2), contingency_pct numeric(5,2),
  debt_ratio_pct numeric(5,2), discount_rate_pct numeric(5,2),
  ppa_price numeric(10,4), contract_years int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_cybersecurity_config (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  standard text not null default 'iec62443'
    check (standard in ('iec62443','nerc_cip','iso27019')),
  zones_conduits jsonb not null default '[]',
  remote_access_policy text,
  soc_monitoring boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'project_templates','project_pv_config','project_bess_config',
    'project_substation_config','project_sld_config','project_scada_config',
    'project_yield_config','project_pvsyst_config','project_financial_config',
    'project_cybersecurity_config']
  loop
    execute format('create trigger trg_%I_updated before update on public.%I
      for each row execute function public.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated
      using (public.is_company_member(company_id))', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated
      using (public.has_company_role(''company_admin''::app_role)
        or public.has_company_role(''project_admin''::app_role)
        or public.has_company_role(''engineering_admin''::app_role))
      with check (public.has_company_role(''company_admin''::app_role)
        or public.has_company_role(''project_admin''::app_role)
        or public.has_company_role(''engineering_admin''::app_role))', t, t);
    execute format('create index idx_%I_company on public.%I(company_id)', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy project_financial_config_fin on public.project_financial_config
  for all to authenticated
  using (public.has_company_role('finance_admin'::app_role))
  with check (public.has_company_role('finance_admin'::app_role));