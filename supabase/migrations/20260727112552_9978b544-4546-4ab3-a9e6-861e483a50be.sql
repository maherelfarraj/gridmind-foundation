-- 0084_gl_export.sql — P-207 general ledger export schema.

do $$ begin
  create type public.gl_event_type as enum (
    'invoice_receivable_issued','invoice_payable_received','payment_received',
    'payment_made','retention_withheld','change_order_approved','debit_note_issued');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gl_run_status as enum ('generated','downloaded','superseded');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- counters
create table if not exists public.gl_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.gl_counters enable row level security; -- trigger-only, no policies
grant all on public.gl_counters to service_role;
revoke all on public.gl_counters from anon;

create or replace function public.next_gl_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.gl_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.gl_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

revoke all on function public.next_gl_number(uuid, text) from anon, authenticated;

-- ---------------------------------------------------- gl_account_mappings
create table if not exists public.gl_account_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  event_type public.gl_event_type not null,
  debit_account_code text not null check (debit_account_code ~ '^[A-Za-z0-9]{4,10}$'),
  debit_account_name text not null,
  credit_account_code text not null check (credit_account_code ~ '^[A-Za-z0-9]{4,10}$'),
  credit_account_name text not null,
  enabled boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gl_account_mappings_unique unique (company_id, event_type)
);

grant select, insert, update on public.gl_account_mappings to authenticated;
grant all on public.gl_account_mappings to service_role;
revoke all on public.gl_account_mappings from anon;
alter table public.gl_account_mappings enable row level security;

drop trigger if exists gl_account_mappings_updated_at on public.gl_account_mappings;
create trigger gl_account_mappings_updated_at
  before update on public.gl_account_mappings
  for each row execute function public.set_updated_at();

drop policy if exists gl_account_mappings_select on public.gl_account_mappings;
create policy gl_account_mappings_select on public.gl_account_mappings
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists gl_account_mappings_insert on public.gl_account_mappings;
create policy gl_account_mappings_insert on public.gl_account_mappings
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists gl_account_mappings_update on public.gl_account_mappings;
create policy gl_account_mappings_update on public.gl_account_mappings
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

-- -------------------------------------------------------- gl_export_runs
create table if not exists public.gl_export_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_number text,
  period_from date not null,
  period_to date not null,
  status public.gl_run_status not null default 'generated',
  base_currency_code text not null default 'USD',
  row_count integer not null default 0,
  total_debit numeric(16,2) not null default 0,
  total_credit numeric(16,2) not null default 0,
  source_counts jsonb not null default '{}'::jsonb,
  file_path text,
  downloaded_at timestamptz,
  superseded_by uuid references public.gl_export_runs(id),
  superseded_at timestamptz,
  generated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gl_export_runs_number_unique unique (company_id, run_number),
  constraint gl_export_runs_range check (period_to >= period_from)
);

create index if not exists gl_export_runs_company_period_idx
  on public.gl_export_runs(company_id, period_from, period_to, status);

create or replace function public.gl_export_runs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.run_number is null then
    new.run_number := 'GL-' || lpad(public.next_gl_number(new.company_id, 'run')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists gl_export_runs_number_trg on public.gl_export_runs;
create trigger gl_export_runs_number_trg
  before insert on public.gl_export_runs
  for each row execute function public.gl_export_runs_before_insert();

drop trigger if exists gl_export_runs_updated_at on public.gl_export_runs;
create trigger gl_export_runs_updated_at
  before update on public.gl_export_runs
  for each row execute function public.set_updated_at();

grant select, insert, update on public.gl_export_runs to authenticated;
grant all on public.gl_export_runs to service_role;
revoke all on public.gl_export_runs from anon;
alter table public.gl_export_runs enable row level security;

drop policy if exists gl_export_runs_select on public.gl_export_runs;
create policy gl_export_runs_select on public.gl_export_runs
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists gl_export_runs_insert on public.gl_export_runs;
create policy gl_export_runs_insert on public.gl_export_runs
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

drop policy if exists gl_export_runs_update on public.gl_export_runs;
create policy gl_export_runs_update on public.gl_export_runs
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

-- ---------------------------------------------------- gl_journal_entries
create table if not exists public.gl_journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  run_id uuid not null references public.gl_export_runs(id) on delete cascade,
  line_no integer not null,
  entry_date date not null,
  event_type public.gl_event_type not null,
  account_code text not null,
  account_name text not null,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  currency_code text not null,
  memo text not null,
  source_type text not null,
  source_id uuid,
  source_number text,
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint gl_journal_entries_line_unique unique (run_id, line_no),
  constraint gl_journal_entries_one_side check ((debit > 0) <> (credit > 0))
);

create index if not exists gl_journal_entries_run_idx
  on public.gl_journal_entries(run_id, line_no);
create index if not exists gl_journal_entries_company_source_idx
  on public.gl_journal_entries(company_id, source_type, source_id);

grant select, insert on public.gl_journal_entries to authenticated;
grant all on public.gl_journal_entries to service_role;
revoke all on public.gl_journal_entries from anon;
alter table public.gl_journal_entries enable row level security;

-- append-only: select + insert only, no update/delete policies
drop policy if exists gl_journal_entries_select on public.gl_journal_entries;
create policy gl_journal_entries_select on public.gl_journal_entries
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists gl_journal_entries_insert on public.gl_journal_entries;
create policy gl_journal_entries_insert on public.gl_journal_entries
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

-- ------------------------------------------- default chart of accounts
insert into public.gl_account_mappings
  (company_id, event_type, debit_account_code, debit_account_name,
   credit_account_code, credit_account_name)
select c.id, m.event_type, m.dr_code, m.dr_name, m.cr_code, m.cr_name
from public.companies c
cross join (values
  ('invoice_receivable_issued'::public.gl_event_type,'1200','Accounts Receivable','4000','Contract Revenue'),
  ('invoice_payable_received','5000','Cost of Works','2100','Accounts Payable'),
  ('payment_received','1000','Cash and Bank','1200','Accounts Receivable'),
  ('payment_made','2100','Accounts Payable','1000','Cash and Bank'),
  ('retention_withheld','1250','Retention Receivable','1200','Accounts Receivable'),
  ('change_order_approved','1200','Accounts Receivable','4100','Change Order Revenue'),
  ('debit_note_issued','1200','Accounts Receivable','4200','Back-charges and Debit Notes')
) as m(event_type, dr_code, dr_name, cr_code, cr_name)
on conflict (company_id, event_type) do nothing;