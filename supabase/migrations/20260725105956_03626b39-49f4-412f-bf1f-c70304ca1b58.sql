create table if not exists public.scada_telemetry (
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  scada_asset_id uuid not null references public.scada_assets(id) on delete cascade,
  ts timestamptz not null,
  metric text not null,
  value numeric not null,
  quality text not null default 'good',
  created_at timestamptz not null default now(),
  primary key (scada_asset_id, metric, ts),
  constraint scada_telemetry_metric_chk check (metric in (
    'ac_power_kw','dc_power_kw','energy_kwh','irradiance_wm2',
    'ambient_temp_c','module_temp_c','wind_speed_ms','soc_pct'
  )),
  constraint scada_telemetry_quality_chk check (quality in ('good','suspect','bad'))
);

grant select on public.scada_telemetry to authenticated;
grant all on public.scada_telemetry to service_role;

alter table public.scada_telemetry enable row level security;

create policy telemetry_select on public.scada_telemetry
  for select to authenticated
  using (public.is_company_member(company_id));

create index if not exists telemetry_project_ts_idx on public.scada_telemetry(project_id, ts desc);
create index if not exists telemetry_asset_ts_idx on public.scada_telemetry(scada_asset_id, ts desc);

comment on table public.scada_telemetry is
  'High-volume SCADA time-series (raw 1-minute samples). Retention: raw kept 13 months, then downsampled by the retention/rollup job (B14/P-135). Writes flow ONLY through the guarded ingestion hook using the service role; no INSERT/UPDATE/DELETE grants to authenticated. TimescaleDB-style partitioning note: when hypertables are unavailable (stock Supabase Postgres), upgrade path is declarative RANGE partitioning on ts with monthly partitions (scada_telemetry_YYYYMM) plus a default partition; keep (scada_asset_id, metric, ts) as the partition-local PK. Batch inserts only.';