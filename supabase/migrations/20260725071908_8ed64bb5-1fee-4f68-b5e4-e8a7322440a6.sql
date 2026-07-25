create table if not exists public.cost_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  parent_id uuid references public.cost_codes(id),
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  is_active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id) on delete cascade,
  cost_code_id uuid not null references public.cost_codes(id) on delete cascade,
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  version int not null default 1,
  original_amount numeric(14,2) not null default 0,
  approved_changes numeric(14,2) not null default 0,
  current_amount numeric(14,2) generated always as (original_amount + approved_changes) stored,
  committed_amount numeric(14,2) not null default 0,
  actual_amount numeric(14,2) not null default 0,
  po_commitments jsonb not null default '[]'::jsonb,
  currency_code text not null references currencies(code),
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, cost_code_id, version)
);

grant select on public.cost_codes to authenticated;
grant insert, update, delete on public.cost_codes to authenticated;
grant all on public.cost_codes to service_role;

grant select on public.budgets to authenticated;
grant insert, update on public.budgets to authenticated;
-- no DELETE grant on budgets: 7-year financial retention (supersede via version instead)
grant all on public.budgets to service_role;

alter table public.cost_codes enable row level security;
alter table public.budgets enable row level security;

create policy cc_select on public.cost_codes for select to authenticated
  using (is_company_member(company_id));
create policy cc_write on public.cost_codes for all to authenticated
  using (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('project_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('project_admin') or has_company_role('company_admin')));

create policy budgets_select on public.budgets for select to authenticated
  using (is_company_member(company_id));
create policy budgets_insert on public.budgets for insert to authenticated
  with check (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('company_admin')));
create policy budgets_update on public.budgets for update to authenticated
  using (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('finance_admin') or has_company_role('company_admin')));

create index if not exists cc_project_idx on public.cost_codes(project_id, code);
create index if not exists budgets_project_idx on public.budgets(project_id, cost_code_id);

drop trigger if exists cost_codes_set_updated_at on public.cost_codes;
create trigger cost_codes_set_updated_at
  before update on public.cost_codes
  for each row execute function public.set_updated_at();

drop trigger if exists budgets_set_updated_at on public.budgets;
create trigger budgets_set_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();