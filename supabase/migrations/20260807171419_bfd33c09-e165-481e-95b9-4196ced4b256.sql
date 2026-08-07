-- GC-13 — Governed Project & Portfolio Cash Flow, Funding and Liquidity.
-- Non-posting control layer. Reuses costing/EVM governance patterns.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'cashflow_snapshot_status') then
    create type public.cashflow_snapshot_status as enum ('working','submitted','approved','superseded');
  end if;
  if not exists (select 1 from pg_type where typname = 'cashflow_bucket_granularity') then
    create type public.cashflow_bucket_granularity as enum ('month','week');
  end if;
  if not exists (select 1 from pg_type where typname = 'cashflow_source') then
    create type public.cashflow_source as enum
      ('actual','invoice','commitment','accrual','forecast','retention','advance','tax','adjustment');
  end if;
  if not exists (select 1 from pg_type where typname = 'cashflow_date_basis') then
    create type public.cashflow_date_basis as enum
      ('actual','due_date','payment_terms','milestone','phasing','fallback');
  end if;
  if not exists (select 1 from pg_type where typname = 'cashflow_adjustment_status') then
    create type public.cashflow_adjustment_status as enum ('draft','approved','void');
  end if;
  if not exists (select 1 from pg_type where typname = 'funding_facility_status') then
    create type public.funding_facility_status as enum ('planned','active','expired','cancelled');
  end if;
end $$;

-- ---------------------------------------------------------------- settings
create table if not exists public.cashflow_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete cascade,
  bucket_granularity public.cashflow_bucket_granularity not null default 'month',
  horizon_buckets integer not null default 24 check (horizon_buckets between 1 and 156),
  receipt_lag_days integer not null default 30 check (receipt_lag_days between 0 and 365),
  payment_lag_days integer not null default 45 check (payment_lag_days between 0 and 365),
  retention_release_lag_days integer not null default 90 check (retention_release_lag_days between 0 and 1095),
  advance_recovery_pct numeric(6,3) not null default 0 check (advance_recovery_pct between 0 and 100),
  include_tax boolean not null default false,
  include_commitments boolean not null default true,
  include_accruals boolean not null default true,
  min_liquidity_amount numeric(18,2) not null default 0 check (min_liquidity_amount >= 0),
  opening_cash numeric(18,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cashflow_settings to authenticated;
grant all on public.cashflow_settings to service_role;
alter table public.cashflow_settings enable row level security;

-- --------------------------------------------------------------- snapshots
create table if not exists public.cashflow_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  data_date date not null,
  status public.cashflow_snapshot_status not null default 'working',
  row_version integer not null default 1,
  version_no integer not null default 1,
  bucket_granularity public.cashflow_bucket_granularity not null default 'month',
  horizon_buckets integer not null default 24,
  reporting_currency text not null references public.currencies(code),
  project_currency text not null references public.currencies(code),
  forecast_version_id uuid references public.forecast_versions(id) on delete set null,
  evm_report_id uuid references public.evm_reports(id) on delete set null,
  schedule_baseline_id uuid references public.baseline_snapshots(id) on delete set null,
  fx_provenance jsonb not null default '{}'::jsonb,
  inclusion_rules jsonb not null default '{}'::jsonb,
  opening_cash numeric(18,2) not null default 0,
  totals jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.cashflow_snapshots(id) on delete set null,
  superseded_by_id uuid references public.cashflow_snapshots(id) on delete set null,
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
  constraint cashflow_snapshots_period_month
    check (date_trunc('month', period_month::timestamptz)::date = period_month)
);
grant select, insert, update, delete on public.cashflow_snapshots to authenticated;
grant all on public.cashflow_snapshots to service_role;
alter table public.cashflow_snapshots enable row level security;

create unique index if not exists cashflow_snapshots_active_idx
  on public.cashflow_snapshots (project_id, period_month)
  where status <> 'superseded';
create index if not exists cashflow_snapshots_lookup_idx
  on public.cashflow_snapshots (company_id, period_month, status);
create index if not exists cashflow_snapshots_project_idx
  on public.cashflow_snapshots (project_id, period_month desc, version_no desc);

