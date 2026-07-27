-- 0082_bonds_guarantees.sql — P-201 bonds, guarantees & insurance instruments.

-- ---------------------------------------------------------------- enums
do $$ begin
  create type public.bond_instrument_type as enum (
    'bid_bond','advance_payment_guarantee','performance_bond','retention_bond',
    'warranty_bond','insurance_car_ear','insurance_pi','insurance_pl',
    'workmen_comp','parent_company_guarantee','standby_lc');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bond_beneficiary_type as enum
    ('client','supplier','subcontractor','employer','utility','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bond_issuer_type as enum ('bank','insurance_company');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bond_status as enum
    ('draft','active','expiring_soon','expired','released','claimed','returned','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.bond_claim_status as enum
    ('draft','submitted','contested','paid','rejected','withdrawn');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- counters
create table if not exists public.bond_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.bond_counters enable row level security;  -- no policies/grants: trigger-only
grant all on public.bond_counters to service_role;

create or replace function public.next_bond_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.bond_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.bond_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

-- ------------------------------------------------------- bond_instruments
create table if not exists public.bond_instruments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instrument_number text,
  instrument_type public.bond_instrument_type not null,
  beneficiary_name text not null,
  beneficiary_type public.bond_beneficiary_type not null default 'client',
  issuer_name text not null,
  issuer_type public.bond_issuer_type not null default 'bank',
  principal_name text,
  project_id uuid references public.projects(id),
  contract_id uuid references public.contracts(id),
  amount numeric(14,2) not null check (amount >= 0),
  currency_code text not null references public.currencies(code),
  premium_pct numeric(6,3),
  issue_date date,
  effective_date date,
  expiry_date date,
  status public.bond_status not null default 'draft',
  auto_renew boolean not null default false,
  document_path text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bond_instruments_number_unique unique (company_id, instrument_number),
  constraint bond_instruments_expiry_after_issue
    check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);

create index if not exists bond_instruments_company_status_expiry_idx
  on public.bond_instruments(company_id, status, expiry_date);
create index if not exists bond_instruments_company_project_idx
  on public.bond_instruments(company_id, project_id);

create or replace function public.bond_instruments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.instrument_number is null then
    new.instrument_number := 'BG-' || lpad(
      public.next_bond_number(new.company_id, 'instrument')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists bond_instruments_number_trg on public.bond_instruments;
create trigger bond_instruments_number_trg
  before insert on public.bond_instruments
  for each row execute function public.bond_instruments_before_insert();

drop trigger if exists bond_instruments_updated_at on public.bond_instruments;
create trigger bond_instruments_updated_at
  before update on public.bond_instruments
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------ bond_claims
create table if not exists public.bond_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instrument_id uuid not null references public.bond_instruments(id) on delete restrict,
  claim_number text,
  claim_date date not null default current_date,
  amount numeric(14,2) not null check (amount >= 0),
  currency_code text not null references public.currencies(code),
  reason text,
  status public.bond_claim_status not null default 'draft',
  submitted_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bond_claims_number_unique unique (company_id, claim_number)
);

create index if not exists bond_claims_company_instrument_status_idx
  on public.bond_claims(company_id, instrument_id, status);

create or replace function public.bond_claims_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claim_number is null then
    new.claim_number := 'CL-' || lpad(
      public.next_bond_number(new.company_id, 'claim')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists bond_claims_number_trg on public.bond_claims;
create trigger bond_claims_number_trg
  before insert on public.bond_claims
  for each row execute function public.bond_claims_before_insert();

drop trigger if exists bond_claims_updated_at on public.bond_claims;
create trigger bond_claims_updated_at
  before update on public.bond_claims
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------- bond_renewals
create table if not exists public.bond_renewals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instrument_id uuid not null references public.bond_instruments(id) on delete restrict,
  previous_expiry date,
  new_expiry date not null,
  renewed_at timestamptz not null default now(),
  renewed_by uuid references public.profiles(id),
  document_path text,
  premium_amount numeric(14,2),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists bond_renewals_company_instrument_idx
  on public.bond_renewals(company_id, instrument_id);

-- ------------------------------------------------------------------ grants
grant select, insert, update on public.bond_instruments to authenticated;
grant select, insert, update on public.bond_claims to authenticated;
grant select, insert on public.bond_renewals to authenticated;
grant all on public.bond_instruments to service_role;
grant all on public.bond_claims to service_role;
grant all on public.bond_renewals to service_role;

alter table public.bond_instruments enable row level security;
alter table public.bond_claims enable row level security;
alter table public.bond_renewals enable row level security;

-- ---------------------------------------------------------------- policies
drop policy if exists bond_instruments_select on public.bond_instruments;
create policy bond_instruments_select on public.bond_instruments
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists bond_instruments_insert on public.bond_instruments;
create policy bond_instruments_insert on public.bond_instruments
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')));

drop policy if exists bond_instruments_update on public.bond_instruments;
create policy bond_instruments_update on public.bond_instruments
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')));

drop policy if exists bond_claims_select on public.bond_claims;
create policy bond_claims_select on public.bond_claims
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists bond_claims_insert on public.bond_claims;
create policy bond_claims_insert on public.bond_claims
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')));

drop policy if exists bond_claims_update on public.bond_claims;
create policy bond_claims_update on public.bond_claims
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')));

-- append-only: select + insert only, no update/delete policies
drop policy if exists bond_renewals_select on public.bond_renewals;
create policy bond_renewals_select on public.bond_renewals
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists bond_renewals_insert on public.bond_renewals;
create policy bond_renewals_insert on public.bond_renewals
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin')
      or public.has_company_role('legal_admin')
      or public.has_company_role('company_admin')));

revoke all on public.bond_instruments from anon;
revoke all on public.bond_claims from anon;
revoke all on public.bond_renewals from anon;
revoke all on public.bond_counters from anon;