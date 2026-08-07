-- GC-16 — Governed Contract & Claims Control.
-- Non-posting control layer. Mirrors GC-15 governance patterns.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'cc_claim_status') then
    create type public.cc_claim_status as enum
      ('draft','notified','submitted','under_assessment','assessed','negotiation','approved','rejected','certified','paid','closed','withdrawn');
  end if;
  if not exists (select 1 from pg_type where typname = 'cc_claim_kind') then
    create type public.cc_claim_kind as enum
      ('variation','eot','prolongation','disruption','acceleration','ld_defence','termination','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'cc_deadline_kind') then
    create type public.cc_deadline_kind as enum
      ('notice','submission','response','determination','instrument_expiry','limitation','retention_release','back_to_back');
  end if;
  if not exists (select 1 from pg_type where typname = 'cc_deadline_status') then
    create type public.cc_deadline_status as enum ('open','met','missed','waived','superseded');
  end if;
  if not exists (select 1 from pg_type where typname = 'cc_snapshot_status') then
    create type public.cc_snapshot_status as enum ('working','submitted','approved','superseded');
  end if;
  if not exists (select 1 from pg_type where typname = 'cc_alert_state') then
    create type public.cc_alert_state as enum ('open','acknowledged','snoozed','escalated','resolved');
  end if;
end $$;

-- ------------------------------------------------------------------ claims
create table if not exists public.contract_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  claim_ref text not null,
  title text not null,
  kind public.cc_claim_kind not null default 'variation',
  status public.cc_claim_status not null default 'draft',
  clause_ref text,
  entitlement_basis text,
  cause text,
  effect text,
  mitigation text,
  quantum_basis text,
  is_back_to_back boolean not null default false,
  back_to_back_ref text,
  currency_code text not null references public.currencies(code),
  asserted_amount numeric(18,2) not null default 0,
  submitted_amount numeric(18,2) not null default 0,
  assessed_amount numeric(18,2) not null default 0,
  approved_amount numeric(18,2) not null default 0,
  forecast_amount numeric(18,2) not null default 0,
  certified_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  at_risk_amount numeric(18,2) not null default 0,
  eot_days_claimed integer not null default 0 check (eot_days_claimed >= 0),
  eot_days_assessed integer not null default 0 check (eot_days_assessed >= 0),
  eot_days_approved integer not null default 0 check (eot_days_approved >= 0),
  ld_exposure numeric(18,2) not null default 0,
  event_date date,
  awareness_date date,
  notice_due_at date,
  notice_served_at date,
  submission_due_at date,
  submitted_at date,
  response_due_at date,
  responded_at date,
  limitation_at date,
  owner_id uuid references auth.users(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  row_version integer not null default 1,
  version_no integer not null default 1,
  supersedes_id uuid references public.contract_claims(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  certified_by uuid references auth.users(id) on delete set null,
  certified_at timestamptz,
  closed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, claim_ref)
);
grant select, insert, update, delete on public.contract_claims to authenticated;
grant all on public.contract_claims to service_role;
alter table public.contract_claims enable row level security;
create index if not exists contract_claims_project_idx
  on public.contract_claims (project_id, status, updated_at desc);
create index if not exists contract_claims_company_idx
  on public.contract_claims (company_id, status);
create index if not exists contract_claims_contract_idx
  on public.contract_claims (contract_id);

-- ------------------------------------------------------------ claim events
create table if not exists public.contract_claim_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  claim_id uuid references public.contract_claims(id) on delete cascade,
  entity_type text not null default 'claim',
  entity_id uuid,
  event_type text not null,
  from_status text,
  to_status text,
  occurred_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
grant select, insert on public.contract_claim_events to authenticated;
grant all on public.contract_claim_events to service_role;
alter table public.contract_claim_events enable row level security;
create index if not exists contract_claim_events_claim_idx
  on public.contract_claim_events (claim_id, occurred_at desc);
create index if not exists contract_claim_events_project_idx
  on public.contract_claim_events (project_id, created_at desc);

-- -------------------------------------------------------- claim valuations
create table if not exists public.contract_claim_valuations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  claim_id uuid not null references public.contract_claims(id) on delete cascade,
  effective_period date not null,
  valuation_no integer not null default 1,
  basis text not null default 'assessed',
  currency_code text not null references public.currencies(code),
  amount numeric(18,2) not null default 0,
  probability_pct numeric(6,3) not null default 100 check (probability_pct between 0 and 100),
  expected_amount numeric(18,2) not null default 0,
  fx_rate numeric(18,8),
  fx_rate_date date,
  fx_source text,
  reason text not null check (length(btrim(reason)) >= 8),
  prepared_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (claim_id, effective_period, valuation_no),
  constraint contract_claim_valuations_month
    check (date_trunc('month', effective_period::timestamptz)::date = effective_period)
);
grant select, insert, update, delete on public.contract_claim_valuations to authenticated;
grant all on public.contract_claim_valuations to service_role;
alter table public.contract_claim_valuations enable row level security;
create index if not exists contract_claim_valuations_claim_idx
  on public.contract_claim_valuations (claim_id, effective_period desc, valuation_no desc);

