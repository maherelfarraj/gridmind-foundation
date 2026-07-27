-- 0085_estimating.sql — P-209 estimating foundation: rate library, estimates,
-- estimate lines. Idempotent.

do $$ begin
  create type public.estimate_rate_type as enum ('material','labor','plant','subcontract','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estimate_status as enum ('draft','in_review','approved','priced','superseded');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- counters
create table if not exists public.estimate_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.estimate_counters enable row level security; -- trigger-only, no policies
grant all on public.estimate_counters to service_role;
revoke all on public.estimate_counters from anon, authenticated;

create or replace function public.next_estimate_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.estimate_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.estimate_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

revoke all on function public.next_estimate_number(uuid, text) from anon, authenticated;

-- ---------------------------------------------------------- rate_library
create table if not exists public.rate_library (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rate_type public.estimate_rate_type not null,
  name text not null,
  uom text not null,
  unit_rate numeric(14,2) not null default 0,
  currency_code text not null default 'USD' references public.currencies(code),
  category text,
  supplier text,
  valid_from date,
  valid_to date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rate_library_unique unique (company_id, rate_type, name),
  constraint rate_library_validity check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index if not exists rate_library_company_type_idx on public.rate_library(company_id, rate_type);
create index if not exists rate_library_company_valid_to_idx on public.rate_library(company_id, valid_to);

grant select, insert, update, delete on public.rate_library to authenticated;
grant all on public.rate_library to service_role;
revoke all on public.rate_library from anon;
alter table public.rate_library enable row level security;

drop trigger if exists rate_library_updated_at on public.rate_library;
create trigger rate_library_updated_at before update on public.rate_library
  for each row execute function public.set_updated_at();

drop policy if exists rate_library_select on public.rate_library;
create policy rate_library_select on public.rate_library
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists rate_library_insert on public.rate_library;
create policy rate_library_insert on public.rate_library
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists rate_library_update on public.rate_library;
create policy rate_library_update on public.rate_library
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists rate_library_delete on public.rate_library;
create policy rate_library_delete on public.rate_library
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin') or public.has_company_role('company_admin')));

-- ------------------------------------------------------------- estimates
create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  estimate_number text,
  project_id uuid not null references public.projects(id) on delete cascade,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  bom_snapshot_id uuid references public.bom_snapshots(id) on delete set null,
  title text not null,
  revision integer not null default 0,
  supersedes_id uuid references public.estimates(id) on delete set null,
  status public.estimate_status not null default 'draft',
  currency_code text not null default 'USD' references public.currencies(code),
  direct_cost numeric(16,2) not null default 0,
  escalation_pct numeric(6,3) not null default 0,
  contingency_pct numeric(6,3) not null default 0,
  overhead_pct numeric(6,3) not null default 0,
  profit_pct numeric(6,3) not null default 0,
  subtotal numeric(16,2) not null default 0,
  total_price numeric(16,2) not null default 0,
  approval_instance_id uuid references public.approval_instances(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint estimates_number_unique unique (company_id, estimate_number)
);

create index if not exists estimates_company_status_idx on public.estimates(company_id, status);
create index if not exists estimates_project_idx on public.estimates(project_id, revision);

create or replace function public.estimates_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estimate_number is null then
    new.estimate_number := 'EST-' || lpad(public.next_estimate_number(new.company_id, 'estimate')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists estimates_number_trg on public.estimates;
create trigger estimates_number_trg before insert on public.estimates
  for each row execute function public.estimates_before_insert();

drop trigger if exists estimates_updated_at on public.estimates;
create trigger estimates_updated_at before update on public.estimates
  for each row execute function public.set_updated_at();

-- backstop: approved (or later) estimates can never be deleted
create or replace function public.estimates_block_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception 'estimate_delete_forbidden: status %', old.status
      using errcode = 'check_violation';
  end if;
  return old;
end $$;

drop trigger if exists estimates_block_delete_trg on public.estimates;
create trigger estimates_block_delete_trg before delete on public.estimates
  for each row execute function public.estimates_block_delete();

grant select, insert, update, delete on public.estimates to authenticated;
grant all on public.estimates to service_role;
revoke all on public.estimates from anon;
alter table public.estimates enable row level security;

drop policy if exists estimates_select on public.estimates;
create policy estimates_select on public.estimates
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists estimates_insert on public.estimates;
create policy estimates_insert on public.estimates
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')));

drop policy if exists estimates_update on public.estimates;
create policy estimates_update on public.estimates
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')));

drop policy if exists estimates_delete on public.estimates;
create policy estimates_delete on public.estimates
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and status = 'draft'
    and (created_by = auth.uid() or public.has_company_role('company_admin')));

-- -------------------------------------------------------- estimate_lines
create table if not exists public.estimate_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  line_type public.estimate_rate_type not null,
  source_bom_line_id uuid,
  description text not null,
  qty numeric(16,4) not null default 0,
  uom text not null,
  unit_rate numeric(14,2) not null default 0,
  rate_library_id uuid references public.rate_library(id) on delete set null,
  amount numeric(16,2) not null default 0,
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_lines_estimate_sort_idx on public.estimate_lines(estimate_id, sort_order);
create index if not exists estimate_lines_company_idx on public.estimate_lines(company_id);

drop trigger if exists estimate_lines_updated_at on public.estimate_lines;
create trigger estimate_lines_updated_at before update on public.estimate_lines
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.estimate_lines to authenticated;
grant all on public.estimate_lines to service_role;
revoke all on public.estimate_lines from anon;
alter table public.estimate_lines enable row level security;

drop policy if exists estimate_lines_select on public.estimate_lines;
create policy estimate_lines_select on public.estimate_lines
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists estimate_lines_insert on public.estimate_lines;
create policy estimate_lines_insert on public.estimate_lines
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')));

drop policy if exists estimate_lines_update on public.estimate_lines;
create policy estimate_lines_update on public.estimate_lines
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin')));

drop policy if exists estimate_lines_delete on public.estimate_lines;
create policy estimate_lines_delete on public.estimate_lines
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('engineering_admin') or public.has_company_role('procurement_admin')
      or public.has_company_role('company_admin'))
    and exists (
      select 1 from public.estimates e
      where e.id = estimate_lines.estimate_id and e.status = 'draft'));
