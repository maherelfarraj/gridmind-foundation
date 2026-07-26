-- 0064_pv_layouts.sql — PV layouts + layout blocks. Idempotent.

do $$ begin
  create type public.pv_layout_block_type as enum
    ('array_table','setback','access_road','internal_road','equipment_pad',
     'inverter_station','transformer_station','substation_zone',
     'drainage_corridor','cable_corridor');
exception when duplicate_object then null; end $$;

create table if not exists public.pv_layouts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  site_config_id uuid references public.pv_site_configs(id) on delete set null,
  name text not null,
  version int not null default 1,
  layout_number text,
  status text not null default 'draft'
    check (status in ('draft','under_review','approved','superseded')),
  params jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  approval_instance_id uuid references public.approval_instances(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name, version)
);

create table if not exists public.pv_layout_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  layout_id uuid not null references public.pv_layouts(id) on delete cascade,
  block_type public.pv_layout_block_type not null,
  label text,
  geometry jsonb not null,
  equipment_id uuid references public.pv_equipment_library(id),
  module_rows int,
  modules_per_row int,
  module_count int not null default 0,
  dc_kwp numeric(12,3) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.pv_layouts to authenticated;
grant all on public.pv_layouts to service_role;
grant select, insert, update, delete on public.pv_layout_blocks to authenticated;
grant all on public.pv_layout_blocks to service_role;

alter table public.pv_layouts enable row level security;
alter table public.pv_layout_blocks enable row level security;

drop policy if exists pv_layouts_select on public.pv_layouts;
create policy pv_layouts_select on public.pv_layouts for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_layouts_write on public.pv_layouts;
create policy pv_layouts_write on public.pv_layouts for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists pv_blocks_select on public.pv_layout_blocks;
create policy pv_blocks_select on public.pv_layout_blocks for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_blocks_write on public.pv_layout_blocks;
create policy pv_blocks_write on public.pv_layout_blocks for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop trigger if exists trg_pv_layouts_updated on public.pv_layouts;
create trigger trg_pv_layouts_updated before update on public.pv_layouts
  for each row execute function public.set_updated_at();

drop trigger if exists trg_pv_blocks_updated on public.pv_layout_blocks;
create trigger trg_pv_blocks_updated before update on public.pv_layout_blocks
  for each row execute function public.set_updated_at();

create index if not exists pv_layouts_project_idx on public.pv_layouts (project_id, status);
create index if not exists pv_blocks_layout_idx on public.pv_layout_blocks (layout_id, block_type);

-- Server-side atomic creation: assigns the next version and PV-LAY-#### number,
-- inserts the layout and its blocks in one transaction.
create or replace function public.create_pv_layout(
  p_project_id uuid,
  p_name text,
  p_site_config_id uuid,
  p_params jsonb,
  p_totals jsonb,
  p_blocks jsonb
) returns public.pv_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_version int;
  v_seq int;
  v_number text;
  v_layout public.pv_layouts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select company_id into v_company from public.projects where id = p_project_id;
  if v_company is null then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_company) then
    raise exception 'forbidden_company' using errcode = '42501';
  end if;
  if not (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')
  ) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'name_required' using errcode = '22023';
  end if;

  -- Lock the project row so concurrent creators serialise on numbering.
  perform 1 from public.projects where id = p_project_id for update;

  select coalesce(max(version), 0) + 1 into v_version
    from public.pv_layouts
   where project_id = p_project_id and name = btrim(p_name);

  select coalesce(max((regexp_replace(layout_number, '^PV-LAY-', ''))::int), 0) + 1
    into v_seq
    from public.pv_layouts
   where project_id = p_project_id
     and layout_number ~ '^PV-LAY-[0-9]+$';

  v_number := 'PV-LAY-' || lpad(v_seq::text, 4, '0');

  insert into public.pv_layouts (
    company_id, project_id, site_config_id, name, version, layout_number,
    status, params, totals, created_by
  ) values (
    v_company, p_project_id, p_site_config_id, btrim(p_name), v_version, v_number,
    'draft', coalesce(p_params, '{}'::jsonb), coalesce(p_totals, '{}'::jsonb), auth.uid()
  ) returning * into v_layout;

  insert into public.pv_layout_blocks (
    company_id, layout_id, block_type, label, geometry, equipment_id,
    module_rows, modules_per_row, module_count, dc_kwp, sort_order
  )
  select
    v_company,
    v_layout.id,
    (b->>'block_type')::public.pv_layout_block_type,
    nullif(b->>'label',''),
    b->'geometry',
    nullif(b->>'equipment_id','')::uuid,
    nullif(b->>'module_rows','')::int,
    nullif(b->>'modules_per_row','')::int,
    coalesce((b->>'module_count')::int, 0),
    coalesce((b->>'dc_kwp')::numeric, 0),
    coalesce((b->>'sort_order')::int, ord::int - 1)
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality as t(b, ord);

  return v_layout;
