-- GC-12 — Integrated Earned Value Management.

create type public.evm_report_status as enum ('working','submitted','approved','superseded');
create type public.evm_progress_method as enum (
  'weighted_milestone','physical_pct','units_complete','zero_hundred',
  'twenty_eighty','fifty_fifty','level_of_effort'
);
create type public.evm_eac_method as enum ('bottom_up','cpi','cpi_spi','ac_plus_remaining');
create type public.evm_mapping_status as enum ('draft','approved','superseded');

alter type public.portfolio_alert_rule_type add value if not exists 'evm_cpi_deterioration';
alter type public.portfolio_alert_rule_type add value if not exists 'evm_spi_deterioration';
alter type public.portfolio_alert_rule_type add value if not exists 'evm_tcpi_infeasible';
alter type public.portfolio_alert_rule_type add value if not exists 'evm_mapping_gap';
alter type public.portfolio_alert_rule_type add value if not exists 'evm_forecast_divergence';

-- ---------------------------------------------------------------- settings
create table public.evm_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  default_progress_method public.evm_progress_method not null default 'physical_pct',
  official_eac_method public.evm_eac_method not null default 'bottom_up',
  include_accruals_in_ac boolean not null default true,
  cpi_threshold numeric not null default 0.95,
  spi_threshold numeric not null default 0.95,
  variance_threshold_pct numeric not null default 5,
  variance_threshold_amount numeric not null default 100000,
  tcpi_feasibility_limit numeric not null default 1.10,
  gate_block_on_unmapped boolean not null default true,
  gate_max_unmapped_pct numeric not null default 5,
  gate_block_on_stale_progress boolean not null default true,
  progress_stale_days integer not null default 45,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

-- -------------------------------------------------------- mapping versions
create table public.evm_mapping_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_no integer not null,
  status public.evm_mapping_status not null default 'draft',
  label text,
  note text,
  row_version integer not null default 1,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  superseded_by_id uuid references public.evm_mapping_versions(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version_no)
);

create table public.evm_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  mapping_version_id uuid not null references public.evm_mapping_versions(id) on delete cascade,
  wbs_item_id uuid references public.wbs_items(id) on delete cascade,
  schedule_task_id uuid references public.schedule_tasks(id) on delete cascade,
  cost_code_id uuid references public.cost_codes(id) on delete cascade,
  allocation_pct numeric not null default 100,
  progress_method public.evm_progress_method not null default 'physical_pct',
  milestone_weights jsonb,
  planned_units numeric,
  note text,
  sort_order integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evm_mappings_alloc_range check (allocation_pct > 0 and allocation_pct <= 100),
  constraint evm_mappings_scope check (wbs_item_id is not null or schedule_task_id is not null)
);

create index evm_mappings_version_idx on public.evm_mappings (mapping_version_id, sort_order);
create index evm_mappings_scope_idx on public.evm_mappings (project_id, wbs_item_id, schedule_task_id);
create index evm_mappings_cost_code_idx on public.evm_mappings (cost_code_id);

-- ----------------------------------------------------------------- reports
create table public.evm_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  data_date date not null,
  status public.evm_report_status not null default 'working',
  row_version integer not null default 1,
  version_no integer not null default 1,
  schedule_baseline_id uuid references public.baseline_snapshots(id) on delete set null,
  cost_basis text not null default 'approved_budget',
  forecast_version_id uuid references public.forecast_versions(id) on delete set null,
  mapping_version_id uuid references public.evm_mapping_versions(id) on delete set null,
  reporting_currency text not null,
  project_currency text not null,
  fx_provenance jsonb not null default '{}'::jsonb,
  ac_basis text not null default 'actual_plus_accrual',
  official_eac_method public.evm_eac_method not null default 'bottom_up',
  eac_override_reason text,
  totals jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.evm_reports(id) on delete set null,
  superseded_by_id uuid references public.evm_reports(id) on delete set null,
  correction_reason text,
  prepared_by uuid references auth.users(id) on delete set null,
  prepared_at timestamptz,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evm_reports_period_month check (date_trunc('month', period_month)::date = period_month),
  constraint evm_reports_cost_basis check (cost_basis in ('approved_budget','approved_forecast')),
  constraint evm_reports_ac_basis check (ac_basis in ('actual_only','actual_plus_accrual'))
);

create unique index evm_reports_active_idx
  on public.evm_reports (project_id, period_month)
  where status <> 'superseded';
