
do $$
begin
  if not exists (select 1 from pg_type where typname = 'expediting_status') then
    create type public.expediting_status as enum ('on_track','at_risk','delayed','delivered');
  end if;
end $$;

create table if not exists public.expediting_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  project_id uuid not null references public.projects(id),
  po_line_no int,
  item_description text not null,
  is_long_lead boolean not null default false,
  promised_delivery_date date,
  delivery_window_start date,
  delivery_window_end date,
  site_need_date date not null,
  current_eta date,
  eta_confirmed boolean not null default false,
  status public.expediting_status not null default 'on_track',
  last_vendor_contact_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.expediting_logs to authenticated;
grant all on public.expediting_logs to service_role;

alter table public.expediting_logs enable row level security;

drop policy if exists exp_select on public.expediting_logs;
create policy exp_select on public.expediting_logs
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists exp_write on public.expediting_logs;
create policy exp_write on public.expediting_logs
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

create index if not exists exp_company_project_idx
  on public.expediting_logs(company_id, project_id, status);
create index if not exists exp_po_idx
  on public.expediting_logs(po_id);
create unique index if not exists exp_po_line_unique
  on public.expediting_logs(po_id, po_line_no)
  where po_line_no is not null;

drop trigger if exists expediting_logs_set_updated_at on public.expediting_logs;
create trigger expediting_logs_set_updated_at
  before update on public.expediting_logs
  for each row execute function public.set_updated_at();
