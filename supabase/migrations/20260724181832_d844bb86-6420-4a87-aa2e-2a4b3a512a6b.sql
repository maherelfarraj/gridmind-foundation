-- P-061: Vendors & Vendor Scorecards

do $$
begin
  if not exists (select 1 from pg_type where typname = 'vendor_status') then
    create type public.vendor_status as enum ('onboarding','active','suspended','blacklisted');
  end if;
end$$;

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  legal_name text,
  tax_id text,
  website text,
  email text,
  phone text,
  address_line text,
  city text,
  country text,
  currency_code text references public.currencies(code),
  payment_terms text default 'net_30',
  incoterms text default 'DAP',
  categories text[] not null default '{}',
  certifications jsonb not null default '[]',
  status public.vendor_status not null default 'onboarding',
  notes text,
  onboarded_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_scorecards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  project_id uuid references public.projects(id),
  period_start date not null,
  period_end date not null,
  on_time_delivery_pct numeric(5,2),
  quality_score numeric(5,2),
  responsiveness_score numeric(5,2),
  total_pos int default 0,
  total_receipts int default 0,
  defects_count int default 0,
  computed_at timestamptz default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_id, project_id, period_start, period_end)
);

grant select on public.vendors to authenticated;
grant insert, update, delete on public.vendors to authenticated;
grant all on public.vendors to service_role;

grant select on public.vendor_scorecards to authenticated;
grant insert, update on public.vendor_scorecards to authenticated;
grant all on public.vendor_scorecards to service_role;

alter table public.vendors enable row level security;
alter table public.vendor_scorecards enable row level security;

drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists vendors_write on public.vendors;
create policy vendors_write on public.vendors for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin') or
      public.has_company_role('procurement_officer') or
      public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin') or
      public.has_company_role('procurement_officer') or
      public.has_company_role('company_admin')
    )
  );

drop policy if exists scorecards_select on public.vendor_scorecards;
create policy scorecards_select on public.vendor_scorecards for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists scorecards_write on public.vendor_scorecards;
create policy scorecards_write on public.vendor_scorecards for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin') or
      public.has_company_role('procurement_officer') or
      public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('procurement_admin') or
      public.has_company_role('procurement_officer') or
      public.has_company_role('company_admin')
    )
  );

create index if not exists vendors_company_idx on public.vendors(company_id, status);
create index if not exists scorecards_vendor_idx on public.vendor_scorecards(vendor_id, period_start);

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

drop trigger if exists vendor_scorecards_set_updated_at on public.vendor_scorecards;
create trigger vendor_scorecards_set_updated_at
  before update on public.vendor_scorecards
  for each row execute function public.set_updated_at();