create index evm_reports_lookup_idx on public.evm_reports (company_id, period_month, status);
create index evm_reports_project_idx on public.evm_reports (project_id, period_month desc, version_no desc);

create table public.evm_report_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report_id uuid not null references public.evm_reports(id) on delete cascade,
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  cost_code_id uuid references public.cost_codes(id) on delete set null,
  schedule_task_id uuid references public.schedule_tasks(id) on delete set null,
  parent_line_id uuid references public.evm_report_lines(id) on delete cascade,
  label text not null,
  level integer not null default 0,
  progress_method public.evm_progress_method not null default 'physical_pct',
  allocation_pct numeric not null default 100,
  calculated_pct numeric,
  applied_pct numeric,
  bac numeric not null default 0,
  pv numeric not null default 0,
  ev numeric not null default 0,
  ac numeric not null default 0,
  etc numeric,
  eac numeric,
  measures jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index evm_report_lines_report_idx on public.evm_report_lines (report_id, sort_order);
create index evm_report_lines_wbs_idx on public.evm_report_lines (report_id, wbs_item_id);
create index evm_report_lines_cost_code_idx on public.evm_report_lines (report_id, cost_code_id);

create table public.evm_progress_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  wbs_item_id uuid references public.wbs_items(id) on delete cascade,
  schedule_task_id uuid references public.schedule_tasks(id) on delete cascade,
  calculated_pct numeric,
  override_pct numeric not null,
  reason text not null,
  evidence_ref text not null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evm_overrides_pct_range check (override_pct >= 0 and override_pct <= 100),
  constraint evm_overrides_reason_len check (char_length(btrim(reason)) >= 8),
  constraint evm_overrides_scope check (wbs_item_id is not null or schedule_task_id is not null)
);

create unique index evm_overrides_unique_idx
  on public.evm_progress_overrides (project_id, period_month, coalesce(wbs_item_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(schedule_task_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table public.evm_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  report_id uuid references public.evm_reports(id) on delete cascade,
  period_month date not null,
  code text not null,
  severity text not null default 'warning',
  blocking boolean not null default false,
  title text not null,
  detail text,
  entity_table text,
  entity_id uuid,
  current_value numeric,
  threshold_value numeric,
  value_unit text,
  linked_ref text,
  created_at timestamptz not null default now(),
  constraint evm_exceptions_severity check (severity in ('blocker','warning','info'))
);

create index evm_exceptions_report_idx on public.evm_exceptions (report_id, severity);
create index evm_exceptions_project_idx on public.evm_exceptions (project_id, period_month, code);

create table public.evm_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  report_id uuid references public.evm_reports(id) on delete cascade,
  event_type text not null,
  from_status public.evm_report_status,
  to_status public.evm_report_status,
  reason text,
  context jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index evm_events_report_idx on public.evm_events (report_id, created_at desc);
create index evm_events_project_idx on public.evm_events (project_id, created_at desc);

-- ------------------------------------------------------------------ grants
revoke all on public.evm_settings, public.evm_mapping_versions, public.evm_mappings,
  public.evm_reports, public.evm_report_lines, public.evm_progress_overrides,
  public.evm_exceptions, public.evm_events from anon, authenticated, public;

grant select, insert, update, delete on public.evm_settings to authenticated;
grant select, insert, update, delete on public.evm_mapping_versions to authenticated;
grant select, insert, update, delete on public.evm_mappings to authenticated;
grant select, insert, update, delete on public.evm_reports to authenticated;
grant select, insert, delete on public.evm_report_lines to authenticated;
grant select, insert, update, delete on public.evm_progress_overrides to authenticated;
grant select, insert, delete on public.evm_exceptions to authenticated;
grant select, insert on public.evm_events to authenticated;

grant all on public.evm_settings to service_role;
grant all on public.evm_mapping_versions to service_role;
grant all on public.evm_mappings to service_role;
grant all on public.evm_reports to service_role;
grant all on public.evm_report_lines to service_role;
grant all on public.evm_progress_overrides to service_role;
grant all on public.evm_exceptions to service_role;
grant all on public.evm_events to service_role;

-- --------------------------------------------------------------------- RLS
alter table public.evm_settings enable row level security;
alter table public.evm_mapping_versions enable row level security;
alter table public.evm_mappings enable row level security;
alter table public.evm_reports enable row level security;
alter table public.evm_report_lines enable row level security;
alter table public.evm_progress_overrides enable row level security;
alter table public.evm_exceptions enable row level security;
alter table public.evm_events enable row level security;

create policy evm_settings_select on public.evm_settings
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_settings_write on public.evm_settings
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

create policy evm_mapping_versions_select on public.evm_mapping_versions
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_mapping_versions_insert on public.evm_mapping_versions
  for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'draft' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));
