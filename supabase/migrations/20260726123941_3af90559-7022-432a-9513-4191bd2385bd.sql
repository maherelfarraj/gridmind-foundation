-- 0063_pv_equipment_library.sql — P-149 (Batch 17)

create table if not exists public.equipment_library (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null check (category in (
    'pv_module','inverter','transformer','battery','pcs',
    'tracker','combiner','cable','switchgear','meter')),
  manufacturer text not null,
  model text not null,
  series text,
  specs jsonb not null default '{}'::jsonb,
  certifications text[] not null default '{}',
  datasheet_url text,
  warranty_years numeric,
  country_of_origin text,
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, category, manufacturer, model)
);

create index if not exists equipment_library_company_cat_idx
  on public.equipment_library (company_id, category, is_active);

grant select, insert, update, delete on public.equipment_library to authenticated;
grant all on public.equipment_library to service_role;
alter table public.equipment_library enable row level security;

drop policy if exists equipment_library_select on public.equipment_library;
create policy equipment_library_select on public.equipment_library
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists equipment_library_insert on public.equipment_library;
create policy equipment_library_insert on public.equipment_library
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  );

drop policy if exists equipment_library_update on public.equipment_library;
create policy equipment_library_update on public.equipment_library
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  );

drop policy if exists equipment_library_delete on public.equipment_library;
create policy equipment_library_delete on public.equipment_library
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('company_admin'::app_role))
  );

drop trigger if exists equipment_library_touch on public.equipment_library;
create trigger equipment_library_touch before update on public.equipment_library
  for each row execute function public.update_updated_at_column();

-- site configurations -------------------------------------------------------

create table if not exists public.pv_site_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  boundary jsonb not null default '{"type":"Polygon","coordinates":[]}'::jsonb,
  exclusions jsonb not null default '[]'::jsonb,
  latitude numeric,
  longitude numeric,
  altitude_m numeric,
  timezone text,
  terrain_slope_pct numeric,
  terrain_azimuth_deg numeric,
  albedo numeric not null default 0.2,
  weather_source text not null default 'pvgis' check (weather_source in ('pvgis','nasa_power','meteonorm','solargis','custom_tmy')),
  weather_meta jsonb not null default '{}'::jsonb,
  usable_area_ha numeric,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pv_site_configs_project_idx
  on public.pv_site_configs (project_id, status);

grant select, insert, update, delete on public.pv_site_configs to authenticated;
grant all on public.pv_site_configs to service_role;
alter table public.pv_site_configs enable row level security;

drop policy if exists pv_site_configs_select on public.pv_site_configs;
create policy pv_site_configs_select on public.pv_site_configs
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_site_configs_insert on public.pv_site_configs;
create policy pv_site_configs_insert on public.pv_site_configs
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and status = 'draft'
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  );

drop policy if exists pv_site_configs_update on public.pv_site_configs;
create policy pv_site_configs_update on public.pv_site_configs
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and status = 'draft'
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin'::app_role)
      or public.has_company_role('engineer'::app_role)
      or public.has_company_role('company_admin'::app_role))
  );

drop trigger if exists pv_site_configs_touch on public.pv_site_configs;
create trigger pv_site_configs_touch before update on public.pv_site_configs
  for each row execute function public.update_updated_at_column();