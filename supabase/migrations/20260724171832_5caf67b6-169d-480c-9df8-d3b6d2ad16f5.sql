-- 0019_yield_scenarios.sql — multi-scenario yield & PVsyst configs

-- project_yield_config -------------------------------------------------
alter table public.project_yield_config
  add column if not exists scenario_name text not null default 'Base';

alter table public.project_yield_config
  add column if not exists params jsonb not null default '{}'::jsonb;

alter table public.project_yield_config
  add column if not exists results jsonb not null default '{}'::jsonb;

-- Backfill results jsonb from legacy scalar columns (idempotent).
update public.project_yield_config
   set results = coalesce(results, '{}'::jsonb)
                 || jsonb_strip_nulls(jsonb_build_object(
                      'p50_mwh', p50_mwh,
                      'p90_mwh', p90_mwh,
                      'losses_pct', losses_pct,
                      'degradation_pct', degradation_pct,
                      'availability_pct', availability_pct,
                      'ghi_kwh_m2', ghi_kwh_m2
                    ))
 where results = '{}'::jsonb
   and (p50_mwh is not null or p90_mwh is not null or losses_pct is not null);

alter table public.project_yield_config
  drop constraint if exists project_yield_config_project_id_key;

create unique index if not exists project_yield_config_project_scenario_uniq
  on public.project_yield_config(project_id, scenario_name);

-- project_pvsyst_config ------------------------------------------------
alter table public.project_pvsyst_config
  add column if not exists scenario_name text not null default 'Base';

alter table public.project_pvsyst_config
  add column if not exists params jsonb not null default '{}'::jsonb;

alter table public.project_pvsyst_config
  drop constraint if exists project_pvsyst_config_project_id_key;

create unique index if not exists project_pvsyst_config_project_scenario_uniq
  on public.project_pvsyst_config(project_id, scenario_name);