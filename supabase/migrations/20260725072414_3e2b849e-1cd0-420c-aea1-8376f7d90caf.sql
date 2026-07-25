create table if not exists public.evm_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id) on delete cascade,
  snapshot_date date not null,
  planned_value numeric(14,2) not null default 0,
  earned_value numeric(14,2) not null default 0,
  actual_cost numeric(14,2) not null default 0,
  budget_at_completion numeric(14,2) not null default 0,
  spi numeric(8,3) generated always as (case when planned_value > 0 then earned_value / planned_value else null end) stored,
  cpi numeric(8,3) generated always as (case when actual_cost > 0 then earned_value / actual_cost else null end) stored,
  estimate_at_completion numeric(14,2),
  currency_code text not null references currencies(code),
  source text not null default 'manual',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, snapshot_date)
);

grant select, insert on public.evm_snapshots to authenticated;
-- no UPDATE / DELETE grants: EVM snapshots are immutable (7-year retention).
grant all on public.evm_snapshots to service_role;

alter table public.evm_snapshots enable row level security;

create policy evm_select on public.evm_snapshots for select to authenticated
  using (is_company_member(company_id));
create policy evm_insert on public.evm_snapshots for insert to authenticated
  with check (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('project_admin') or has_company_role('company_admin')));

create index if not exists evm_project_idx on public.evm_snapshots(project_id, snapshot_date);