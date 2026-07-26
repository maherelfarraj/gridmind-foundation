-- 0071_scada_hierarchy_tags.sql — asset hierarchy + tag dictionary. Idempotent.

do $$ begin
  create type public.asset_node_type as enum
    ('plant','site','block','inverter_station','inverter','transformer','switchgear',
     'meter','weather_station','bess_container','battery_rack','battery_module','string','sensor');
exception when duplicate_object then null; end $$;

create table if not exists public.asset_nodes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  parent_id uuid references public.asset_nodes(id) on delete set null,
  node_type public.asset_node_type not null,
  tag text,
  name text not null,
  equipment_id uuid references public.equipment_registry(id) on delete set null,
  scada_asset_id uuid references public.scada_assets(id) on delete set null,
  sort_order int not null default 0,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id <> id)
);
create unique index if not exists asset_nodes_project_tag_uq
  on public.asset_nodes(project_id, tag) where tag is not null;
create index if not exists asset_nodes_parent_idx on public.asset_nodes(parent_id);
create index if not exists asset_nodes_company_project_idx
  on public.asset_nodes(company_id, project_id, node_type);
create unique index if not exists asset_nodes_scada_asset_uq
  on public.asset_nodes(scada_asset_id) where scada_asset_id is not null;

create table if not exists public.tag_dictionary (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  asset_node_id uuid references public.asset_nodes(id) on delete cascade,
  tag text not null,
  metric text not null,
  description text,
  unit text not null,
  scaling_factor numeric(18,8) not null default 1,
  scaling_offset numeric(18,8) not null default 0,
  quality_flags jsonb not null default '["good","suspect","bad"]',
  alarm_lo_lo numeric,
  alarm_lo numeric,
  alarm_hi numeric,
  alarm_hi_hi numeric,
  alarm_deadband numeric not null default 0,
  raw_retention_days int not null default 395,
  downsample_interval text not null default '1 hour',
  enabled boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, tag)
);
create index if not exists tag_dictionary_node_idx on public.tag_dictionary(asset_node_id);
create index if not exists tag_dictionary_company_idx
  on public.tag_dictionary(company_id, project_id, enabled);

alter table public.asset_nodes enable row level security;
alter table public.tag_dictionary enable row level security;

drop policy if exists asset_nodes_select on public.asset_nodes;
create policy asset_nodes_select on public.asset_nodes for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists asset_nodes_write on public.asset_nodes;
create policy asset_nodes_write on public.asset_nodes for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));
drop policy if exists tag_dictionary_select on public.tag_dictionary;
create policy tag_dictionary_select on public.tag_dictionary for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists tag_dictionary_write on public.tag_dictionary;
create policy tag_dictionary_write on public.tag_dictionary for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

grant select, insert, update, delete on public.asset_nodes to authenticated;
grant select, insert, update, delete on public.tag_dictionary to authenticated;
grant all on public.asset_nodes to service_role;
grant all on public.tag_dictionary to service_role;

drop trigger if exists trg_asset_nodes_updated on public.asset_nodes;
create trigger trg_asset_nodes_updated before update on public.asset_nodes
  for each row execute function public.set_updated_at();
drop trigger if exists trg_tag_dictionary_updated on public.tag_dictionary;
create trigger trg_tag_dictionary_updated before update on public.tag_dictionary
  for each row execute function public.set_updated_at();

-- Backfill: one plant root per project that has SCADA assets
insert into public.asset_nodes (company_id, project_id, parent_id, node_type, tag, name)
select p.company_id, p.id, null, 'plant', null, p.name
from public.projects p
where exists (select 1 from public.scada_assets sa where sa.project_id = p.id)
  and not exists (select 1 from public.asset_nodes an
                  where an.project_id = p.id and an.node_type = 'plant' and an.parent_id is null);

-- Backfill: map existing scada_assets under the plant root
insert into public.asset_nodes
  (company_id, project_id, parent_id, node_type, tag, name, equipment_id, scada_asset_id)
select sa.company_id, sa.project_id, root.id,
  case sa.asset_type
    when 'inverter' then 'inverter'::public.asset_node_type
    when 'meter' then 'meter'::public.asset_node_type
    when 'weather_station' then 'weather_station'::public.asset_node_type
    when 'bess' then 'bess_container'::public.asset_node_type
    when 'combiner' then 'sensor'::public.asset_node_type
    when 'plant_controller' then 'sensor'::public.asset_node_type
    else 'sensor'::public.asset_node_type
  end,
  sa.asset_key, sa.name, sa.equipment_id, sa.id
from public.scada_assets sa
join public.asset_nodes root
  on root.project_id = sa.project_id and root.node_type = 'plant' and root.parent_id is null
where not exists (select 1 from public.asset_nodes an where an.scada_asset_id = sa.id)
  and not exists (select 1 from public.asset_nodes an2
                  where an2.project_id = sa.project_id and an2.tag = sa.asset_key);

-- Seed standard tags — inverters
insert into public.tag_dictionary (company_id, project_id, asset_node_id, tag, metric, unit)
select an.company_id, an.project_id, an.id, an.tag || '.' || m.metric, m.metric, m.unit
from public.asset_nodes an
cross join lateral (values
  ('ac_power_kw','kW'), ('dc_power_kw','kW'), ('energy_kwh','kWh')
) as m(metric, unit)
where an.node_type = 'inverter' and an.tag is not null
on conflict (project_id, tag) do nothing;

-- Seed standard tags — weather stations
insert into public.tag_dictionary (company_id, project_id, asset_node_id, tag, metric, unit)
select an.company_id, an.project_id, an.id, an.tag || '.' || m.metric, m.metric, m.unit
from public.asset_nodes an
cross join lateral (values
  ('irradiance_wm2','W/m2'), ('ambient_temp_c','degC'),
  ('module_temp_c','degC'), ('wind_speed_ms','m/s')
) as m(metric, unit)
where an.node_type = 'weather_station' and an.tag is not null
on conflict (project_id, tag) do nothing;

-- Seed standard tags — BESS containers
insert into public.tag_dictionary (company_id, project_id, asset_node_id, tag, metric, unit)
select an.company_id, an.project_id, an.id, an.tag || '.' || m.metric, m.metric, m.unit
from public.asset_nodes an
cross join lateral (values
  ('soc_pct','%'), ('soh_pct','%'), ('bess_power_kw','kW'), ('bess_energy_kwh','kWh')
) as m(metric, unit)
where an.node_type = 'bess_container' and an.tag is not null
on conflict (project_id, tag) do nothing;