-- ---------------------------------------------------------------- deadlines
create table if not exists public.contract_deadlines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete set null,
  claim_id uuid references public.contract_claims(id) on delete cascade,
  kind public.cc_deadline_kind not null,
  label text not null,
  clause_ref text,
  trigger_date date not null,
  duration_days integer not null default 0,
  calendar text not null default 'calendar' check (calendar in ('calendar','business')),
  timezone text not null default 'UTC',
  due_date date not null,
  status public.cc_deadline_status not null default 'open',
  satisfied_at date,
  owner_id uuid references auth.users(id) on delete set null,
  evidence_reference text,
  row_version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.contract_deadlines to authenticated;
grant all on public.contract_deadlines to service_role;
alter table public.contract_deadlines enable row level security;
create index if not exists contract_deadlines_project_idx
  on public.contract_deadlines (project_id, status, due_date);
create index if not exists contract_deadlines_claim_idx
  on public.contract_deadlines (claim_id, due_date);
create index if not exists contract_deadlines_company_idx
  on public.contract_deadlines (company_id, status, due_date);

-- ---------------------------------------------------------------- snapshots
create table if not exists public.contract_claim_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_month date not null,
  data_date date not null,
  status public.cc_snapshot_status not null default 'working',
  reporting_currency text not null references public.currencies(code),
  project_currency text not null references public.currencies(code),
  policy_version text not null default 'v1',
  totals jsonb not null default '{}'::jsonb,
  fx_provenance jsonb not null default '{}'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  checksum text,
  row_version integer not null default 1,
  version_no integer not null default 1,
  supersedes_id uuid references public.contract_claim_snapshots(id) on delete set null,
  superseded_by_id uuid references public.contract_claim_snapshots(id) on delete set null,
  correction_reason text,
  prepared_by uuid references auth.users(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contract_claim_snapshots_month
    check (date_trunc('month', period_month::timestamptz)::date = period_month)
);
grant select, insert, update, delete on public.contract_claim_snapshots to authenticated;
grant all on public.contract_claim_snapshots to service_role;
alter table public.contract_claim_snapshots enable row level security;
create unique index if not exists contract_claim_snapshots_active_idx
  on public.contract_claim_snapshots (project_id, period_month)
  where status <> 'superseded';
create index if not exists contract_claim_snapshots_project_idx
  on public.contract_claim_snapshots (project_id, period_month desc, version_no desc);
create index if not exists contract_claim_snapshots_lookup_idx
  on public.contract_claim_snapshots (company_id, period_month, status);

create table if not exists public.contract_claim_snapshot_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  snapshot_id uuid not null references public.contract_claim_snapshots(id) on delete cascade,
  claim_id uuid references public.contract_claims(id) on delete set null,
  contract_id uuid references public.contracts(id) on delete set null,
  label text not null,
  kind public.cc_claim_kind not null default 'variation',
  status public.cc_claim_status not null default 'draft',
  currency_code text not null references public.currencies(code),
  fx_rate numeric(18,8),
  fx_rate_date date,
  fx_source text,
  fx_stale boolean not null default false,
  asserted_amount numeric(18,2) not null default 0,
  submitted_amount numeric(18,2) not null default 0,
  assessed_amount numeric(18,2) not null default 0,
  approved_amount numeric(18,2) not null default 0,
  forecast_amount numeric(18,2) not null default 0,
  certified_amount numeric(18,2) not null default 0,
  paid_amount numeric(18,2) not null default 0,
  at_risk_amount numeric(18,2) not null default 0,
  exposure_amount numeric(18,2) not null default 0,
  exposure_reporting numeric(18,2) not null default 0,
  eot_days_approved integer not null default 0,
  provenance jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.contract_claim_snapshot_lines to authenticated;