-- ------------------------------------------------------------------- lines
create table if not exists public.cashflow_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null references public.cashflow_snapshots(id) on delete cascade,
  bucket_start date not null,
  bucket_end date not null,
  direction public.cash_flow_direction not null,
  source public.cashflow_source not null,
  category text not null default 'other',
  counterparty text,
  cost_code_id uuid references public.cost_codes(id) on delete set null,
  amount_native numeric(18,2) not null,
  currency_code text not null references public.currencies(code),
  fx_rate numeric(18,8),
  fx_rate_date date,
  fx_source text,
  fx_stale boolean not null default false,
  amount_reporting numeric(18,2) not null,
  date_basis public.cashflow_date_basis not null default 'phasing',
  reference_type text,
  reference_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint cashflow_lines_bucket_order check (bucket_end >= bucket_start)
);
grant select, insert, update, delete on public.cashflow_snapshot_lines to authenticated;
grant all on public.cashflow_snapshot_lines to service_role;
alter table public.cashflow_snapshot_lines enable row level security;

create index if not exists cashflow_lines_snapshot_idx
  on public.cashflow_snapshot_lines (snapshot_id, bucket_start, sort_order);
create index if not exists cashflow_lines_source_idx
  on public.cashflow_snapshot_lines (snapshot_id, source, direction);
create index if not exists cashflow_lines_cost_code_idx
  on public.cashflow_snapshot_lines (snapshot_id, cost_code_id);

-- -------------------------------------------------------------- exceptions
create table if not exists public.cashflow_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null references public.cashflow_snapshots(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  severity public.costing_exception_severity not null default 'warning',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.cashflow_exceptions to authenticated;
grant all on public.cashflow_exceptions to service_role;
alter table public.cashflow_exceptions enable row level security;
create index if not exists cashflow_exceptions_snapshot_idx
  on public.cashflow_exceptions (snapshot_id, severity, code);

-- ------------------------------------------------------------- adjustments
create table if not exists public.cashflow_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  effective_period date not null,
  bucket_date date not null,
  direction public.cash_flow_direction not null,
  category text not null default 'other',
  counterparty text,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  reason text not null check (length(btrim(reason)) >= 8),
  evidence_reference text,
  status public.cashflow_adjustment_status not null default 'draft',
  row_version integer not null default 1,
  version_no integer not null default 1,
  supersedes_id uuid references public.cashflow_adjustments(id) on delete set null,
  prepared_by uuid references auth.users(id) on delete set null,
  authorized_by uuid references auth.users(id) on delete set null,
  authorized_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cashflow_adjustments_effective_month
    check (date_trunc('month', effective_period::timestamptz)::date = effective_period)
);
grant select, insert, update, delete on public.cashflow_adjustments to authenticated;
grant all on public.cashflow_adjustments to service_role;
alter table public.cashflow_adjustments enable row level security;
create index if not exists cashflow_adjustments_project_idx
  on public.cashflow_adjustments (project_id, effective_period, status);
create index if not exists cashflow_adjustments_company_idx
  on public.cashflow_adjustments (company_id, status, bucket_date);

-- -------------------------------------------------------- funding facilities
create table if not exists public.funding_facilities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  bank_facility_id uuid references public.bank_facilities(id) on delete set null,
  name text not null,
  lender_name text,
  facility_kind text not null default 'revolving'
    check (facility_kind in ('revolving','term','bridge','equity','overdraft','guarantee','other')),
  committed_amount numeric(18,2) not null check (committed_amount >= 0),
  currency_code text not null references public.currencies(code),
  available_from date,
  expiry_date date,
  drawdown_schedule jsonb not null default '[]'::jsonb,
  repayment_schedule jsonb not null default '[]'::jsonb,
  fee_assumptions jsonb not null default '{}'::jsonb,
  covenants jsonb not null default '[]'::jsonb,
  status public.funding_facility_status not null default 'planned',
  notes text,
  row_version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_facilities_window check (expiry_date is null or available_from is null or expiry_date >= available_from)
);
grant select, insert, update, delete on public.funding_facilities to authenticated;
grant all on public.funding_facilities to service_role;
alter table public.funding_facilities enable row level security;
create index if not exists funding_facilities_company_idx
  on public.funding_facilities (company_id, status, expiry_date);

