-- Enums (guarded)
do $$ begin
  create type equipment_type as enum ('inverter','module_string','tracker','transformer','meter','weather_station','bess_container','battery_rack','pcs','switchgear','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type equipment_status as enum ('active','inactive','spare','decommissioned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scada_asset_type as enum ('inverter','meter','weather_station','plant_controller','bess','combiner');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scada_connector_type as enum ('modbus_tcp','iec61850','sunspec','mqtt','vendor_api','csv_import');
exception when duplicate_object then null; end $$;

do $$ begin
  create type scada_connector_status as enum ('active','disabled','error');
exception when duplicate_object then null; end $$;

-- equipment_registry
create table if not exists public.equipment_registry (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  tag text not null,
  equipment_type equipment_type not null,
  manufacturer text,
  model text,
  serial_number text,
  nameplate_capacity_kw numeric(12,3),
  install_date date,
  commissioning_date date,
  warranty_end_date date,
  status equipment_status not null default 'active',
  location_text text,
  specs jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, tag)
);

grant select, insert, update, delete on public.equipment_registry to authenticated;
grant all on public.equipment_registry to service_role;
alter table public.equipment_registry enable row level security;

create policy equipment_select on public.equipment_registry
  for select to authenticated
  using (public.is_company_member(company_id));
create policy equipment_write on public.equipment_registry
  for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

create index if not exists equipment_company_project_idx on public.equipment_registry(company_id, project_id, equipment_type);

drop trigger if exists equipment_registry_set_updated_at on public.equipment_registry;
create trigger equipment_registry_set_updated_at
  before update on public.equipment_registry
  for each row execute function public.set_updated_at();

-- scada_assets
create table if not exists public.scada_assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_id uuid references public.equipment_registry(id) on delete set null,
  asset_type scada_asset_type not null,
  asset_key text not null,
  name text not null,
  site_label text,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, asset_key)
);

grant select, insert, update, delete on public.scada_assets to authenticated;
grant all on public.scada_assets to service_role;
alter table public.scada_assets enable row level security;

create policy scada_assets_select on public.scada_assets
  for select to authenticated
  using (public.is_company_member(company_id));
create policy scada_assets_write on public.scada_assets
  for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

create index if not exists scada_assets_project_idx on public.scada_assets(project_id, asset_type);
create index if not exists scada_assets_equipment_idx on public.scada_assets(equipment_id);

drop trigger if exists scada_assets_set_updated_at on public.scada_assets;
create trigger scada_assets_set_updated_at
  before update on public.scada_assets
  for each row execute function public.set_updated_at();

-- scada_connectors
create table if not exists public.scada_connectors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  name text not null,
  connector_type scada_connector_type not null,
  config jsonb not null default '{}',
  enabled boolean not null default false,
  status scada_connector_status not null default 'disabled',
  last_seen_at timestamptz,
  last_error text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

grant select, insert, update, delete on public.scada_connectors to authenticated;
grant all on public.scada_connectors to service_role;
alter table public.scada_connectors enable row level security;

create policy connectors_select on public.scada_connectors
  for select to authenticated
  using (public.is_company_member(company_id));
create policy connectors_write on public.scada_connectors
  for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin') or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

create index if not exists connectors_project_idx on public.scada_connectors(project_id, enabled);

drop trigger if exists scada_connectors_set_updated_at on public.scada_connectors;
create trigger scada_connectors_set_updated_at
  before update on public.scada_connectors
  for each row execute function public.set_updated_at();