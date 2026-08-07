-- GC-15 — Governed Revenue, WIP and Percentage-of-Completion Recognition.
-- Non-posting control layer. Reuses costing/EVM/cash-flow governance patterns.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'recognition_snapshot_status') then
    create type public.recognition_snapshot_status as enum ('working','submitted','approved','superseded');
  end if;
  if not exists (select 1 from pg_type where typname = 'recognition_method') then
    create type public.recognition_method as enum
      ('cost_to_cost','milestone','output','straight_line','completed_contract','manual');
  end if;
  if not exists (select 1 from pg_type where typname = 'recognition_obligation_status') then
    create type public.recognition_obligation_status as enum ('draft','active','closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'recognition_adjustment_status') then
    create type public.recognition_adjustment_status as enum ('draft','approved','void');
  end if;
end $$;

-- ---------------------------------------------------------------- settings
create table if not exists public.recognition_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null unique references public.projects(id) on delete cascade,
  default_method public.recognition_method not null default 'cost_to_cost',
  policy_version text not null default 'v1',
  constraint_pct numeric(6,3) not null default 0 check (constraint_pct between 0 and 100),
  include_unapproved_variations boolean not null default false,
  include_unapproved_claims boolean not null default false,
  loss_provision_enabled boolean not null default true,
  cap_progress_at_100 boolean not null default true,
  allow_revenue_reversal boolean not null default false,
  retention_pct numeric(6,3) not null default 0 check (retention_pct between 0 and 100),
  advance_recovery_pct numeric(6,3) not null default 0 check (advance_recovery_pct between 0 and 100),
  reporting_currency text references public.currencies(code),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.recognition_settings to authenticated;
grant all on public.recognition_settings to service_role;
alter table public.recognition_settings enable row level security;

-- ------------------------------------------------------------ obligations
create table if not exists public.recognition_obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  code text not null,
  name text not null,
  method public.recognition_method not null default 'cost_to_cost',
  progress_basis text not null default 'cost'
    check (progress_basis in ('cost','evm','milestone','output','time','manual')),
  allocation_amount numeric(18,2) not null default 0 check (allocation_amount >= 0),
  standalone_value numeric(18,2),
  currency_code text not null references public.currencies(code),
  start_date date,
  end_date date,
  milestones jsonb not null default '[]'::jsonb,
  constraint_pct numeric(6,3) not null default 0 check (constraint_pct between 0 and 100),
  is_loss_making boolean not null default false,
  retention_pct numeric(6,3) not null default 0 check (retention_pct between 0 and 100),
  advance_amount numeric(18,2) not null default 0 check (advance_amount >= 0),
  advance_recovery_pct numeric(6,3) not null default 0 check (advance_recovery_pct between 0 and 100),
  tax_treatment text not null default 'exclusive'
    check (tax_treatment in ('exclusive','inclusive','exempt')),
  status public.recognition_obligation_status not null default 'draft',
  notes text,
  row_version integer not null default 1,
  version_no integer not null default 1,
  supersedes_id uuid references public.recognition_obligations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code),
  constraint recognition_obligations_window
    check (end_date is null or start_date is null or end_date >= start_date)
);
grant select, insert, update, delete on public.recognition_obligations to authenticated;
grant all on public.recognition_obligations to service_role;
alter table public.recognition_obligations enable row level security;
create index if not exists recognition_obligations_project_idx
  on public.recognition_obligations (project_id, status, code);
create index if not exists recognition_obligations_contract_idx
  on public.recognition_obligations (contract_id);

-- --------------------------------------------------------------- snapshots
create table if not exists public.recognition_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  data_date date not null,
  billing_cutoff date not null,
  status public.recognition_snapshot_status not null default 'working',
  row_version integer not null default 1,
  version_no integer not null default 1,
  method public.recognition_method not null default 'cost_to_cost',
  policy_version text not null default 'v1',
  reporting_currency text not null references public.currencies(code),
  project_currency text not null references public.currencies(code),
  forecast_version_id uuid references public.forecast_versions(id) on delete set null,
  evm_report_id uuid references public.evm_reports(id) on delete set null,
  contract_basis jsonb not null default '{}'::jsonb,
  fx_provenance jsonb not null default '{}'::jsonb,
  inclusion_rules jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  supersedes_id uuid references public.recognition_snapshots(id) on delete set null,
  superseded_by_id uuid references public.recognition_snapshots(id) on delete set null,
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
  constraint recognition_snapshots_period_month
    check (date_trunc('month', period_month::timestamptz)::date = period_month)
);
grant select, insert, update, delete on public.recognition_snapshots to authenticated;
grant all on public.recognition_snapshots to service_role;
alter table public.recognition_snapshots enable row level security;
create unique index if not exists recognition_snapshots_active_idx
  on public.recognition_snapshots (project_id, period_month)
  where status <> 'superseded';
