-- 0034_cash_flows.sql — P-077 Cash flow ledger with FX-at-entry immutability.

do $$ begin
  create type cash_flow_direction as enum ('inflow','outflow');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_flow_kind as enum ('forecast','actual');
exception when duplicate_object then null; end $$;

create table if not exists public.cash_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  period date not null,
  direction cash_flow_direction not null,
  kind cash_flow_kind not null,
  category text not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency_code text not null references public.currencies(code),
  fx_rate_to_base numeric(14,6),
  amount_base numeric(14,2),
  base_currency_code text,
  reference_type text,
  reference_id uuid,
  voided boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_flows_period_month_start check (period = date_trunc('month', period)::date),
  constraint cash_flows_category_valid check (category in
    ('milestone_billing','po_payment','payroll','equipment','other'))
);

grant select, insert, update on public.cash_flows to authenticated;
grant all on public.cash_flows to service_role;

alter table public.cash_flows enable row level security;

drop policy if exists cf_select on public.cash_flows;
create policy cf_select on public.cash_flows
  for select to authenticated
  using (is_company_member(company_id));

drop policy if exists cf_insert on public.cash_flows;
create policy cf_insert on public.cash_flows
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

drop policy if exists cf_update on public.cash_flows;
create policy cf_update on public.cash_flows
  for update to authenticated
  using (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  )
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

create index if not exists cf_project_period_idx
  on public.cash_flows(project_id, period, kind, direction);
create index if not exists cf_company_idx on public.cash_flows(company_id);

drop trigger if exists set_updated_at_cash_flows on public.cash_flows;
create trigger set_updated_at_cash_flows
  before update on public.cash_flows
  for each row execute function public.set_updated_at();