grant all on public.contract_claim_snapshot_lines to service_role;
alter table public.contract_claim_snapshot_lines enable row level security;
create index if not exists contract_claim_lines_snapshot_idx
  on public.contract_claim_snapshot_lines (snapshot_id, sort_order);
create index if not exists contract_claim_lines_claim_idx
  on public.contract_claim_snapshot_lines (claim_id);

-- ------------------------------------------------------------------ alerts
create table if not exists public.contract_claim_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  claim_id uuid references public.contract_claims(id) on delete cascade,
  deadline_id uuid references public.contract_deadlines(id) on delete cascade,
  dedupe_key text not null,
  kind text not null,
  severity public.costing_exception_severity not null default 'warning',
  title text not null,
  message text not null,
  state public.cc_alert_state not null default 'open',
  owner_id uuid references auth.users(id) on delete set null,
  due_at date,
  snoozed_until date,
  escalated_at timestamptz,
  acknowledged_by uuid references auth.users(id) on delete set null,
  acknowledged_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  reopened_at timestamptz,
  evidence_link text,
  context jsonb not null default '{}'::jsonb,
  occurrences integer not null default 1,
  last_seen_at timestamptz not null default now(),
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);
grant select, insert, update, delete on public.contract_claim_alerts to authenticated;
grant all on public.contract_claim_alerts to service_role;
alter table public.contract_claim_alerts enable row level security;
create index if not exists contract_claim_alerts_state_idx
  on public.contract_claim_alerts (company_id, state, severity, due_at);
create index if not exists contract_claim_alerts_project_idx
  on public.contract_claim_alerts (project_id, state);

