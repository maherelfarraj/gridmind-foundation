
-- P-109: Service tickets + SLA records
do $$ begin
  create type ticket_category as enum ('corrective','inspection','warranty','monitoring','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ticket_status as enum ('open','in_progress','waiting_client','resolved','closed');
exception when duplicate_object then null; end $$;

create table if not exists public.service_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  ticket_number text not null,
  title text not null,
  description text,
  category ticket_category not null default 'corrective',
  priority work_order_priority not null default 'medium',
  status ticket_status not null default 'open',
  related_work_order_id uuid references work_orders(id) on delete set null,
  reported_by uuid references profiles(id),
  assigned_to uuid references profiles(id),
  resolved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ticket_number)
);

create table if not exists public.sla_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  service_ticket_id uuid not null references service_tickets(id) on delete cascade,
  response_due_at timestamptz not null,
  resolution_due_at timestamptz not null,
  responded_at timestamptz,
  resolved_at timestamptz,
  response_breached boolean not null default false,
  resolution_breached boolean not null default false,
  breach_minutes int not null default 0,
  credit_pct numeric(5,2) not null default 0,
  credit_amount numeric(14,2),
  currency_code text references currencies(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_ticket_id)
);

grant select, insert, update, delete on public.service_tickets to authenticated;
grant select, insert, update, delete on public.sla_records to authenticated;
grant all on public.service_tickets to service_role;
grant all on public.sla_records to service_role;

alter table public.service_tickets enable row level security;
alter table public.sla_records enable row level security;

create policy tickets_select on public.service_tickets for select to authenticated
  using (is_company_member(company_id));
create policy tickets_write on public.service_tickets for all to authenticated
  using (is_company_member(company_id) and (has_company_role('om_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('om_admin') or has_company_role('company_admin')));

create policy sla_select on public.sla_records for select to authenticated
  using (is_company_member(company_id));
create policy sla_write on public.sla_records for all to authenticated
  using (is_company_member(company_id) and (has_company_role('om_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('om_admin') or has_company_role('company_admin')));

create index if not exists tickets_company_status_idx on public.service_tickets(company_id, status, priority);
create index if not exists sla_breach_idx on public.sla_records(company_id, resolution_breached, response_breached);

drop trigger if exists set_updated_at_service_tickets on public.service_tickets;
create trigger set_updated_at_service_tickets before update on public.service_tickets
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at_sla_records on public.sla_records;
create trigger set_updated_at_sla_records before update on public.sla_records
  for each row execute function public.set_updated_at();
