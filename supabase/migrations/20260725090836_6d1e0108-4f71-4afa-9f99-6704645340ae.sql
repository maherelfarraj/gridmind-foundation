-- 0042_qaqc.sql (part 1 of 2 — punch items appended in P-090)

do $$ begin
  create type public.qaqc_discipline as enum ('civil','mechanical','electrical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.qaqc_result as enum ('pending','pass','fail','conditional');
exception when duplicate_object then null; end $$;

create table if not exists public.qaqc_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  inspection_number text not null,
  itp_reference text,
  discipline public.qaqc_discipline not null,
  area text not null,
  wbs_item_id uuid references public.wbs_items(id),
  inspection_date date not null,
  inspector_id uuid references public.profiles(id),
  result public.qaqc_result not null default 'pending',
  rework_required boolean not null default false,
  rework_notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, inspection_number)
);

grant select, insert, update on public.qaqc_inspections to authenticated;
grant all on public.qaqc_inspections to service_role;

alter table public.qaqc_inspections enable row level security;

drop policy if exists qaqc_insp_select on public.qaqc_inspections;
create policy qaqc_insp_select on public.qaqc_inspections
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists qaqc_insp_write on public.qaqc_inspections;
create policy qaqc_insp_write on public.qaqc_inspections
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('construction_admin'::public.app_role)
      or public.has_company_role('foreman'::public.app_role)
      or public.has_company_role('field_technician'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('construction_admin'::public.app_role)
      or public.has_company_role('foreman'::public.app_role)
      or public.has_company_role('field_technician'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );

create index if not exists qaqc_insp_project_idx
  on public.qaqc_inspections(company_id, project_id, discipline, area);
create index if not exists qaqc_insp_result_idx
  on public.qaqc_inspections(company_id, project_id, result, rework_required);

drop trigger if exists trg_qaqc_insp_updated_at on public.qaqc_inspections;
create trigger trg_qaqc_insp_updated_at
  before update on public.qaqc_inspections
  for each row execute function public.set_updated_at();
