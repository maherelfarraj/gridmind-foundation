-- 0080_finance_alerts.sql — P-199 finance alert rules + generated alerts.
do $$ begin
  create type public.finance_alert_rule_type as enum
    ('overdue_invoice_days','ar_aging_threshold','unbilled_certified_value','payment_unmatched_days');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.finance_alert_status as enum ('open','acknowledged','dismissed');
exception when duplicate_object then null; end $$;

create table if not exists public.finance_alert_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rule_type public.finance_alert_rule_type not null,
  threshold jsonb not null default '{}',
  enabled boolean not null default true,
  notify_role public.app_role not null default 'finance_admin',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rule_type)
);

create table if not exists public.finance_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rule_id uuid not null references public.finance_alert_rules(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  alert_date date not null default current_date,
  severity text not null default 'warning',
  message text not null,
  status public.finance_alert_status not null default 'open',
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, entity_type, entity_id, alert_date)
);

alter table public.finance_alert_rules enable row level security;
alter table public.finance_alerts enable row level security;

drop policy if exists fa_rules_select on public.finance_alert_rules;
create policy fa_rules_select on public.finance_alert_rules for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists fa_rules_write on public.finance_alert_rules;
create policy fa_rules_write on public.finance_alert_rules for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists fa_alerts_select on public.finance_alerts;
create policy fa_alerts_select on public.finance_alerts for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists fa_alerts_insert on public.finance_alerts;
create policy fa_alerts_insert on public.finance_alerts for insert to authenticated
  with check (public.is_company_member(company_id));
drop policy if exists fa_alerts_update on public.finance_alerts;
create policy fa_alerts_update on public.finance_alerts for update to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

grant select on public.finance_alert_rules, public.finance_alerts to authenticated;
grant insert, update on public.finance_alert_rules, public.finance_alerts to authenticated;
grant all on public.finance_alert_rules, public.finance_alerts to service_role;

drop trigger if exists trg_fa_rules_updated on public.finance_alert_rules;
create trigger trg_fa_rules_updated before update on public.finance_alert_rules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_fa_alerts_updated on public.finance_alerts;
create trigger trg_fa_alerts_updated before update on public.finance_alerts
  for each row execute function public.set_updated_at();

create index if not exists fa_alerts_company_idx on public.finance_alerts(company_id, status, alert_date desc);
create index if not exists fa_alerts_entity_idx on public.finance_alerts(entity_type, entity_id);