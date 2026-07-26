alter table public.pv_site_configs drop constraint if exists pv_site_configs_status_check;
alter table public.pv_site_configs add constraint pv_site_configs_status_check
  check (status = any (array['draft','active','approved','superseded']));

alter table public.pv_site_configs drop constraint if exists pv_site_configs_weather_source_check;
alter table public.pv_site_configs add constraint pv_site_configs_weather_source_check
  check (weather_source = any (array['typical_year','pvgis','nasa_power','meteonorm','solargis','custom_tmy']));

create unique index if not exists pv_site_configs_one_active_per_project
  on public.pv_site_configs (project_id) where status = 'active';

create unique index if not exists pv_site_configs_project_name_key
  on public.pv_site_configs (project_id, name);