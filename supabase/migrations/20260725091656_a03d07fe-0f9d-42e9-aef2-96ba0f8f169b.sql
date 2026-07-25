-- 0043_qaqc_punch.sql — P-090 punch items (part 2 of QA/QC).
do $$ begin
  create type public.punch_category as enum ('A','B','C');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.punch_status as enum ('open','ready_for_review','closed','void');
exception when duplicate_object then null; end $$;

create table if not exists public.qaqc_punch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  punch_number text not null,
  walk_date date not null,
  area text not null,
  discipline public.qaqc_discipline not null,
  category public.punch_category not null default 'B',
  description text not null,
  raised_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  due_date date,
  status public.punch_status not null default 'open',
  photo_ids jsonb not null default '[]'::jsonb,
  signoff_by uuid references public.profiles(id),
  signoff_name text,
  signoff_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, punch_number)
);

grant select, insert, update on public.qaqc_punch_items to authenticated;
grant all on public.qaqc_punch_items to service_role;

alter table public.qaqc_punch_items enable row level security;

drop policy if exists punch_select on public.qaqc_punch_items;
create policy punch_select on public.qaqc_punch_items
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists punch_write on public.qaqc_punch_items;
create policy punch_write on public.qaqc_punch_items
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

create index if not exists punch_project_status_idx
  on public.qaqc_punch_items(company_id, project_id, category, status);
create index if not exists punch_project_area_idx
  on public.qaqc_punch_items(company_id, project_id, area, discipline);

drop trigger if exists trg_qaqc_punch_updated_at on public.qaqc_punch_items;
create trigger trg_qaqc_punch_updated_at
  before update on public.qaqc_punch_items
  for each row execute function public.set_updated_at();
