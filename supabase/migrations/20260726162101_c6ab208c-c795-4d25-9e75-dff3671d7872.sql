-- 0065_pv_stringing.sql — PV strings + string assignments. Idempotent.

create table if not exists public.pv_strings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  layout_id uuid not null references public.pv_layouts(id) on delete cascade,
  block_id uuid references public.pv_layout_blocks(id) on delete set null,
  string_label text not null,
  module_id uuid references public.pv_equipment_library(id),
  modules_in_series int not null,
  voc_at_min_temp_v numeric(10,2),
  vmp_at_max_temp_v numeric(10,2),
  dc_power_kwp numeric(10,3),
  combiner_label text,
  inverter_station_label text,
  mppt_index int,
  cable jsonb not null default '{}',
  valid boolean not null default true,
  warnings jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (layout_id, string_label)
);

create table if not exists public.pv_string_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  layout_id uuid not null references public.pv_layouts(id) on delete cascade,
  inverter_station_label text not null,
  inverter_id uuid references public.pv_equipment_library(id),
  mppt_index int not null,
  string_ids uuid[] not null default '{}',
  dc_kwp_on_mppt numeric(10,3),
  inverter_ac_kw numeric(10,2),
  inverter_dc_kwp numeric(10,3),
  dc_ac_ratio numeric(6,3),
  loading_pct numeric(6,2),
  combiner_assignment jsonb not null default '{}',
  mv_feeder jsonb not null default '{}',
  transformer jsonb not null default '{}',
  equipment_counts jsonb not null default '{}',
  warnings jsonb not null default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (layout_id, inverter_station_label, mppt_index)
);

grant select, insert, update, delete on public.pv_strings to authenticated;
grant select, insert, update, delete on public.pv_string_assignments to authenticated;
grant all on public.pv_strings to service_role;
grant all on public.pv_string_assignments to service_role;

alter table public.pv_strings enable row level security;
alter table public.pv_string_assignments enable row level security;

drop policy if exists pv_strings_select on public.pv_strings;
create policy pv_strings_select on public.pv_strings for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_strings_write on public.pv_strings;
create policy pv_strings_write on public.pv_strings for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists pv_assign_select on public.pv_string_assignments;
create policy pv_assign_select on public.pv_string_assignments for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pv_assign_write on public.pv_string_assignments;
create policy pv_assign_write on public.pv_string_assignments for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')));

drop trigger if exists trg_pv_strings_updated on public.pv_strings;
create trigger trg_pv_strings_updated before update on public.pv_strings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_pv_assign_updated on public.pv_string_assignments;
create trigger trg_pv_assign_updated before update on public.pv_string_assignments
  for each row execute function public.set_updated_at();

create index if not exists pv_strings_layout_idx on public.pv_strings (layout_id, inverter_station_label);
create index if not exists pv_assign_layout_idx on public.pv_string_assignments (layout_id);