create index if not exists recognition_snapshots_lookup_idx
  on public.recognition_snapshots (company_id, period_month, status);
create index if not exists recognition_snapshots_project_idx
  on public.recognition_snapshots (project_id, period_month desc, version_no desc);

-- ------------------------------------------------------------------- lines
create table if not exists public.recognition_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null references public.recognition_snapshots(id) on delete cascade,
  obligation_id uuid references public.recognition_obligations(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  cost_code_id uuid references public.cost_codes(id) on delete set null,
  label text not null,
  method public.recognition_method not null default 'cost_to_cost',
  currency_code text not null references public.currencies(code),
  fx_rate numeric(18,8),
  fx_rate_date date,
  fx_source text,
  fx_stale boolean not null default false,
  transaction_price numeric(18,2) not null default 0,
  approved_variations numeric(18,2) not null default 0,
  constrained_consideration numeric(18,2) not null default 0,
  cost_incurred numeric(18,2) not null default 0,
  cost_to_complete numeric(18,2) not null default 0,
  eac numeric(18,2) not null default 0,
  progress_pct numeric(9,6) not null default 0,
  cumulative_revenue numeric(18,2) not null default 0,
  prior_revenue numeric(18,2) not null default 0,
  period_revenue numeric(18,2) not null default 0,
  gross_profit numeric(18,2) not null default 0,
  loss_provision numeric(18,2) not null default 0,
  billed_to_date numeric(18,2) not null default 0,
  cash_received numeric(18,2) not null default 0,
  contract_asset numeric(18,2) not null default 0,
  contract_liability numeric(18,2) not null default 0,
  retention_receivable numeric(18,2) not null default 0,
  advance_balance numeric(18,2) not null default 0,
  unbilled_receivable numeric(18,2) not null default 0,
  remaining_revenue numeric(18,2) not null default 0,
  cumulative_revenue_reporting numeric(18,2) not null default 0,
  period_revenue_reporting numeric(18,2) not null default 0,
  contract_asset_reporting numeric(18,2) not null default 0,
  contract_liability_reporting numeric(18,2) not null default 0,
  provenance jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.recognition_snapshot_lines to authenticated;
grant all on public.recognition_snapshot_lines to service_role;
alter table public.recognition_snapshot_lines enable row level security;
create index if not exists recognition_lines_snapshot_idx
  on public.recognition_snapshot_lines (snapshot_id, sort_order);
create index if not exists recognition_lines_obligation_idx
  on public.recognition_snapshot_lines (obligation_id);
create index if not exists recognition_lines_contract_idx
  on public.recognition_snapshot_lines (snapshot_id, contract_id);

-- ------------------------------------------------------------- adjustments
create table if not exists public.recognition_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  obligation_id uuid references public.recognition_obligations(id) on delete set null,
  effective_period date not null,
  kind text not null default 'revenue'
    check (kind in ('revenue','cost','progress','constraint','loss_provision','retention','advance')),
  amount numeric(18,2) not null,
  currency_code text not null references public.currencies(code),
  reason text not null check (length(btrim(reason)) >= 8),
  evidence_reference text,
  status public.recognition_adjustment_status not null default 'draft',
  row_version integer not null default 1,
  version_no integer not null default 1,
  supersedes_id uuid references public.recognition_adjustments(id) on delete set null,
  prepared_by uuid references auth.users(id) on delete set null,
  authorized_by uuid references auth.users(id) on delete set null,
  authorized_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognition_adjustments_effective_month
    check (date_trunc('month', effective_period::timestamptz)::date = effective_period)
);
grant select, insert, update, delete on public.recognition_adjustments to authenticated;
grant all on public.recognition_adjustments to service_role;
alter table public.recognition_adjustments enable row level security;
create index if not exists recognition_adjustments_project_idx
  on public.recognition_adjustments (project_id, effective_period desc, status);