create policy evm_mapping_versions_update on public.evm_mapping_versions
  for update to authenticated
  using (public.is_company_member(company_id) and status <> 'superseded' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id));
create policy evm_mapping_versions_delete on public.evm_mapping_versions
  for delete to authenticated
  using (public.is_company_member(company_id) and status = 'draft' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

create policy evm_mappings_select on public.evm_mappings
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_mappings_write on public.evm_mappings
  for all to authenticated
  using (public.is_company_member(company_id)
    and exists (select 1 from public.evm_mapping_versions v
                 where v.id = mapping_version_id and v.status = 'draft'
                   and v.company_id = evm_mappings.company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and exists (select 1 from public.evm_mapping_versions v
                 where v.id = mapping_version_id and v.status = 'draft'
                   and v.company_id = evm_mappings.company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')));

create policy evm_reports_select on public.evm_reports
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_reports_insert on public.evm_reports
  for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'working' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));
create policy evm_reports_update on public.evm_reports
  for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id));
create policy evm_reports_delete on public.evm_reports
  for delete to authenticated
  using (public.is_company_member(company_id) and status = 'working' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

create policy evm_report_lines_select on public.evm_report_lines
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_report_lines_insert on public.evm_report_lines
  for insert to authenticated
  with check (public.is_company_member(company_id)
    and exists (select 1 from public.evm_reports r
                 where r.id = report_id and r.status = 'working'
                   and r.company_id = evm_report_lines.company_id));
create policy evm_report_lines_delete on public.evm_report_lines
  for delete to authenticated
  using (public.is_company_member(company_id)
    and exists (select 1 from public.evm_reports r
                 where r.id = report_id and r.status = 'working'
                   and r.company_id = evm_report_lines.company_id));

create policy evm_overrides_select on public.evm_progress_overrides
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_overrides_write on public.evm_progress_overrides
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

create policy evm_exceptions_select on public.evm_exceptions
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_exceptions_write on public.evm_exceptions
  for insert to authenticated with check (public.is_company_member(company_id));
create policy evm_exceptions_delete on public.evm_exceptions
  for delete to authenticated
  using (public.is_company_member(company_id)
    and exists (select 1 from public.evm_reports r
                 where r.id = report_id and r.status = 'working'
                   and r.company_id = evm_exceptions.company_id));

create policy evm_events_select on public.evm_events
  for select to authenticated using (public.is_company_member(company_id));
create policy evm_events_insert on public.evm_events
  for insert to authenticated
  with check (public.is_company_member(company_id) and actor_id = auth.uid());

-- ---------------------------------------------------------------- triggers
create or replace function public.evm_reports_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    -- Approved and superseded reports are frozen: only the supersession
    -- pointers may ever change afterwards.
    if old.status in ('approved','superseded') then
      if new.status = old.status
         and (new.totals is distinct from old.totals
              or new.data_date is distinct from old.data_date
              or new.reporting_currency is distinct from old.reporting_currency
              or new.fx_provenance is distinct from old.fx_provenance
              or new.ac_basis is distinct from old.ac_basis
              or new.official_eac_method is distinct from old.official_eac_method) then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
      if old.status = 'superseded' and new.status <> 'superseded' then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
      if old.status = 'approved' and new.status not in ('approved','superseded') then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
    end if;
    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.evm_reports_guard() from public, anon;

create trigger trg_evm_reports_guard
  before update on public.evm_reports
  for each row execute function public.evm_reports_guard();

create or replace function public.evm_mapping_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if new.label is distinct from old.label or new.note is distinct from old.note then
      raise exception 'evm_mapping_version_frozen' using errcode = '42501';
    end if;
  end if;
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.evm_mapping_versions_guard() from public, anon;

create trigger trg_evm_mapping_versions_guard
  before update on public.evm_mapping_versions
  for each row execute function public.evm_mapping_versions_guard();

create trigger trg_evm_settings_updated
  before update on public.evm_settings
  for each row execute function public.update_updated_at_column();

create trigger trg_evm_overrides_updated
  before update on public.evm_progress_overrides
  for each row execute function public.update_updated_at_column();
