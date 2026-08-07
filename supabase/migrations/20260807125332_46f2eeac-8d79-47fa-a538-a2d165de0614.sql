-- GC-10 — Portfolio Finance Alerts & Escalations

create type public.portfolio_alert_rule_type as enum (
  'fx_missing',
  'forecast_stale',
  'eac_deterioration',
  'budget_breach',
  'commitment_breach',
  'actual_breach',
  'checklist_overdue',
  'exception_aging',
  'evidence_missing',
  'close_readiness',
  'period_reopened',
  'audit_gap'
);

create type public.portfolio_alert_severity as enum ('critical','high','medium','low');

create type public.portfolio_alert_state as enum ('open','acknowledged','snoozed','resolved');

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
create table public.portfolio_alert_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_type public.portfolio_alert_rule_type not null,
  enabled boolean not null default true,
  severity public.portfolio_alert_severity not null default 'medium',
  threshold_value numeric,
  threshold_unit text not null default 'count'
    check (threshold_unit in ('percent','ratio','days','count','currency')),
  lead_days integer not null default 5 check (lead_days between 0 and 90),
  ack_sla_hours integer not null default 48 check (ack_sla_hours between 1 and 720),
  notify_roles public.app_role[] not null default array['finance_admin','company_admin']::public.app_role[],
  escalate_roles public.app_role[] not null default array['company_admin']::public.app_role[],
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rule_type)
);

grant select, insert, update, delete on public.portfolio_alert_configs to authenticated;
grant all on public.portfolio_alert_configs to service_role;
alter table public.portfolio_alert_configs enable row level security;

create policy "pac_select" on public.portfolio_alert_configs
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "pac_write" on public.portfolio_alert_configs
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  );

create trigger trg_pac_updated before update on public.portfolio_alert_configs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Alert register (one live occurrence per fingerprint)
-- ---------------------------------------------------------------------------
create table public.portfolio_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  period_month date,
  rule_type public.portfolio_alert_rule_type not null,
  fingerprint text not null,
  severity public.portfolio_alert_severity not null default 'medium',
  status public.portfolio_alert_state not null default 'open',
  escalation_tier integer not null default 0 check (escalation_tier between 0 and 3),
  entity_table text,
  entity_id uuid,
  current_value numeric,
  threshold_value numeric,
  value_unit text not null default 'count'
    check (value_unit in ('percent','ratio','days','count','currency')),
  currency_code text check (currency_code is null or currency_code ~ '^[A-Z]{3}$'),
  owner_id uuid references public.profiles(id),
  title text not null,
  detail text,
  deep_link text,
  context jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrence_count integer not null default 1,
  reopen_count integer not null default 0,
  ack_due_at timestamptz,
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  snoozed_until timestamptz,
  escalated_at timestamptz,
  resolved_at timestamptz,
  next_evaluation_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fingerprint)
);

create index portfolio_alerts_status_idx on public.portfolio_alerts (company_id, status, severity, last_seen_at desc);
create index portfolio_alerts_period_idx on public.portfolio_alerts (company_id, period_month, rule_type);
create index portfolio_alerts_project_idx on public.portfolio_alerts (company_id, project_id, status);
create index portfolio_alerts_owner_idx on public.portfolio_alerts (owner_id, status) where owner_id is not null;
create index portfolio_alerts_next_eval_idx on public.portfolio_alerts (company_id, next_evaluation_at) where status <> 'resolved';
create index portfolio_alerts_ack_due_idx on public.portfolio_alerts (company_id, ack_due_at) where status = 'open';

grant select, insert, update on public.portfolio_alerts to authenticated;
grant all on public.portfolio_alerts to service_role;
alter table public.portfolio_alerts enable row level security;

create policy "pal_select" on public.portfolio_alerts
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('finance_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
      or owner_id = auth.uid()
      or (project_id is not null and exists (
            select 1 from public.project_members pm
            where pm.project_id = portfolio_alerts.project_id
              and pm.user_id = auth.uid()))
    )
  );

create policy "pal_insert" on public.portfolio_alerts
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  );

create policy "pal_update" on public.portfolio_alerts
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role)
         or owner_id = auth.uid())
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role)
         or owner_id = auth.uid())
  );

create trigger trg_pal_updated before update on public.portfolio_alerts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Append-only occurrence / lifecycle history
-- ---------------------------------------------------------------------------
create table public.portfolio_alert_events (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.portfolio_alerts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  event_type text not null check (event_type in
    ('created','seen','acknowledged','snoozed','escalated','resolved','reopened','notified','config_changed')),
  actor_id uuid references public.profiles(id),
  severity public.portfolio_alert_severity,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index portfolio_alert_events_alert_idx on public.portfolio_alert_events (alert_id, created_at desc);
create index portfolio_alert_events_company_idx on public.portfolio_alert_events (company_id, created_at desc);

grant select, insert on public.portfolio_alert_events to authenticated;
grant select, insert on public.portfolio_alert_events to service_role;
alter table public.portfolio_alert_events enable row level security;

create policy "pae_select" on public.portfolio_alert_events
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role)
         or exists (select 1 from public.portfolio_alerts a
                    where a.id = portfolio_alert_events.alert_id
                      and a.owner_id = auth.uid()))
  );

create policy "pae_insert" on public.portfolio_alert_events
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (select 1 from public.portfolio_alerts a
                where a.id = portfolio_alert_events.alert_id
                  and a.company_id = portfolio_alert_events.company_id)
  );

-- ---------------------------------------------------------------------------
-- Concurrency guard for the scheduled evaluator
-- ---------------------------------------------------------------------------
create or replace function public.portfolio_alerts_try_lock(p_company_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public
as $$
  select pg_try_advisory_xact_lock(
    hashtext('portfolio_alerts'), hashtext(p_company_id::text)
  );
$$;

revoke all on function public.portfolio_alerts_try_lock(uuid) from public;
revoke all on function public.portfolio_alerts_try_lock(uuid) from anon;
revoke all on function public.portfolio_alerts_try_lock(uuid) from authenticated;
grant execute on function public.portfolio_alerts_try_lock(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Safe defaults for every existing company
-- ---------------------------------------------------------------------------
insert into public.portfolio_alert_configs
  (company_id, rule_type, severity, threshold_value, threshold_unit, lead_days, ack_sla_hours)
select c.id, d.rule_type, d.severity, d.threshold_value, d.threshold_unit, d.lead_days, d.ack_sla_hours
from public.companies c
cross join (values
  ('fx_missing'::public.portfolio_alert_rule_type,        'critical'::public.portfolio_alert_severity, null::numeric, 'count',    0,  24),
  ('forecast_stale',      'high',     45,   'days',    5,  48),
  ('eac_deterioration',   'high',     0.05, 'percent', 0,  48),
  ('budget_breach',       'critical', 1.00, 'ratio',   0,  24),
  ('commitment_breach',   'high',     0.95, 'ratio',   0,  48),
  ('actual_breach',       'medium',   0.90, 'ratio',   0,  72),
  ('checklist_overdue',   'high',     0,    'days',    3,  48),
  ('exception_aging',     'high',     7,    'days',    0,  48),
  ('evidence_missing',    'medium',   0,    'count',   3,  72),
  ('close_readiness',     'high',     null, 'count',   5,  48),
  ('period_reopened',     'critical', null, 'count',   0,  24),
  ('audit_gap',           'medium',   0,    'count',   0,  72)
) as d(rule_type, severity, threshold_value, threshold_unit, lead_days, ack_sla_hours)
on conflict (company_id, rule_type) do nothing;
