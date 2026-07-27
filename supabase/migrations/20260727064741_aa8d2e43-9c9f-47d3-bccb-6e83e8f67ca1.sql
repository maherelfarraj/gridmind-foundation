-- 0079_finance_core.sql — P-193 payments, AR reminders, finance periods, invoice lifecycle.

-- ---------------------------------------------------------------- enums
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'invoice_status' and e.enumlabel = 'sent') then
    alter type public.invoice_status add value 'sent';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'invoice_status' and e.enumlabel = 'partially_paid') then
    alter type public.invoice_status add value 'partially_paid';
  end if;
end $$;

do $$ begin
  create type public.payment_method as enum ('bank_transfer','cash','cheque','card','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_reconciliation_status as enum ('unmatched','matched','partial','excluded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_record_status as enum ('recorded','voided');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ar_reminder_channel as enum ('email','phone','letter','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ar_reminder_status as enum ('sent','responded','escalated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finance_period_status as enum ('open','closing','closed');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------- invoices additive cols
alter table public.invoices
  add column if not exists paid_amount numeric(14,2) not null default 0,
  add column if not exists last_payment_at timestamptz;

-- ------------------------------------------------------------- counters
create table if not exists public.payment_counters (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_number integer not null default 0
);
alter table public.payment_counters enable row level security;
grant select on public.payment_counters to authenticated;
grant all on public.payment_counters to service_role;

-- -------------------------------------------------------------- payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  payment_number text,
  direction public.invoice_direction,
  project_id uuid references public.projects(id),
  amount numeric(14,2) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  fx_rate_to_base numeric(14,6),
  amount_base numeric(14,2),
  base_currency_code text,
  payment_date date not null default current_date,
  method public.payment_method not null default 'bank_transfer',
  bank_reference text,
  reconciliation_status public.payment_reconciliation_status not null default 'unmatched',
  record_status public.payment_record_status not null default 'recorded',
  voided_reason text,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  received_by uuid references public.profiles(id),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_number_unique unique (company_id, payment_number)
);

create index if not exists payments_company_invoice_idx on public.payments(company_id, invoice_id);
create index if not exists payments_company_recon_idx on public.payments(company_id, reconciliation_status);
create index if not exists payments_company_date_idx on public.payments(company_id, payment_date);

-- base-currency resolver: project financial config, else USD.
create or replace function public.finance_base_currency(p_company_id uuid, p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select pfc.currency_code from public.project_financial_config pfc
      where pfc.project_id = p_project_id limit 1),
    'USD');
$$;

create or replace function public.payments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_base text;
  v_rate numeric(14,6);
  v_n integer;
begin
  select * into v_inv from public.invoices where id = new.invoice_id;
  if not found then
    raise exception 'invoice_not_found' using errcode = 'P0002';
  end if;
  if v_inv.company_id <> new.company_id then
    raise exception 'cross_company_payment' using errcode = '42501';
  end if;

  new.direction := v_inv.direction;
  new.project_id := coalesce(new.project_id, v_inv.project_id);
  new.currency_code := coalesce(new.currency_code, v_inv.currency_code);

  v_base := public.finance_base_currency(new.company_id, new.project_id);
  new.base_currency_code := v_base;

  if new.currency_code = v_base then
    v_rate := 1.0;
  else
    select f.rate into v_rate
      from public.fx_rates f
     where f.base_code = new.currency_code
       and f.quote_code = v_base
       and f.as_of <= new.payment_date
     order by f.as_of desc
     limit 1;
    if v_rate is null then
      raise exception 'fx_rate_missing: % -> % as of %', new.currency_code, v_base, new.payment_date
        using errcode = 'P0001';
    end if;
  end if;

  new.fx_rate_to_base := v_rate;
  new.amount_base := round(new.amount * v_rate, 2);

  if new.payment_number is null then
    insert into public.payment_counters (company_id, last_number)
    values (new.company_id, 1)
    on conflict (company_id) do update set last_number = public.payment_counters.last_number + 1
    returning last_number into v_n;
    new.payment_number := 'PM-' || lpad(v_n::text, 4, '0');
  end if;

  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;

drop trigger if exists payments_before_insert_trg on public.payments;
create trigger payments_before_insert_trg
  before insert on public.payments
  for each row execute function public.payments_before_insert();

drop trigger if exists set_updated_at_payments on public.payments;
create trigger set_updated_at_payments
  before update on public.payments
  for each row execute function public.set_updated_at();

grant select, insert, update on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (is_company_member(company_id));

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin')
         or has_company_role('procurement_admin'))
  );

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin')
         or has_company_role('procurement_admin'))
  )
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin')
         or has_company_role('procurement_admin'))
  );

-- ---------------------------------------------------------- ar_reminders
create table if not exists public.ar_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  reminder_number integer not null,
  channel public.ar_reminder_channel not null default 'email',
  template text,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles(id),
  response_notes text,
  status public.ar_reminder_status not null default 'sent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ar_reminders_seq_unique unique (invoice_id, reminder_number)
);

create index if not exists ar_reminders_company_status_idx
  on public.ar_reminders(company_id, status, sent_at desc);

drop trigger if exists set_updated_at_ar_reminders on public.ar_reminders;
create trigger set_updated_at_ar_reminders
  before update on public.ar_reminders
  for each row execute function public.set_updated_at();

grant select, insert, update on public.ar_reminders to authenticated;
grant all on public.ar_reminders to service_role;
alter table public.ar_reminders enable row level security;

drop policy if exists ar_reminders_select on public.ar_reminders;
create policy ar_reminders_select on public.ar_reminders
  for select to authenticated
  using (is_company_member(company_id));

drop policy if exists ar_reminders_insert on public.ar_reminders;
create policy ar_reminders_insert on public.ar_reminders
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

drop policy if exists ar_reminders_update on public.ar_reminders;
create policy ar_reminders_update on public.ar_reminders
  for update to authenticated
  using (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  )
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

-- -------------------------------------------------------- finance_periods
create table if not exists public.finance_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  period_month date not null,
  status public.finance_period_status not null default 'open',
  close_checklist jsonb not null default '[]'::jsonb,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_periods_month_start check (period_month = date_trunc('month', period_month)::date),
  constraint finance_periods_unique unique (company_id, period_month)
);

create index if not exists finance_periods_company_idx
  on public.finance_periods(company_id, period_month desc);

drop trigger if exists set_updated_at_finance_periods on public.finance_periods;
create trigger set_updated_at_finance_periods
  before update on public.finance_periods
  for each row execute function public.set_updated_at();

grant select, insert, update on public.finance_periods to authenticated;
grant all on public.finance_periods to service_role;
alter table public.finance_periods enable row level security;

drop policy if exists finance_periods_select on public.finance_periods;
create policy finance_periods_select on public.finance_periods
  for select to authenticated
  using (is_company_member(company_id));

drop policy if exists finance_periods_insert on public.finance_periods;
create policy finance_periods_insert on public.finance_periods
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

drop policy if exists finance_periods_update on public.finance_periods;
create policy finance_periods_update on public.finance_periods
  for update to authenticated
  using (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  )
  with check (
    is_company_member(company_id)
    and (has_company_role('finance_admin') or has_company_role('company_admin'))
  );

revoke delete on public.payments from authenticated;
revoke delete on public.ar_reminders from authenticated;
revoke delete on public.finance_periods from authenticated;