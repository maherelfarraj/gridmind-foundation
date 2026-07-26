-- 0076_materials_logistics.sql — materials & logistics backbone (P-184)
do $$ begin create type public.mto_status as enum ('draft','issued','revised'); exception when duplicate_object then null; end $$;
do $$ begin create type public.reservation_status as enum ('active','fulfilled','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.shipment_status as enum ('preparing','factory_release','in_transit','customs_hold','customs_cleared','delivered','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.damage_disposition as enum ('pending','repair','scrap','return'); exception when duplicate_object then null; end $$;
do $$ begin create type public.rtv_status as enum ('requested','approved','shipped','credited','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.shortage_status as enum ('open','resolved','dismissed'); exception when duplicate_object then null; end $$;

create table if not exists public.material_take_offs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  mto_number text not null,
  revision text not null default 'R0',
  wbs_item_id uuid references public.wbs_items(id),
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  lines jsonb not null default '[]',
  status public.mto_status not null default 'draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, mto_number, revision)
);

create table if not exists public.warehouse_inventory (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  sku text not null,
  material text not null,
  spare_part_id uuid references public.spare_parts(id) on delete set null,
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  qty_reserved numeric(14,3) not null default 0 check (qty_reserved >= 0),
  uom text not null,
  location text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sku, location),
  check (qty_reserved <= qty_on_hand)
);

create table if not exists public.site_inventory (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  sku text not null,
  material text not null,
  spare_part_id uuid references public.spare_parts(id) on delete set null,
  qty_on_hand numeric(14,3) not null default 0 check (qty_on_hand >= 0),
  qty_reserved numeric(14,3) not null default 0 check (qty_reserved >= 0),
  uom text not null,
  laydown_area text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, sku, laydown_area),
  check (qty_reserved <= qty_on_hand)
);

create table if not exists public.batch_serial_tracking (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  sku text not null,
  batch_serial text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  qty numeric(14,3) not null default 1 check (qty > 0),
  manufacture_date date,
  expiry_date date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, sku, batch_serial)
);

create table if not exists public.material_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  reservation_number text not null,
  source text not null check (source in ('warehouse','site')),
  inventory_id uuid not null,
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  qty numeric(14,3) not null check (qty > 0),
  status public.reservation_status not null default 'active',
  reserved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, reservation_number)
);

create table if not exists public.material_issuances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  issue_number text not null,
  reservation_id uuid references public.material_reservations(id) on delete set null,
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  dpr_id uuid references public.construction_daily_reports(id) on delete set null,
  sku text not null,
  qty numeric(14,3) not null check (qty > 0),
  uom text not null,
  issued_to text not null,
  issued_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, issue_number)
);

create table if not exists public.shipment_tracking (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  shipment_number text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  status public.shipment_status not null default 'preparing',
  customs_status text,
  tracking_ref text,
  eta date,
  delivered_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, shipment_number)
);

create table if not exists public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  dn_number text not null,
  shipment_id uuid references public.shipment_tracking(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  goods_receipt_id uuid references public.goods_receipts(id) on delete set null,
  received_date date not null,
  lines jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, dn_number)
);

create table if not exists public.shortage_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  sku text not null,
  material text not null,
  required_qty numeric(14,3) not null,
  available_qty numeric(14,3) not null,
  cwp_id uuid references public.construction_work_packages(id) on delete set null,
  status public.shortage_status not null default 'open',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.damaged_material_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  sku text not null,
  material text not null,
  qty numeric(14,3) not null check (qty > 0),
  batch_serial_id uuid references public.batch_serial_tracking(id) on delete set null,
  delivery_note_id uuid references public.delivery_notes(id) on delete set null,
  damage_description text not null,
  photo_path text,
  disposition public.damage_disposition not null default 'pending',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.return_to_vendor (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  rtv_number text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  damaged_record_id uuid references public.damaged_material_records(id) on delete set null,
  reason text not null,
  qty numeric(14,3) not null check (qty > 0),
  credit_amount numeric(14,2),
  currency_code text references public.currencies(code),
  status public.rtv_status not null default 'requested',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rtv_number)
);

-- indexes
create index if not exists site_inv_project_sku_idx on public.site_inventory (company_id, project_id, sku);
create index if not exists wh_inv_sku_idx on public.warehouse_inventory (company_id, sku);
create index if not exists reservations_cwp_idx on public.material_reservations (cwp_id) where status = 'active';
create index if not exists shipments_po_idx on public.shipment_tracking (purchase_order_id);
create index if not exists shortages_open_idx on public.shortage_alerts (company_id, project_id) where status = 'open';

-- grants, rls, policies and updated_at triggers, generated idempotently
do $$
declare
  t text;
  mat_tables text[] := array[
    'material_take_offs','warehouse_inventory','site_inventory','batch_serial_tracking',
    'material_reservations','material_issuances','shipment_tracking','delivery_notes',
    'shortage_alerts','damaged_material_records','return_to_vendor'];
  roles text := 'public.has_company_role(''procurement_admin''::public.app_role)'
             || ' or public.has_company_role(''construction_admin''::public.app_role)'
             || ' or public.has_company_role(''foreman''::public.app_role)'
             || ' or public.has_company_role(''company_admin''::public.app_role)';
begin
  foreach t in array mat_tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))',
      t || '_select', t);

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

-- atomic reservation: locks the inventory row, so concurrent callers cannot oversell
create or replace function public.reserve_material(p_source text, p_inventory_id uuid, p_qty numeric,
  p_company_id uuid, p_project_id uuid, p_cwp_id uuid, p_reservation_number text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_available numeric; v_id uuid;
begin
  if p_qty <= 0 then raise exception 'qty must be > 0'; end if;
  if not public.is_company_member(p_company_id) then
    raise exception 'not_a_company_member' using errcode = '42501';
  end if;
  if p_source = 'warehouse' then
    select qty_on_hand - qty_reserved into v_available from public.warehouse_inventory
      where id = p_inventory_id and company_id = p_company_id for update;
  elsif p_source = 'site' then
    select qty_on_hand - qty_reserved into v_available from public.site_inventory
      where id = p_inventory_id and company_id = p_company_id for update;
  else
    raise exception 'unknown source %', p_source;
  end if;
  if v_available is null then raise exception 'inventory row not found'; end if;
  if v_available < p_qty then
    raise exception 'insufficient_available: requested % available %', p_qty, v_available using errcode = 'P0001';
  end if;
  if p_source = 'warehouse' then
    update public.warehouse_inventory set qty_reserved = qty_reserved + p_qty where id = p_inventory_id;
  else
    update public.site_inventory set qty_reserved = qty_reserved + p_qty where id = p_inventory_id;
  end if;
  insert into public.material_reservations(company_id, project_id, reservation_number, source, inventory_id, cwp_id, qty, reserved_by)
    values (p_company_id, p_project_id, p_reservation_number, p_source, p_inventory_id, p_cwp_id, p_qty, auth.uid())
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.reserve_material(text,uuid,numeric,uuid,uuid,uuid,text) from public;
revoke all on function public.reserve_material(text,uuid,numeric,uuid,uuid,uuid,text) from anon;
grant execute on function public.reserve_material(text,uuid,numeric,uuid,uuid,uuid,text) to authenticated;