create table if not exists public.funding_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  facility_id uuid not null references public.funding_facilities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  allocated_amount numeric(18,2) not null check (allocated_amount >= 0),
  currency_code text not null references public.currencies(code),
  effective_from date,
  effective_to date,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (facility_id, project_id),
  constraint funding_allocations_window check (effective_to is null or effective_from is null or effective_to >= effective_from)
);
grant select, insert, update, delete on public.funding_allocations to authenticated;
grant all on public.funding_allocations to service_role;
alter table public.funding_allocations enable row level security;
create index if not exists funding_allocations_project_idx
  on public.funding_allocations (project_id, facility_id);

-- ------------------------------------------------------------------ events
create table if not exists public.cashflow_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  snapshot_id uuid references public.cashflow_snapshots(id) on delete cascade,
  entity_type text not null default 'snapshot',
  entity_id uuid,
  event_type text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.cashflow_events to authenticated;
grant all on public.cashflow_events to service_role;
alter table public.cashflow_events enable row level security;
create index if not exists cashflow_events_project_idx
  on public.cashflow_events (project_id, created_at desc);
create index if not exists cashflow_events_snapshot_idx
  on public.cashflow_events (snapshot_id, created_at desc);

-- ---------------------------------------------------------------- policies
drop policy if exists cashflow_settings_select on public.cashflow_settings;
create policy cashflow_settings_select on public.cashflow_settings for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_settings_write on public.cashflow_settings;
create policy cashflow_settings_write on public.cashflow_settings for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists cashflow_snapshots_select on public.cashflow_snapshots;
create policy cashflow_snapshots_select on public.cashflow_snapshots for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_snapshots_insert on public.cashflow_snapshots;
create policy cashflow_snapshots_insert on public.cashflow_snapshots for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists cashflow_snapshots_update on public.cashflow_snapshots;
create policy cashflow_snapshots_update on public.cashflow_snapshots for update to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id));
drop policy if exists cashflow_snapshots_delete on public.cashflow_snapshots;
create policy cashflow_snapshots_delete on public.cashflow_snapshots for delete to authenticated
  using (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists cashflow_lines_select on public.cashflow_snapshot_lines;
create policy cashflow_lines_select on public.cashflow_snapshot_lines for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_lines_write on public.cashflow_snapshot_lines;
create policy cashflow_lines_write on public.cashflow_snapshot_lines for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.cashflow_snapshots s
                where s.id = snapshot_id and s.company_id = cashflow_snapshot_lines.company_id
                  and s.status in ('working','submitted')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.cashflow_snapshots s
                where s.id = snapshot_id and s.company_id = cashflow_snapshot_lines.company_id
                  and s.status in ('working','submitted')));

