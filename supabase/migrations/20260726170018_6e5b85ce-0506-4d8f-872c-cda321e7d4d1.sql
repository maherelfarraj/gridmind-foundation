do $$ begin
  create type public.civil_feature_type as enum (
    'grading_zone','flood_risk_zone','drainage_path','road_alignment',
    'trench_route','equipment_platform','fence_line','gate',
    'laydown_area','construction_compound','crane_access','emergency_access'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.terrain_surfaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','under_review','approved','superseded')),
  revision_code text not null default 'A',
  crs text not null default 'EPSG:4326',
  origin_easting double precision,
  origin_northing double precision,
  grid_spacing_m double precision not null default 5.0 check (grid_spacing_m > 0),
  grid_rows integer check (grid_rows is null or grid_rows > 0),
  grid_cols integer check (grid_cols is null or grid_cols > 0),
  min_elevation_m double precision,
  max_elevation_m double precision,
  source_type text not null default 'csv_upload'
    check (source_type in ('csv_upload','dem_lite','survey','manual')),
  source_document_id uuid references public.documents(id),
  source_notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name, revision_code)
);
create index if not exists terrain_surfaces_project_idx on public.terrain_surfaces(project_id);
create index if not exists terrain_surfaces_company_idx on public.terrain_surfaces(company_id);

create table if not exists public.terrain_points (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  surface_id uuid not null references public.terrain_surfaces(id) on delete cascade,
  easting double precision not null,
  northing double precision not null,
  elevation_m double precision not null,
  grid_row integer,
  grid_col integer,
  point_kind text not null default 'grid_node'
    check (point_kind in ('grid_node','survey_shot','breakline','spot_level')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (surface_id, grid_row, grid_col)
);
create index if not exists terrain_points_surface_idx on public.terrain_points(surface_id);
create index if not exists terrain_points_grid_idx on public.terrain_points(surface_id, grid_row, grid_col);

create table if not exists public.contour_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  surface_id uuid not null references public.terrain_surfaces(id) on delete cascade,
  elevation_m double precision not null,
  geometry jsonb not null,
  is_major boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(geometry) = 'object' and geometry ? 'type' and geometry ? 'coordinates')
);
create index if not exists contour_lines_surface_idx on public.contour_lines(surface_id);

create table if not exists public.civil_features (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  surface_id uuid references public.terrain_surfaces(id) on delete set null,
  feature_ref text not null,
  name text not null,
  feature_type public.civil_feature_type not null,
  geometry jsonb not null,
  properties jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','under_review','approved','superseded')),
  revision_code text not null default 'A',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, feature_ref),
  check (jsonb_typeof(geometry) = 'object' and geometry ? 'type' and geometry ? 'coordinates')
);
create index if not exists civil_features_project_idx on public.civil_features(project_id);
create index if not exists civil_features_type_idx on public.civil_features(project_id, feature_type);

drop trigger if exists trg_terrain_surfaces_updated on public.terrain_surfaces;
create trigger trg_terrain_surfaces_updated before update on public.terrain_surfaces
  for each row execute function public.set_updated_at();
drop trigger if exists trg_terrain_points_updated on public.terrain_points;
create trigger trg_terrain_points_updated before update on public.terrain_points
  for each row execute function public.set_updated_at();
drop trigger if exists trg_contour_lines_updated on public.contour_lines;
create trigger trg_contour_lines_updated before update on public.contour_lines
  for each row execute function public.set_updated_at();
drop trigger if exists trg_civil_features_updated on public.civil_features;
create trigger trg_civil_features_updated before update on public.civil_features
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.terrain_surfaces to authenticated;
grant select, insert, update, delete on public.terrain_points to authenticated;
grant select, insert, update, delete on public.contour_lines to authenticated;
grant select, insert, update, delete on public.civil_features to authenticated;
grant all on public.terrain_surfaces to service_role;
grant all on public.terrain_points to service_role;
grant all on public.contour_lines to service_role;
grant all on public.civil_features to service_role;
revoke all on public.terrain_surfaces from anon;
revoke all on public.terrain_points from anon;
revoke all on public.contour_lines from anon;
revoke all on public.civil_features from anon;

alter table public.terrain_surfaces enable row level security;
alter table public.terrain_points enable row level security;
alter table public.contour_lines enable row level security;
alter table public.civil_features enable row level security;

drop policy if exists terrain_surfaces_select on public.terrain_surfaces;
create policy terrain_surfaces_select on public.terrain_surfaces for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists terrain_surfaces_write on public.terrain_surfaces;
create policy terrain_surfaces_write on public.terrain_surfaces for all to authenticated
  using (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists terrain_points_select on public.terrain_points;
create policy terrain_points_select on public.terrain_points for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists terrain_points_write on public.terrain_points;
create policy terrain_points_write on public.terrain_points for all to authenticated
  using (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists contour_lines_select on public.contour_lines;
create policy contour_lines_select on public.contour_lines for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists contour_lines_write on public.contour_lines;
create policy contour_lines_write on public.contour_lines for all to authenticated
  using (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  );

drop policy if exists civil_features_select on public.civil_features;
create policy civil_features_select on public.civil_features for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(), 'super_admin'));
drop policy if exists civil_features_write on public.civil_features;
create policy civil_features_write on public.civil_features for all to authenticated
  using (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  )
  with check (
    (public.is_company_member(company_id) and (
      public.has_company_role('engineering_admin') or public.has_company_role('engineer')
      or public.has_company_role('project_admin') or public.has_company_role('construction_admin')
    )) or public.has_role(auth.uid(), 'super_admin')
  );