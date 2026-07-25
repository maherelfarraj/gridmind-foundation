-- P-079 Financial commitments: pay applications, invoices, change orders + three_way_matches FK
do $$ begin
  create type invoice_direction as enum ('receivable','payable');
exception when duplicate_object then null; end $$;
do $$ begin
  create type invoice_status as enum ('draft','submitted','under_review','approved','paid','disputed','cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pay_app_status as enum ('draft','submitted','certified','approved','rejected','invoiced');
exception when duplicate_object then null; end $$;
do $$ begin
  create type change_order_status as enum ('draft','submitted','under_review','approved','rejected','incorporated');
exception when duplicate_object then null; end $$;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id) on delete set null,
  invoice_number text not null,
  direction invoice_direction not null,
  status invoice_status not null default 'draft',
  contract_id uuid references public.contracts(id),
  vendor_id uuid references public.vendors(id),
  amount numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  currency_code text not null references public.currencies(code),
  issue_date date,
  due_date date,
  paid_at timestamptz,
  milestone_label text,
  retention_pct numeric(5,2) not null default 0,
  file_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);

create table if not exists public.pay_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid not null references public.contracts(id),
  application_number int not null,
  period_start date not null,
  period_end date not null,
  status pay_app_status not null default 'draft',
  lines jsonb not null default '[]',
  total_scheduled numeric(14,2) not null default 0,
  total_certified numeric(14,2) not null default 0,
  retention_pct numeric(5,2) not null default 5,
  retention_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  reconciliation jsonb not null default '{}',
  certified_by uuid references public.profiles(id),
  certified_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  reject_note text,
  invoice_id uuid references public.invoices(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contract_id, application_number)
);

create table if not exists public.change_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  contract_id uuid references public.contracts(id),
  co_number text not null,
  title text not null,
  description text,
  status change_order_status not null default 'draft',
  amount numeric(14,2) not null default 0,
  currency_code text references public.currencies(code),
  schedule_impact_days int not null default 0,
  budget_impact jsonb not null default '[]',
  wbs_item_id uuid references public.wbs_items(id),
  approval_instance_id uuid,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, co_number)
);

-- Pay Batch 07 debt: three_way_matches.invoice_id → invoices.id
alter table public.three_way_matches drop constraint if exists three_way_matches_invoice_fk;
alter table public.three_way_matches
  add constraint three_way_matches_invoice_fk
  foreign key (invoice_id) references public.invoices(id);

grant select, insert, update on public.invoices to authenticated;
grant select, insert, update on public.pay_applications to authenticated;
grant select, insert, update on public.change_orders to authenticated;
grant all on public.invoices, public.pay_applications, public.change_orders to service_role;

alter table public.invoices enable row level security;
alter table public.pay_applications enable row level security;
alter table public.change_orders enable row level security;

create policy inv_select on public.invoices for select to authenticated using (public.is_company_member(company_id));
create policy inv_write on public.invoices for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

create policy pa_select on public.pay_applications for select to authenticated using (public.is_company_member(company_id));
create policy pa_write on public.pay_applications for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('project_admin') or public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('project_admin') or public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

create policy co_select on public.change_orders for select to authenticated using (public.is_company_member(company_id));
create policy co_write on public.change_orders for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('project_admin') or public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('project_admin') or public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

create index if not exists inv_company_idx on public.invoices(company_id, project_id, status);
create index if not exists pa_contract_idx on public.pay_applications(contract_id, application_number);
create index if not exists co_project_idx on public.change_orders(project_id, status);

create trigger set_updated_at_invoices before update on public.invoices for each row execute function public.set_updated_at();
create trigger set_updated_at_pay_applications before update on public.pay_applications for each row execute function public.set_updated_at();
create trigger set_updated_at_change_orders before update on public.change_orders for each row execute function public.set_updated_at();