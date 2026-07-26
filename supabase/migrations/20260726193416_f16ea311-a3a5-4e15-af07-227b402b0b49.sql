do $$ begin
  create type public.scada_event_type as enum
    ('event','warning','trip','comm_failure','status_change','operator_action',
     'setpoint_change','maintenance','protection');
exception when duplicate_object then null; end $$;

create table if not exists public.scada_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  asset_node_id uuid references public.asset_nodes(id) on delete set null,
  scada_asset_id uuid references public.scada_assets(id) on delete set null,
  event_type public.scada_event_type not null default 'event',
  severity public.alarm_severity not null default 'info',
  code text,
  message text not null,
  payload jsonb not null default '{}',
  source text not null default 'scada',
  actor_id uuid references public.profiles(id),
  occurred_at timestamptz not null default now(),
  dedupe_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists scada_events_dedupe_uq
  on public.scada_events(project_id, dedupe_key) where dedupe_key is not null;
create index if not exists scada_events_project_ts_idx
  on public.scada_events(project_id, occurred_at desc);
create index if not exists scada_events_company_type_idx
  on public.scada_events(company_id, event_type, severity, occurred_at desc);
create index if not exists scada_events_node_idx
  on public.scada_events(asset_node_id, occurred_at desc);

alter table public.scada_events enable row level security;
drop policy if exists scada_events_select on public.scada_events;
create policy scada_events_select on public.scada_events for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists scada_events_write on public.scada_events;
create policy scada_events_write on public.scada_events for insert to authenticated
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));
grant select, insert on public.scada_events to authenticated;
grant all on public.scada_events to service_role;

create or replace view public.v_meter_daily_energy
with (security_invoker = true) as
select t.company_id, t.project_id, t.scada_asset_id,
  date_trunc('day', t.ts)::date as day,
  max(t.value) - min(t.value) as energy_kwh
from public.scada_telemetry t
where t.metric = 'energy_kwh'
group by 1, 2, 3, 4;

create or replace view public.v_weather_daily
with (security_invoker = true) as
select t.company_id, t.project_id,
  date_trunc('day', t.ts)::date as day,
  avg(t.value) filter (where t.metric = 'irradiance_wm2')  as avg_irradiance_wm2,
  sum(t.value) filter (where t.metric = 'irradiance_wm2')  as irradiance_sample_sum,
  avg(t.value) filter (where t.metric = 'ambient_temp_c')  as avg_ambient_temp_c,
  avg(t.value) filter (where t.metric = 'module_temp_c')   as avg_module_temp_c,
  avg(t.value) filter (where t.metric = 'wind_speed_ms')   as avg_wind_speed_ms
from public.scada_telemetry t
where t.metric in ('irradiance_wm2','ambient_temp_c','module_temp_c','wind_speed_ms')
group by 1, 2, 3;

create or replace view public.v_bess_daily
with (security_invoker = true) as
select t.company_id, t.project_id, t.scada_asset_id,
  date_trunc('day', t.ts)::date as day,
  avg(t.value) filter (where t.metric = 'soc_pct') as avg_soc_pct,
  min(t.value) filter (where t.metric = 'soc_pct') as min_soc_pct,
  max(t.value) filter (where t.metric = 'soc_pct') as max_soc_pct,
  (array_agg(t.value order by t.ts desc) filter (where t.metric = 'soh_pct'))[1] as latest_soh_pct
from public.scada_telemetry t
where t.metric in ('soc_pct','soh_pct')
group by 1, 2, 3, 4;

create or replace view public.v_curtailment_daily
with (security_invoker = true) as
select t.company_id, t.project_id,
  date_trunc('day', t.ts)::date as day,
  avg(t.value) filter (where t.metric = 'curtailment_kw') as avg_curtailment_kw,
  max(t.value) filter (where t.metric = 'curtailment_kw') as max_curtailment_kw,
  avg(t.value) filter (where t.metric = 'setpoint_kw')    as avg_setpoint_kw
from public.scada_telemetry t
where t.metric in ('curtailment_kw','setpoint_kw')
group by 1, 2, 3;

grant select on public.v_meter_daily_energy, public.v_weather_daily,
  public.v_bess_daily, public.v_curtailment_daily to authenticated;