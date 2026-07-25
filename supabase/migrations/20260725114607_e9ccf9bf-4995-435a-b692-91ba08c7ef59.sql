-- P-108 warranty contracts + claims
do $$ begin
  create type warranty_type as enum ('manufacturer','epc_workmanship','extended','performance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type warranty_claim_status as enum ('draft','submitted','under_review','approved','rejected','settled');
exception when duplicate_object then null; end $$;

create table if not exists public.warranty_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_id uuid references public.equipment_registry(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  warranty_type warranty_type not null default 'manufacturer',
  start_date date not null,
  end_date date not null,
  terms text,
  coverage_notes text,
  document_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  warranty_id uuid not null references public.warranty_contracts(id) on delete cascade,
  claim_number text not null,
  title text not null,
  description text,
  status warranty_claim_status not null default 'draft',
  submitted_at timestamptz,
  resolved_at timestamptz,
  claimed_amount numeric(14,2),
  settled_amount numeric(14,2),
  currency_code text references public.currencies(code),
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, claim_number)
);

grant select, insert, update, delete on public.warranty_contracts to authenticated;
grant select, insert, update, delete on public.warranty_claims to authenticated;
grant all on public.warranty_contracts to service_role;
grant all on public.warranty_claims to service_role;

alter table public.warranty_contracts enable row level security;
alter table public.warranty_claims enable row level security;

create policy warranty_select on public.warranty_contracts
  for select to authenticated
  using (public.is_company_member(company_id));
create policy warranty_write on public.warranty_contracts
  for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('om_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('om_admin') or public.has_company_role('company_admin')));

create policy claims_select on public.warranty_claims
  for select to authenticated
  using (public.is_company_member(company_id));
create policy claims_write on public.warranty_claims
  for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('om_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('om_admin') or public.has_company_role('company_admin')));

create index if not exists warranty_equipment_idx on public.warranty_contracts(equipment_id, end_date);
create index if not exists warranty_company_expiry_idx on public.warranty_contracts(company_id, end_date);
create index if not exists claims_warranty_idx on public.warranty_claims(warranty_id, status);

drop trigger if exists warranty_contracts_set_updated_at on public.warranty_contracts;
create trigger warranty_contracts_set_updated_at
  before update on public.warranty_contracts
  for each row execute function public.set_updated_at();

drop trigger if exists warranty_claims_set_updated_at on public.warranty_claims;
create trigger warranty_claims_set_updated_at
  before update on public.warranty_claims
  for each row execute function public.set_updated_at();