end;
$$;

revoke all on function public.create_pv_layout(uuid, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_pv_layout(uuid, text, uuid, jsonb, jsonb, jsonb) to authenticated;

-- Replaces the block set of a DRAFT layout only.
create or replace function public.save_pv_layout_blocks(
  p_layout_id uuid,
  p_blocks jsonb,
  p_totals jsonb default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout public.pv_layouts;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_layout from public.pv_layouts where id = p_layout_id for update;
  if not found then
    raise exception 'layout_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_layout.company_id) then
    raise exception 'forbidden_company' using errcode = '42501';
  end if;
  if not (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')
  ) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;
  if v_layout.status <> 'draft' then
    raise exception 'layout_not_draft' using errcode = 'P0001';
  end if;

  delete from public.pv_layout_blocks where layout_id = p_layout_id;

  insert into public.pv_layout_blocks (
    company_id, layout_id, block_type, label, geometry, equipment_id,
    module_rows, modules_per_row, module_count, dc_kwp, sort_order
  )
  select
    v_layout.company_id,
    p_layout_id,
    (b->>'block_type')::public.pv_layout_block_type,
    nullif(b->>'label',''),
    b->'geometry',
    nullif(b->>'equipment_id','')::uuid,
    nullif(b->>'module_rows','')::int,
    nullif(b->>'modules_per_row','')::int,
    coalesce((b->>'module_count')::int, 0),
    coalesce((b->>'dc_kwp')::numeric, 0),
    coalesce((b->>'sort_order')::int, ord::int - 1)
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) with ordinality as t(b, ord);

  get diagnostics v_count = row_count;

  update public.pv_layouts
     set totals = coalesce(p_totals, totals),
         updated_at = now()
   where id = p_layout_id;

  return v_count;
end;
$$;

revoke all on function public.save_pv_layout_blocks(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_pv_layout_blocks(uuid, jsonb, jsonb) to authenticated;

-- Draft <-> under_review only. Approved/superseded transitions arrive with P-153.
create or replace function public.set_pv_layout_status(
  p_layout_id uuid,
  p_status text
) returns public.pv_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout public.pv_layouts;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_status not in ('draft','under_review') then
    raise exception 'unsupported_status_transition' using errcode = '22023';
  end if;

  select * into v_layout from public.pv_layouts where id = p_layout_id for update;
  if not found then
    raise exception 'layout_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_layout.company_id) then
    raise exception 'forbidden_company' using errcode = '42501';
  end if;
  if not (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')
  ) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;
  if v_layout.status not in ('draft','under_review') then
    raise exception 'layout_locked' using errcode = 'P0001';
  end if;

  update public.pv_layouts
     set status = p_status, updated_at = now()
   where id = p_layout_id
  returning * into v_layout;

  return v_layout;
end;
$$;

revoke all on function public.set_pv_layout_status(uuid, text) from public, anon;
grant execute on function public.set_pv_layout_status(uuid, text) to authenticated;