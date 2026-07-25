
-- P-105 alarm rules engine
do $$ begin
  create type alarm_severity as enum ('info','warning','major','critical');
exception when duplicate_object then null; end $$;
do $$ begin
  create type alarm_condition as enum ('gt','gte','lt','lte','eq','ne');
exception when duplicate_object then null; end $$;
do $$ begin
  create type alarm_status as enum ('active','acknowledged','cleared');
exception when duplicate_object then null; end $$;

create table if not exists public.alarm_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  name text not null,
  metric text not null,
  condition alarm_condition not null,
  threshold numeric not null,
  dead_band numeric not null default 0,
  duration_seconds int not null default 0,
  severity alarm_severity not null default 'warning',
  escalation_route jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scada_alarms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  scada_asset_id uuid references public.scada_assets(id) on delete set null,
  rule_id uuid references public.alarm_rules(id) on delete set null,
  severity alarm_severity not null,
  message text not null,
  value numeric,
  status alarm_status not null default 'active',
  raised_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  acknowledged_at timestamptz,
  acknowledge_note text,
  cleared_at timestamptz,
  escalation_level int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.alarm_rules to authenticated;
grant insert, update, delete on public.alarm_rules to authenticated;
grant all on public.alarm_rules to service_role;

grant select on public.scada_alarms to authenticated;
grant update on public.scada_alarms to authenticated;  -- ack only; raises are service-side
grant all on public.scada_alarms to service_role;

alter table public.alarm_rules enable row level security;
alter table public.scada_alarms enable row level security;

create policy alarm_rules_select on public.alarm_rules
  for select to authenticated
  using (public.is_company_member(company_id));

create policy alarm_rules_write on public.alarm_rules
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('om_admin'::app_role)
    or public.has_company_role('scada_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  ))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('om_admin'::app_role)
    or public.has_company_role('scada_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  ));

create policy alarms_select on public.scada_alarms
  for select to authenticated
  using (public.is_company_member(company_id));

create policy alarms_write on public.scada_alarms
  for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('om_admin'::app_role)
    or public.has_company_role('scada_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  ))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('om_admin'::app_role)
    or public.has_company_role('scada_admin'::app_role)
    or public.has_company_role('company_admin'::app_role)
  ));

create index if not exists alarms_company_status_idx
  on public.scada_alarms(company_id, status, severity, raised_at desc);
create index if not exists alarms_project_idx
  on public.scada_alarms(project_id, raised_at desc);
create index if not exists alarms_active_rule_asset_idx
  on public.scada_alarms(rule_id, scada_asset_id) where status = 'active';
create index if not exists alarm_rules_company_idx
  on public.alarm_rules(company_id, enabled);

drop trigger if exists set_alarm_rules_updated_at on public.alarm_rules;
create trigger set_alarm_rules_updated_at
  before update on public.alarm_rules
  for each row execute function public.set_updated_at();

drop trigger if exists set_scada_alarms_updated_at on public.scada_alarms;
create trigger set_scada_alarms_updated_at
  before update on public.scada_alarms
  for each row execute function public.set_updated_at();
