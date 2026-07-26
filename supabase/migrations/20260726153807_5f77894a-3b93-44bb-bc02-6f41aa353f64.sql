-- 0063_pv_library_site.sql — PV equipment library + site configs. Idempotent.

do $$ begin
  create type public.pv_equipment_category as enum
    ('module','inverter','optimizer','tracker','structure','transformer',
     'cable','combiner_box','switchgear','bess');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pv_mounting_type as enum
    ('fixed_tilt','single_axis_tracker','dual_axis_tracker');
exception when duplicate_object then null; end $$;

create table if not exists public.pv_equipment_library (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category public.pv_equipment_category not null,
  manufacturer text not null,
  model text not null,
  datasheet_path text,
  certifications jsonb not null default '[]',
  warranties jsonb not null default '{}',
  degradation jsonb not null default '{}',
  electrical jsonb not null default '{}',
  temp_coefficients jsonb not null default '{}',
  dimensions jsonb not null default '{}',
  limits jsonb not null default '{}',
  docs jsonb not null default '[]',
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, category, manufacturer, model)
);

create table if not exists public.pv_site_configs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null default 'Base site',
  latitude numeric(9,6),
  longitude numeric(9,6),
  elevation_m numeric(8,2),
  north_offset_deg numeric(6,3) not null default 0,
  boundary_geojson jsonb,
  exclusion_zones jsonb not null default '[]',
  terrain_ref jsonb not null default '{}',
  weather jsonb not null default '{}',
  grid_limits jsonb not null default '{}',
  target_dc_kwp numeric(12,2),
  target_ac_kw numeric(12,2),
  mounting public.pv_mounting_type not null default 'fixed_tilt',
  mounting_config jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','active','superseded')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

alter table public.pv_equipment_library enable row level security;
alter table public.pv_site_configs enable row level security;

drop policy if exists pv_equip_select on public.pv_equipment_library;
create policy pv_equip_select on public.pv_equipment_library for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists pv_equip_write on public.pv_equipment_library;
create policy pv_equip_write on public.pv_equipment_library for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists pv_site_select on public.pv_site_configs;
create policy pv_site_select on public.pv_site_configs for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists pv_site_write on public.pv_site_configs;
create policy pv_site_write on public.pv_site_configs for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop trigger if exists trg_pv_equip_updated on public.pv_equipment_library;
create trigger trg_pv_equip_updated before update on public.pv_equipment_library
  for each row execute function public.set_updated_at();
drop trigger if exists trg_pv_site_updated on public.pv_site_configs;
create trigger trg_pv_site_updated before update on public.pv_site_configs
  for each row execute function public.set_updated_at();

create index if not exists pv_equip_company_cat_idx
  on public.pv_equipment_library (company_id, category) where is_active;
create index if not exists pv_site_project_idx on public.pv_site_configs (project_id, status);

grant select, insert, update, delete on public.pv_equipment_library to authenticated;
grant select, insert, update, delete on public.pv_site_configs to authenticated;
grant all on public.pv_equipment_library to service_role;
grant all on public.pv_site_configs to service_role;