-- 0074_cwp_controls.sql — part 2: field execution addendum (idempotent)
-- NOTE: equipment_status / delivery_status already exist for other modules,
-- so the field-execution enums are namespaced.
do $$ begin create type public.field_equipment_status as enum ('on_site','standby','off_hired','breakdown'); exception when duplicate_object then null; end $$;
do $$ begin create type public.field_delivery_status as enum ('expected','in_transit','delivered','partially_delivered','rejected'); exception when duplicate_object then null; end $$;

create table if not exists public.work_fronts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  name text not null,
  area text,
  discipline text not null default 'general',
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, name)
);

create table if not exists public.crew_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  work_front_id uuid not null references work_fronts(id) on delete cascade,
  cwp_id uuid references construction_work_packages(id) on delete set null,
  dpr_id uuid references construction_daily_reports(id) on delete set null,
  assignment_date date not null,
  trade text not null,
  contractor text,
  headcount int not null check (headcount >= 0),
  foreman uuid references profiles(id),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, work_front_id, assignment_date, trade)
);

create table if not exists public.equipment_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  dpr_id uuid references construction_daily_reports(id) on delete set null,
  equipment_tag text not null,
  description text,
  category text,
  status public.field_equipment_status not null default 'on_site',
  log_date date not null,
  hours numeric(5,2) not null default 0 check (hours >= 0 and hours <= 24),
  operator_name text,
  fuel_litres numeric(8,2),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, equipment_tag, log_date)
);

create table if not exists public.material_consumption (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  dpr_id uuid not null references construction_daily_reports(id) on delete cascade,
  cwp_id uuid references construction_work_packages(id) on delete set null,
  material text not null,
  qty numeric(12,3) not null check (qty > 0),
  uom text not null,
  batch_serial_id uuid,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_tracking (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  purchase_order_id uuid references purchase_orders(id) on delete set null,
  reference text,
  status public.field_delivery_status not null default 'expected',
  expected_date date,
  delivered_at timestamptz,
  carrier text,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.construction_daily_reports add column if not exists latitude numeric(9,6);
alter table public.construction_daily_reports add column if not exists longitude numeric(9,6);
alter table public.construction_daily_reports add column if not exists gps_captured_at timestamptz;
alter table public.site_photos add column if not exists media_type text not null default 'photo';
do $$ begin alter table public.site_photos add constraint site_photos_media_type_chk check (media_type in ('photo','video')); exception when duplicate_object then null; end $$;

-- indexes
create index if not exists crew_front_date_idx on public.crew_assignments (company_id, project_id, assignment_date);
create index if not exists equipment_project_date_idx on public.equipment_records (company_id, project_id, log_date);
create index if not exists consumption_dpr_idx on public.material_consumption (dpr_id);
create index if not exists deliveries_po_idx on public.delivery_tracking (purchase_order_id);

-- grants
grant select, insert, update, delete on public.work_fronts to authenticated;
grant select, insert, update, delete on public.crew_assignments to authenticated;
grant select, insert, update, delete on public.equipment_records to authenticated;
grant select, insert, update, delete on public.delivery_tracking to authenticated;
grant select, insert, update on public.material_consumption to authenticated;
grant all on public.work_fronts to service_role;
grant all on public.crew_assignments to service_role;
grant all on public.equipment_records to service_role;
grant all on public.material_consumption to service_role;
grant all on public.delivery_tracking to service_role;

-- rls
alter table public.work_fronts enable row level security;
alter table public.crew_assignments enable row level security;
alter table public.equipment_records enable row level security;
alter table public.material_consumption enable row level security;
alter table public.delivery_tracking enable row level security;

drop policy if exists work_fronts_select on public.work_fronts;
create policy work_fronts_select on public.work_fronts
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists work_fronts_write on public.work_fronts;
create policy work_fronts_write on public.work_fronts
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists crew_assignments_select on public.crew_assignments;
create policy crew_assignments_select on public.crew_assignments
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crew_assignments_write on public.crew_assignments;
create policy crew_assignments_write on public.crew_assignments
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists equipment_records_select on public.equipment_records;
create policy equipment_records_select on public.equipment_records
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists equipment_records_write on public.equipment_records;
create policy equipment_records_write on public.equipment_records
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists material_consumption_select on public.material_consumption;
create policy material_consumption_select on public.material_consumption
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists material_consumption_write on public.material_consumption;
create policy material_consumption_write on public.material_consumption
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists delivery_tracking_select on public.delivery_tracking;
create policy delivery_tracking_select on public.delivery_tracking
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists delivery_tracking_write on public.delivery_tracking;
create policy delivery_tracking_write on public.delivery_tracking
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('construction_admin'::public.app_role)
    or public.has_company_role('foreman'::public.app_role)
    or public.has_company_role('field_technician'::public.app_role)
    or public.has_company_role('company_admin'::public.app_role)));

-- updated_at triggers
drop trigger if exists trg_updated_at on public.work_fronts;
create trigger trg_updated_at before update on public.work_fronts for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.crew_assignments;
create trigger trg_updated_at before update on public.crew_assignments for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.equipment_records;
create trigger trg_updated_at before update on public.equipment_records for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.material_consumption;
create trigger trg_updated_at before update on public.material_consumption for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.delivery_tracking;
create trigger trg_updated_at before update on public.delivery_tracking for each row execute function public.set_updated_at();