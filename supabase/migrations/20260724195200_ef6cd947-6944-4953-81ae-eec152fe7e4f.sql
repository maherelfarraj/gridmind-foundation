
-- P-070 — material_price_alerts + spare_parts

do $$ begin
  if not exists (select 1 from pg_type where typname = 'material_category') then
    create type public.material_category as enum (
      'module','inverter','tracker','battery_cell','transformer',
      'cable_copper','cable_alu','steel','concrete','other'
    );
  end if;
end $$;

create table if not exists public.material_price_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category public.material_category not null,
  region text not null default 'global',
  unit text not null,
  index_price numeric(14,4),
  currency_code text not null references public.currencies(code),
  previous_price numeric(14,4),
  change_pct numeric(6,2),
  alert_threshold_pct numeric(5,2) not null default 5.00,
  triggered boolean not null default false,
  triggered_at timestamptz,
  source text,
  observed_at date not null default current_date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, category, region)
);

create table if not exists public.spare_parts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  part_number text not null,
  name text not null,
  description text,
  category public.material_category not null default 'other',
  compatible_equipment text,
  uom text not null default 'ea',
  unit_cost numeric(14,2),
  currency_code text references public.currencies(code),
  preferred_vendor_id uuid references public.vendors(id) on delete set null,
  reorder_point int not null default 0,
  safety_stock int not null default 0,
  lead_time_days int,
  qty_on_hand int not null default 0,
  location text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, part_number)
);

grant select, insert, update, delete on public.material_price_alerts to authenticated;
grant select, insert, update, delete on public.spare_parts to authenticated;
grant all on public.material_price_alerts to service_role;
grant all on public.spare_parts to service_role;

alter table public.material_price_alerts enable row level security;
alter table public.spare_parts enable row level security;

drop policy if exists mpa_select on public.material_price_alerts;
create policy mpa_select on public.material_price_alerts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists mpa_write on public.material_price_alerts;
create policy mpa_write on public.material_price_alerts
  for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('company_admin')
    )
  );

drop policy if exists sp_select on public.spare_parts;
create policy sp_select on public.spare_parts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists sp_write on public.spare_parts;
create policy sp_write on public.spare_parts
  for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('om_admin')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('om_admin')
      or public.has_company_role('company_admin')
    )
  );

create index if not exists sp_company_idx on public.spare_parts(company_id, category);
create index if not exists mpa_company_idx on public.material_price_alerts(company_id, category, region);

drop trigger if exists material_price_alerts_set_updated_at on public.material_price_alerts;
create trigger material_price_alerts_set_updated_at
  before update on public.material_price_alerts
  for each row execute function public.set_updated_at();

drop trigger if exists spare_parts_set_updated_at on public.spare_parts;
create trigger spare_parts_set_updated_at
  before update on public.spare_parts
  for each row execute function public.set_updated_at();