-- -------------------------------------------------------------- exceptions
create table if not exists public.recognition_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null references public.recognition_snapshots(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  code text not null,
  severity public.costing_exception_severity not null default 'warning',
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.recognition_exceptions to authenticated;
grant all on public.recognition_exceptions to service_role;
alter table public.recognition_exceptions enable row level security;
create index if not exists recognition_exceptions_snapshot_idx
  on public.recognition_exceptions (snapshot_id, severity, code);

-- ------------------------------------------------------------------ events
create table if not exists public.recognition_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  snapshot_id uuid references public.recognition_snapshots(id) on delete cascade,
  entity_type text not null default 'snapshot',
  entity_id uuid,
  event_type text not null,
  from_status text,
  to_status text,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.recognition_events to authenticated;
grant all on public.recognition_events to service_role;
alter table public.recognition_events enable row level security;
create index if not exists recognition_events_project_idx
  on public.recognition_events (project_id, created_at desc);
create index if not exists recognition_events_snapshot_idx
  on public.recognition_events (snapshot_id, created_at desc);

-- ---------------------------------------------------------------- policies
drop policy if exists recognition_settings_select on public.recognition_settings;
create policy recognition_settings_select on public.recognition_settings for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_settings_write on public.recognition_settings;
create policy recognition_settings_write on public.recognition_settings for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists recognition_obligations_select on public.recognition_obligations;
create policy recognition_obligations_select on public.recognition_obligations for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_obligations_write on public.recognition_obligations;
create policy recognition_obligations_write on public.recognition_obligations for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists recognition_snapshots_select on public.recognition_snapshots;
create policy recognition_snapshots_select on public.recognition_snapshots for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_snapshots_insert on public.recognition_snapshots;
create policy recognition_snapshots_insert on public.recognition_snapshots for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists recognition_snapshots_update on public.recognition_snapshots;
create policy recognition_snapshots_update on public.recognition_snapshots for update to authenticated
  using (public.is_company_member(company_id) and status <> 'superseded'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists recognition_snapshots_delete on public.recognition_snapshots;
create policy recognition_snapshots_delete on public.recognition_snapshots for delete to authenticated
  using (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists recognition_lines_select on public.recognition_snapshot_lines;
create policy recognition_lines_select on public.recognition_snapshot_lines for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_lines_write on public.recognition_snapshot_lines;
create policy recognition_lines_write on public.recognition_snapshot_lines for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.recognition_snapshots s
                where s.id = snapshot_id and s.company_id = recognition_snapshot_lines.company_id
                  and s.status in ('working','submitted')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.recognition_snapshots s
                where s.id = snapshot_id and s.company_id = recognition_snapshot_lines.company_id
                  and s.status in ('working','submitted')));

drop policy if exists recognition_exceptions_select on public.recognition_exceptions;
create policy recognition_exceptions_select on public.recognition_exceptions for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_exceptions_write on public.recognition_exceptions;
create policy recognition_exceptions_write on public.recognition_exceptions for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists recognition_adjustments_select on public.recognition_adjustments;
create policy recognition_adjustments_select on public.recognition_adjustments for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_adjustments_insert on public.recognition_adjustments;
create policy recognition_adjustments_insert on public.recognition_adjustments for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'draft'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists recognition_adjustments_update on public.recognition_adjustments;
create policy recognition_adjustments_update on public.recognition_adjustments for update to authenticated
  using (public.is_company_member(company_id) and status <> 'void'
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));
drop policy if exists recognition_adjustments_delete on public.recognition_adjustments;
create policy recognition_adjustments_delete on public.recognition_adjustments for delete to authenticated
  using (public.is_company_member(company_id) and status = 'draft'
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists recognition_events_select on public.recognition_events;
create policy recognition_events_select on public.recognition_events for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists recognition_events_insert on public.recognition_events;
create policy recognition_events_insert on public.recognition_events for insert to authenticated
  with check (public.is_company_member(company_id));

-- ---------------------------------------------------------------- triggers
create or replace function public.recognition_snapshots_guard()
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
              or new.billing_cutoff is distinct from old.billing_cutoff
              or new.method is distinct from old.method
              or new.policy_version is distinct from old.policy_version
              or new.reporting_currency is distinct from old.reporting_currency
              or new.project_currency is distinct from old.project_currency
              or new.fx_provenance is distinct from old.fx_provenance
              or new.inclusion_rules is distinct from old.inclusion_rules
              or new.contract_basis is distinct from old.contract_basis
              or new.forecast_version_id is distinct from old.forecast_version_id
              or new.evm_report_id is distinct from old.evm_report_id) then
        raise exception 'recognition_snapshot_frozen' using errcode = '42501';
      end if;
      if old.status = 'superseded' and new.status <> 'superseded' then
        raise exception 'recognition_snapshot_frozen' using errcode = '42501';
      end if;
      if old.status = 'approved' and new.status not in ('approved','superseded') then
        raise exception 'recognition_snapshot_frozen' using errcode = '42501';
      end if;
    end if;

    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.approved_by is null then
        raise exception 'recognition_approver_required' using errcode = '42501';
      end if;
      if new.approved_by = coalesce(new.submitted_by, old.submitted_by)
         or new.approved_by = coalesce(new.prepared_by, old.prepared_by) then
        raise exception 'recognition_self_approval' using errcode = '42501';
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
revoke all on function public.recognition_snapshots_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_recognition_snapshots_guard on public.recognition_snapshots;
create trigger trg_recognition_snapshots_guard
  before update on public.recognition_snapshots
  for each row execute function public.recognition_snapshots_guard();

