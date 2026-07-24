-- 0026_purchase_orders.sql — P-064
do $$ begin
  create type po_status as enum ('draft','pending_approval','approved','issued','partially_received','received','closed','cancelled');
exception when duplicate_object then null; end $$;

alter table public.companies add column if not exists po_approval_threshold numeric(14,2) not null default 50000;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  vendor_id uuid not null references public.vendors(id),
  rfq_id uuid references public.rfqs(id),
  po_number text not null,
  status po_status not null default 'draft',
  currency_code text not null references public.currencies(code),
  lines jsonb not null default '[]'::jsonb,
  subtotal numeric(14,2) not null default 0,
  tax_pct numeric(5,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  payment_terms text,
  incoterms text,
  delivery_address text,
  required_by_date date,
  approval_note text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  issued_at timestamptz,
  pdf_path text,
  share_token uuid default gen_random_uuid(),
  share_token_expires_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, po_number)
);

grant select, insert, update on public.purchase_orders to authenticated;
grant all on public.purchase_orders to service_role;

alter table public.purchase_orders enable row level security;

drop policy if exists pos_select on public.purchase_orders;
create policy pos_select on public.purchase_orders for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists pos_write on public.purchase_orders;
create policy pos_write on public.purchase_orders for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')
    )
  );

create index if not exists pos_company_project_idx on public.purchase_orders(company_id, project_id, status);
create unique index if not exists pos_share_token_idx on public.purchase_orders(share_token);

drop trigger if exists purchase_orders_set_updated_at on public.purchase_orders;
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();