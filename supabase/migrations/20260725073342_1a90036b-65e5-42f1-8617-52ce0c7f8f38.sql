-- P-078 Contracts + Contract Obligations

do $$ begin
  create type contract_type as enum ('epc','ppa','supply','service','consulting','lease','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contract_status as enum ('draft','negotiation','signed','active','completed','terminated');
exception when duplicate_object then null; end $$;

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id) on delete set null,
  contract_number text not null,
  title text not null,
  contract_type contract_type not null default 'epc',
  counterparty text not null,
  status contract_status not null default 'draft',
  value numeric(14,2),
  currency_code text references public.currencies(code),
  schedule_of_values jsonb not null default '[]'::jsonb,
  signed_at date,
  effective_date date,
  expiry_date date,
  file_path text,
  retention_until date,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, contract_number)
);

create table if not exists public.contract_obligations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  title text not null,
  description text,
  clause_ref text,
  due_date date,
  status text not null default 'open',
  owner_id uuid references public.profiles(id),
  extracted_by_ai boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select on public.contracts to authenticated;
grant insert, update on public.contracts to authenticated;
grant all on public.contracts to service_role;

grant select on public.contract_obligations to authenticated;
grant insert, update on public.contract_obligations to authenticated;
grant all on public.contract_obligations to service_role;

alter table public.contracts enable row level security;
alter table public.contract_obligations enable row level security;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists contracts_write on public.contracts;
create policy contracts_write on public.contracts
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')
    )
  );

drop policy if exists obligations_select on public.contract_obligations;
create policy obligations_select on public.contract_obligations
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists obligations_write on public.contract_obligations;
create policy obligations_write on public.contract_obligations
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')
    )
  );

drop trigger if exists contracts_set_updated_at on public.contracts;
create trigger contracts_set_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();

drop trigger if exists obligations_set_updated_at on public.contract_obligations;
create trigger obligations_set_updated_at
  before update on public.contract_obligations
  for each row execute function public.set_updated_at();

create index if not exists contracts_company_idx
  on public.contracts(company_id, project_id, status);

create index if not exists obligations_contract_idx
  on public.contract_obligations(contract_id, status, due_date);
