-- P-175 — daily KPI snapshots. Idempotent.
create table if not exists public.scada_kpi_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  day date not null,
  actual_energy_kwh numeric(14,3),
  expected_energy_kwh numeric(14,3),
  lost_energy_kwh numeric(14,3),
  downtime_minutes int not null default 0,
  availability_pct numeric(6,3),
  performance_ratio_pct numeric(6,3),
  data_quality_pct numeric(6,3),
  downtime_breakdown jsonb not null default '{}',
  guarantee_check jsonb not null default '{}',
  computed_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, day)
);

grant select, insert, update, delete on public.scada_kpi_daily to authenticated;
grant all on public.scada_kpi_daily to service_role;

alter table public.scada_kpi_daily enable row level security;

drop policy if exists scada_kpi_daily_select on public.scada_kpi_daily;
create policy scada_kpi_daily_select on public.scada_kpi_daily for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists scada_kpi_daily_write on public.scada_kpi_daily;
create policy scada_kpi_daily_write on public.scada_kpi_daily for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

create index if not exists scada_kpi_daily_project_day_idx on public.scada_kpi_daily(project_id, day desc);

drop trigger if exists trg_scada_kpi_daily_updated on public.scada_kpi_daily;
create trigger trg_scada_kpi_daily_updated before update on public.scada_kpi_daily
  for each row execute function public.set_updated_at();