create or replace function public.recognition_lines_frozen_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status public.recognition_snapshot_status;
begin
  select s.status into v_status
    from public.recognition_snapshots s
   where s.id = coalesce(new.snapshot_id, old.snapshot_id);
  if v_status in ('approved','superseded') then
    raise exception 'recognition_line_frozen' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$fn$;
revoke all on function public.recognition_lines_frozen_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_recognition_lines_frozen on public.recognition_snapshot_lines;
create trigger trg_recognition_lines_frozen
  before insert or update or delete on public.recognition_snapshot_lines
  for each row execute function public.recognition_lines_frozen_guard();

create or replace function public.recognition_adjustments_guard()
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
            or new.kind is distinct from old.kind
            or new.obligation_id is distinct from old.obligation_id
            or new.effective_period is distinct from old.effective_period
            or new.reason is distinct from old.reason) then
      raise exception 'recognition_adjustment_frozen' using errcode = '42501';
    end if;
    if old.status = 'void' and new.status <> 'void' then
      raise exception 'recognition_adjustment_frozen' using errcode = '42501';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.authorized_by is null then
        raise exception 'recognition_authorizer_required' using errcode = '42501';
      end if;
      if new.authorized_by = coalesce(new.prepared_by, old.prepared_by) then
        raise exception 'recognition_self_authorization' using errcode = '42501';
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
revoke all on function public.recognition_adjustments_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_recognition_adjustments_guard on public.recognition_adjustments;
create trigger trg_recognition_adjustments_guard
  before update on public.recognition_adjustments
  for each row execute function public.recognition_adjustments_guard();

create or replace function public.recognition_obligations_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end;
$fn$;
revoke all on function public.recognition_obligations_version() from public, anon, authenticated, service_role;
drop trigger if exists trg_recognition_obligations_version on public.recognition_obligations;
create trigger trg_recognition_obligations_version
  before update on public.recognition_obligations
  for each row execute function public.recognition_obligations_version();

create or replace function public.recognition_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'recognition_events_append_only' using errcode = '42501';
end;
$fn$;
revoke all on function public.recognition_events_append_only() from public, anon, authenticated, service_role;
drop trigger if exists trg_recognition_events_append_only on public.recognition_events;
create trigger trg_recognition_events_append_only
  before update or delete on public.recognition_events
  for each row execute function public.recognition_events_append_only();

-- ------------------------------------------------------------ alert kinds
alter type public.portfolio_alert_rule_type add value if not exists 'revenue_margin_erosion';
alter type public.portfolio_alert_rule_type add value if not exists 'revenue_loss_making';
alter type public.portfolio_alert_rule_type add value if not exists 'recognition_basis_stale';
alter type public.portfolio_alert_rule_type add value if not exists 'wip_underbilling_age';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_liability_movement';
alter type public.portfolio_alert_rule_type add value if not exists 'unapproved_variation_exposure';