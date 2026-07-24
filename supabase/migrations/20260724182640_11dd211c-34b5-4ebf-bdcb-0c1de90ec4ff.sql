
do $$ begin
  create type rfq_status as enum ('draft','issued','closed','awarded','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type rfq_bid_status as enum ('invited','submitted','under_review','awarded','rejected','withdrawn');
exception when duplicate_object then null; end $$;

create table if not exists public.rfqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  rfq_number text not null,
  title text not null,
  description text,
  status rfq_status not null default 'draft',
  currency_code text not null references currencies(code),
  lines jsonb not null default '[]',
  issue_date date,
  due_date date,
  terms text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rfq_number)
);

create table if not exists public.rfq_bids (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  vendor_id uuid not null references vendors(id),
  status rfq_bid_status not null default 'invited',
  total_price numeric(14,2),
  currency_code text references currencies(code),
  lead_time_days int,
  validity_date date,
  lines jsonb not null default '[]',
  attachments jsonb not null default '[]',
  submitted_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, vendor_id)
);

create table if not exists public.rfq_line_awards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  rfq_id uuid not null references rfqs(id) on delete cascade,
  rfq_bid_id uuid not null references rfq_bids(id) on delete cascade,
  line_no int not null,
  awarded_qty numeric(14,3) not null,
  awarded_unit_price numeric(14,4) not null,
  awarded_amount numeric(14,2) not null,
  tco_score numeric(10,2),
  award_note text,
  awarded_by uuid references profiles(id),
  awarded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rfq_id, line_no)
);

grant select on public.rfqs to authenticated;
grant insert, update, delete on public.rfqs to authenticated;
grant select on public.rfq_bids to authenticated;
grant insert, update, delete on public.rfq_bids to authenticated;
grant select on public.rfq_line_awards to authenticated;
grant insert, update on public.rfq_line_awards to authenticated;
grant all on public.rfqs, public.rfq_bids, public.rfq_line_awards to service_role;

alter table public.rfqs enable row level security;
alter table public.rfq_bids enable row level security;
alter table public.rfq_line_awards enable row level security;

drop policy if exists rfqs_select on public.rfqs;
create policy rfqs_select on public.rfqs for select to authenticated
  using (is_company_member(company_id));

drop policy if exists rfqs_write on public.rfqs;
create policy rfqs_write on public.rfqs for all to authenticated
  using (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('procurement_officer') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('procurement_officer') or has_company_role('company_admin')));

drop policy if exists bids_select on public.rfq_bids;
create policy bids_select on public.rfq_bids for select to authenticated
  using (is_company_member(company_id));

drop policy if exists bids_write on public.rfq_bids;
create policy bids_write on public.rfq_bids for all to authenticated
  using (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('procurement_officer') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('procurement_officer') or has_company_role('company_admin')));

drop policy if exists awards_select on public.rfq_line_awards;
create policy awards_select on public.rfq_line_awards for select to authenticated
  using (is_company_member(company_id));

drop policy if exists awards_write on public.rfq_line_awards;
create policy awards_write on public.rfq_line_awards for all to authenticated
  using (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('procurement_admin') or has_company_role('company_admin')));

create index if not exists rfqs_company_project_idx on public.rfqs(company_id, project_id, status);
create index if not exists bids_rfq_idx on public.rfq_bids(rfq_id, status);
create index if not exists awards_rfq_idx on public.rfq_line_awards(rfq_id);

drop trigger if exists rfqs_set_updated_at on public.rfqs;
create trigger rfqs_set_updated_at before update on public.rfqs
  for each row execute function public.set_updated_at();

drop trigger if exists rfq_bids_set_updated_at on public.rfq_bids;
create trigger rfq_bids_set_updated_at before update on public.rfq_bids
  for each row execute function public.set_updated_at();

drop trigger if exists rfq_line_awards_set_updated_at on public.rfq_line_awards;
create trigger rfq_line_awards_set_updated_at before update on public.rfq_line_awards
  for each row execute function public.set_updated_at();