-- ---------------------------------------------------------------- policies
drop policy if exists contract_claims_select on public.contract_claims;
create policy contract_claims_select on public.contract_claims for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claims_insert on public.contract_claims;
create policy contract_claims_insert on public.contract_claims for insert to authenticated
  with check (public.is_company_member(company_id) and status in ('draft','notified')
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists contract_claims_update on public.contract_claims;
create policy contract_claims_update on public.contract_claims for update to authenticated
  using (public.is_company_member(company_id) and status not in ('closed','paid')
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists contract_claims_delete on public.contract_claims;
create policy contract_claims_delete on public.contract_claims for delete to authenticated
  using (public.is_company_member(company_id) and status = 'draft'
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists contract_claim_events_select on public.contract_claim_events;
create policy contract_claim_events_select on public.contract_claim_events for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claim_events_insert on public.contract_claim_events;
create policy contract_claim_events_insert on public.contract_claim_events for insert to authenticated
  with check (public.is_company_member(company_id));

drop policy if exists contract_claim_valuations_select on public.contract_claim_valuations;
create policy contract_claim_valuations_select on public.contract_claim_valuations for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claim_valuations_write on public.contract_claim_valuations;
create policy contract_claim_valuations_write on public.contract_claim_valuations for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists contract_deadlines_select on public.contract_deadlines;
create policy contract_deadlines_select on public.contract_deadlines for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_deadlines_write on public.contract_deadlines;
create policy contract_deadlines_write on public.contract_deadlines for all to authenticated
  using (public.is_company_member(company_id) and status <> 'superseded'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists contract_claim_snapshots_select on public.contract_claim_snapshots;
create policy contract_claim_snapshots_select on public.contract_claim_snapshots for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claim_snapshots_insert on public.contract_claim_snapshots;
create policy contract_claim_snapshots_insert on public.contract_claim_snapshots for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists contract_claim_snapshots_update on public.contract_claim_snapshots;
create policy contract_claim_snapshots_update on public.contract_claim_snapshots for update to authenticated
  using (public.is_company_member(company_id) and status <> 'superseded'
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin')));
drop policy if exists contract_claim_snapshots_delete on public.contract_claim_snapshots;
create policy contract_claim_snapshots_delete on public.contract_claim_snapshots for delete to authenticated
  using (public.is_company_member(company_id) and status = 'working'
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists contract_claim_lines_select on public.contract_claim_snapshot_lines;
create policy contract_claim_lines_select on public.contract_claim_snapshot_lines for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claim_lines_write on public.contract_claim_snapshot_lines;
create policy contract_claim_lines_write on public.contract_claim_snapshot_lines for all to authenticated
  using (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.contract_claim_snapshots s
                where s.id = snapshot_id and s.company_id = contract_claim_snapshot_lines.company_id
                  and s.status in ('working','submitted')))
  with check (public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('project_admin') or public.has_company_role('company_admin'))
    and exists (select 1 from public.contract_claim_snapshots s
                where s.id = snapshot_id and s.company_id = contract_claim_snapshot_lines.company_id
                  and s.status in ('working','submitted')));

drop policy if exists contract_claim_alerts_select on public.contract_claim_alerts;
create policy contract_claim_alerts_select on public.contract_claim_alerts for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists contract_claim_alerts_write on public.contract_claim_alerts;
create policy contract_claim_alerts_write on public.contract_claim_alerts for all to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ----------------------------------------------------------------- guards
create or replace function public.contract_claims_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.status in ('closed','paid') then
    raise exception 'contract_claim_immutable' using errcode = '42501';
  end if;
  if new.row_version <> old.row_version then
    raise exception 'contract_claim_stale_write' using errcode = '40001';
  end if;
  if old.status = 'approved' and new.status = 'approved'
     and new.approved_amount is distinct from old.approved_amount then
    raise exception 'contract_claim_approved_amount_locked' using errcode = '42501';
  end if;
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end;
$fn$;
revoke all on function public.contract_claims_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_claims_guard on public.contract_claims;
create trigger trg_contract_claims_guard
  before update on public.contract_claims
  for each row execute function public.contract_claims_guard();

create or replace function public.contract_claim_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  raise exception 'contract_claim_events_append_only' using errcode = '42501';
end;
$fn$;
revoke all on function public.contract_claim_events_append_only() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_claim_events_append_only on public.contract_claim_events;
create trigger trg_contract_claim_events_append_only
  before update or delete on public.contract_claim_events
  for each row execute function public.contract_claim_events_append_only();

create or replace function public.contract_claim_valuations_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    perform public.assert_costing_period_open(new.company_id, new.project_id, new.effective_period);
    return new;
  end if;
  raise exception 'contract_claim_valuation_immutable' using errcode = '42501';
end;
$fn$;
revoke all on function public.contract_claim_valuations_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_claim_valuations_guard on public.contract_claim_valuations;
create trigger trg_contract_claim_valuations_guard
  before insert or update or delete on public.contract_claim_valuations
  for each row execute function public.contract_claim_valuations_guard();

create or replace function public.contract_deadlines_version()
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
revoke all on function public.contract_deadlines_version() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_deadlines_version on public.contract_deadlines;
create trigger trg_contract_deadlines_version
  before update on public.contract_deadlines
  for each row execute function public.contract_deadlines_version();

create or replace function public.contract_claim_snapshots_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if old.status = 'superseded' then
    raise exception 'contract_claim_snapshot_immutable' using errcode = '42501';
  end if;
  if old.status = 'approved' and new.status = 'approved'
     and (new.totals is distinct from old.totals or new.checksum is distinct from old.checksum) then
    raise exception 'contract_claim_snapshot_frozen' using errcode = '42501';
  end if;
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end;
$fn$;
revoke all on function public.contract_claim_snapshots_guard() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_claim_snapshots_guard on public.contract_claim_snapshots;
create trigger trg_contract_claim_snapshots_guard
  before update on public.contract_claim_snapshots
  for each row execute function public.contract_claim_snapshots_guard();

create or replace function public.contract_claim_alerts_version()
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
revoke all on function public.contract_claim_alerts_version() from public, anon, authenticated, service_role;
drop trigger if exists trg_contract_claim_alerts_version on public.contract_claim_alerts;
create trigger trg_contract_claim_alerts_version
  before update on public.contract_claim_alerts
  for each row execute function public.contract_claim_alerts_version();

-- ------------------------------------------------------------ alert kinds
alter type public.portfolio_alert_rule_type add value if not exists 'claim_notice_approaching';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_notice_missed';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_response_overdue';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_aging';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_quantum_movement';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_entitlement_gap';
alter type public.portfolio_alert_rule_type add value if not exists 'claim_eot_ld_conflict';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_instrument_expiring';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_retention_release_due';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_back_to_back_gap';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_fx_materiality';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_reconciliation_break';
alter type public.portfolio_alert_rule_type add value if not exists 'contract_sod_exception';