drop policy if exists cashflow_exceptions_select on public.cashflow_exceptions;
create policy cashflow_exceptions_select on public.cashflow_exceptions for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_exceptions_write on public.cashflow_exceptions;
create policy cashflow_exceptions_write on public.cashflow_exceptions for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists cashflow_adjustments_select on public.cashflow_adjustments;
create policy cashflow_adjustments_select on public.cashflow_adjustments for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_adjustments_insert on public.cashflow_adjustments;
create policy cashflow_adjustments_insert on public.cashflow_adjustments for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'draft'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists cashflow_adjustments_update on public.cashflow_adjustments;
create policy cashflow_adjustments_update on public.cashflow_adjustments for update to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id));
drop policy if exists cashflow_adjustments_delete on public.cashflow_adjustments;
create policy cashflow_adjustments_delete on public.cashflow_adjustments for delete to authenticated
  using (public.is_company_member(company_id) and status = 'draft'
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists funding_facilities_select on public.funding_facilities;
create policy funding_facilities_select on public.funding_facilities for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists funding_facilities_write on public.funding_facilities;
create policy funding_facilities_write on public.funding_facilities for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists funding_allocations_select on public.funding_allocations;
create policy funding_allocations_select on public.funding_allocations for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists funding_allocations_write on public.funding_allocations;
create policy funding_allocations_write on public.funding_allocations for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists cashflow_events_select on public.cashflow_events;
create policy cashflow_events_select on public.cashflow_events for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists cashflow_events_insert on public.cashflow_events;
create policy cashflow_events_insert on public.cashflow_events for insert to authenticated
  with check (public.is_company_member(company_id));

-- ---------------------------------------------------------------- routines
create or replace function public.cashflow_snapshots_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('approved','superseded') then
      if new.status = old.status
         and (new.totals is distinct from old.totals
              or new.data_date is distinct from old.data_date
              or new.opening_cash is distinct from old.opening_cash
              or new.reporting_currency is distinct from old.reporting_currency
              or new.fx_provenance is distinct from old.fx_provenance
              or new.inclusion_rules is distinct from old.inclusion_rules
              or new.bucket_granularity is distinct from old.bucket_granularity
              or new.forecast_version_id is distinct from old.forecast_version_id) then
        raise exception 'cashflow_snapshot_frozen' using errcode = '42501';
      end if;
      if old.status = 'superseded' and new.status <> 'superseded' then
        raise exception 'cashflow_snapshot_frozen' using errcode = '42501';
      end if;
      if old.status = 'approved' and new.status not in ('approved','superseded') then
        raise exception 'cashflow_snapshot_frozen' using errcode = '42501';
      end if;
    end if;

    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.approved_by is null then
        raise exception 'cashflow_approver_required' using errcode = '42501';
      end if;
      if new.approved_by = coalesce(new.submitted_by, old.submitted_by)
         or new.approved_by = coalesce(new.prepared_by, old.prepared_by) then
        raise exception 'cashflow_self_approval' using errcode = '42501';
      end if;
      perform public.assert_costing_period_open(
        new.company_id, new.project_id, coalesce(new.period_month, old.period_month)
      );
    end if;

    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;
revoke all on function public.cashflow_snapshots_guard() from public, anon, authenticated;

create or replace function public.cashflow_adjustments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'approved' and new.status = 'approved'
       and (new.amount is distinct from old.amount
            or new.currency_code is distinct from old.currency_code
            or new.direction is distinct from old.direction
            or new.bucket_date is distinct from old.bucket_date
            or new.effective_period is distinct from old.effective_period
            or new.reason is distinct from old.reason) then
      raise exception 'cashflow_adjustment_frozen' using errcode = '42501';
    end if;
    if old.status = 'void' and new.status <> 'void' then
      raise exception 'cashflow_adjustment_frozen' using errcode = '42501';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.authorized_by is null then
        raise exception 'cashflow_authorizer_required' using errcode = '42501';
      end if;
      if new.authorized_by = coalesce(new.prepared_by, old.prepared_by) then
        raise exception 'cashflow_self_authorization' using errcode = '42501';
      end if;
      perform public.assert_costing_period_open(
        new.company_id, new.project_id, coalesce(new.effective_period, old.effective_period)
      );
    end if;
    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$fn$;
revoke all on function public.cashflow_adjustments_guard() from public, anon, authenticated;

create or replace function public.cashflow_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'cashflow_events_append_only' using errcode = '42501';
end;
$fn$;
revoke all on function public.cashflow_events_append_only() from public, anon, authenticated;

drop trigger if exists trg_cashflow_snapshots_guard on public.cashflow_snapshots;
create trigger trg_cashflow_snapshots_guard
  before update on public.cashflow_snapshots
  for each row execute function public.cashflow_snapshots_guard();

drop trigger if exists trg_cashflow_adjustments_guard on public.cashflow_adjustments;
create trigger trg_cashflow_adjustments_guard
  before update on public.cashflow_adjustments
  for each row execute function public.cashflow_adjustments_guard();

drop trigger if exists trg_cashflow_events_append_only on public.cashflow_events;
create trigger trg_cashflow_events_append_only
  before update or delete on public.cashflow_events
  for each row execute function public.cashflow_events_append_only();

drop trigger if exists cashflow_settings_set_updated_at on public.cashflow_settings;
create trigger cashflow_settings_set_updated_at before update on public.cashflow_settings
  for each row execute function public.set_updated_at();
drop trigger if exists funding_facilities_set_updated_at on public.funding_facilities;
create trigger funding_facilities_set_updated_at before update on public.funding_facilities
  for each row execute function public.set_updated_at();
drop trigger if exists funding_allocations_set_updated_at on public.funding_allocations;
create trigger funding_allocations_set_updated_at before update on public.funding_allocations
  for each row execute function public.set_updated_at();

revoke all on public.cashflow_settings from anon;
revoke all on public.cashflow_snapshots from anon;
revoke all on public.cashflow_snapshot_lines from anon;
revoke all on public.cashflow_exceptions from anon;
revoke all on public.cashflow_adjustments from anon;
revoke all on public.funding_facilities from anon;
revoke all on public.funding_allocations from anon;
revoke all on public.cashflow_events from anon;