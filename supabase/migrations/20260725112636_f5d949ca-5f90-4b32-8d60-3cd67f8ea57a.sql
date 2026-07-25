
do $$ begin
  create type work_order_type as enum ('preventive','corrective','predictive','inspection');
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_order_priority as enum ('low','medium','high','emergency');
exception when duplicate_object then null; end $$;

do $$ begin
  create type work_order_status as enum ('open','assigned','in_progress','on_hold','completed','closed','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_id uuid references public.equipment_registry(id) on delete set null,
  wo_number text not null,
  title text not null,
  description text,
  type work_order_type not null default 'corrective',
  priority work_order_priority not null default 'medium',
  status work_order_status not null default 'open',
  assigned_to uuid references public.profiles(id),
  scheduled_date date,
  due_date date,
  parts jsonb not null default '[]'::jsonb,
  labor jsonb not null default '[]'::jsonb,
  total_cost numeric(14,2) not null default 0,
  currency_code text references public.currencies(code),
  failure_cause text,
  resolution_notes text,
  source text not null default 'manual',
  completed_at timestamptz,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, wo_number)
);

grant select on public.work_orders to authenticated;
grant insert, update, delete on public.work_orders to authenticated;
grant all on public.work_orders to service_role;

alter table public.work_orders enable row level security;

create policy wo_select on public.work_orders
  for select to authenticated
  using (public.is_company_member(company_id));

create policy wo_write on public.work_orders
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('om_admin'::app_role) or public.has_company_role('company_admin'::app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('om_admin'::app_role) or public.has_company_role('company_admin'::app_role))
  );

create policy wo_technician_update on public.work_orders
  for update to authenticated
  using (public.is_company_member(company_id) and assigned_to = auth.uid())
  with check (public.is_company_member(company_id) and assigned_to = auth.uid());

create index if not exists wo_company_status_idx on public.work_orders(company_id, status, priority);
create index if not exists wo_project_idx on public.work_orders(project_id, type, status);
create index if not exists wo_assigned_idx on public.work_orders(assigned_to, status);

drop trigger if exists work_orders_set_updated_at on public.work_orders;
create trigger work_orders_set_updated_at
  before update on public.work_orders
  for each row execute function public.set_updated_at();
