-- 0075_construction_governance.sql — part 2: quality expansion (idempotent)
do $$ begin create type public.itp_point_type as enum ('hold','witness','review','surveillance'); exception when duplicate_object then null; end $$;
do $$ begin create type public.itp_status as enum ('draft','submitted','approved','active','superseded','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.itp_step_status as enum ('pending','signed_off','waived','failed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.test_result_status as enum ('pending','pass','fail','conditional'); exception when duplicate_object then null; end $$;
do $$ begin create type public.mir_status as enum ('requested','scheduled','inspected','accepted','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.dossier_status as enum ('compiling','complete','issued'); exception when duplicate_object then null; end $$;

create table if not exists public.inspection_test_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  itp_number text not null,
  title text not null,
  discipline text not null default 'general',
  revision text not null default 'R0',
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  wbs_item_id uuid references public.wbs_items(id),
  status public.itp_status not null default 'draft',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, itp_number, revision)
);

create table if not exists public.itp_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  itp_id uuid not null references public.inspection_test_plans(id) on delete cascade,
  seq int not null,
  description text not null,
  point_type public.itp_point_type not null default 'review',
  reference_doc text,
  status public.itp_step_status not null default 'pending',
  signoff_role text,
  signed_off_by uuid references public.profiles(id),
  signed_off_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (itp_id, seq)
);

create table if not exists public.material_inspection_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  mir_number text not null,
  material text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  qty numeric(12,3),
  uom text,
  status public.mir_status not null default 'requested',
  inspection_date date,
  inspector uuid references public.profiles(id),
  result public.test_result_status not null default 'pending',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, mir_number)
);

create table if not exists public.factory_acceptance_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  fat_number text not null,
  equipment_tag text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  test_date date,
  location text,
  result public.test_result_status not null default 'pending',
  report_path text,
  punch_items jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, fat_number)
);

create table if not exists public.site_acceptance_tests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  sat_number text not null,
  equipment_tag text not null,
  fat_id uuid references public.factory_acceptance_tests(id) on delete set null,
  test_date date,
  result public.test_result_status not null default 'pending',
  report_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sat_number)
);

create table if not exists public.test_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cert_number text not null,
  entity_type text not null,
  entity_id uuid,
  title text not null,
  issued_by text,
  issue_date date,
  expiry_date date,
  file_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cert_number)
);

create table if not exists public.calibration_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instrument_tag text not null,
  instrument text not null,
  calibrated_by text,
  cal_date date not null,
  next_due date,
  result public.test_result_status not null default 'pending',
  certificate_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, instrument_tag, cal_date)
);

create table if not exists public.welding_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  weld_number text not null,
  welder_name text not null,
  welder_cert text,
  wps_ref text,
  weld_date date not null,
  area text,
  ndt_method text,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, weld_number)
);

create table if not exists public.torque_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_tag text not null,
  bolt_ref text not null,
  target_torque_nm numeric(10,2) not null,
  actual_torque_nm numeric(10,2),
  tool_tag text,
  torque_date date not null,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, equipment_tag, bolt_ref, torque_date)
);

create table if not exists public.cable_test_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  cable_tag text not null,
  test_type text not null check (test_type in ('insulation_resistance','continuity','hipot','iv_curve')),
  values jsonb not null default '{}',
  test_date date not null,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thermographic_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_tag text not null,
  location text,
  image_path text,
  max_temp_c numeric(6,2),
  delta_t_c numeric(6,2),
  finding text,
  inspection_date date not null,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.relay_testing (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  relay_tag text not null,
  test_type text not null check (test_type in ('secondary_injection','primary_injection','settings_verification')),
  settings jsonb not null default '{}',
  test_date date not null,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.transformer_test_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  transformer_tag text not null,
  test_type text not null check (test_type in ('ratio','winding_resistance','insulation_resistance','oil_dga')),
  values jsonb not null default '{}',
  test_date date not null,
  result public.test_result_status not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commissioning_dossiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  dossier_number text not null,
  title text not null,
  status public.dossier_status not null default 'compiling',
  sections jsonb not null default '[]',
  issued_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dossier_number)
);

-- indexes
create index if not exists itp_project_status_idx on public.inspection_test_plans (company_id, project_id, status);
create index if not exists itp_steps_itp_idx on public.itp_steps (itp_id, seq);
create index if not exists mir_project_status_idx on public.material_inspection_requests (company_id, project_id, status);
create index if not exists fat_po_idx on public.factory_acceptance_tests (purchase_order_id);
create index if not exists certs_entity_idx on public.test_certificates (company_id, entity_type, entity_id);
create index if not exists calibration_due_idx on public.calibration_records (company_id, next_due);

-- grants, rls, policies and updated_at triggers, generated idempotently
do $$
declare
  t text;
  doc_tables text[] := array['inspection_test_plans','itp_steps','commissioning_dossiers'];
  tester_tables text[] := array['material_inspection_requests','factory_acceptance_tests','site_acceptance_tests','test_certificates','calibration_records','welding_records','torque_records','cable_test_results','thermographic_inspections','relay_testing','transformer_test_results'];
  roles text;
begin
  foreach t in array (doc_tables || tester_tables) loop
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))',
      t || '_select', t);

    if t = any(doc_tables) then
      roles := 'public.has_company_role(''construction_admin''::public.app_role)'
            || ' or public.has_company_role(''engineering_admin''::public.app_role)'
            || ' or public.has_company_role(''company_admin''::public.app_role)';
    else
      roles := 'public.has_company_role(''construction_admin''::public.app_role)'
            || ' or public.has_company_role(''foreman''::public.app_role)'
            || ' or public.has_company_role(''field_technician''::public.app_role)'
            || ' or public.has_company_role(''company_admin''::public.app_role)';
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_company_member(company_id) and (%s)) with check (public.is_company_member(company_id) and (%s))',
      t || '_write', t, roles, roles);

    execute format('drop trigger if exists trg_updated_at on public.%I', t);
    execute format(
      'create trigger trg_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t);
  end loop;
end $$;

-- hold-point gate consumed by the CWP progress/status mutation (P-180)
create or replace function public.assert_no_open_hold_point(p_cwp_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_cwp_id is null then return; end if;
  if exists (
    select 1 from public.itp_steps s
    join public.inspection_test_plans p on p.id = s.itp_id
    where p.cwp_id = p_cwp_id and p.status = 'active'
      and s.point_type = 'hold' and s.status in ('pending','failed')
  ) then
    raise exception 'open_hold_point: CWP % has unsigned hold points', p_cwp_id using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.assert_no_open_hold_point(uuid) from public;
grant execute on function public.assert_no_open_hold_point(uuid) to authenticated;