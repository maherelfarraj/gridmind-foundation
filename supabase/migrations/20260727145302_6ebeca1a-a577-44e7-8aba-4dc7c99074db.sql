-- 0091_timesheets.sql — P-227 timesheets, entries, leave requests & balances. Idempotent.

do $$ begin
  create type public.timesheet_status as enum ('draft','submitted','in_review','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.timesheet_activity as enum ('regular','overtime','travel','leave_annual','leave_sick','leave_unpaid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_type as enum ('annual','sick','unpaid','travel');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_request_status as enum ('pending','approved','rejected','cancelled');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- counters
create table if not exists public.timesheet_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.timesheet_counters enable row level security; -- trigger-only, no policies
grant all on public.timesheet_counters to service_role;
revoke all on public.timesheet_counters from anon, authenticated;

create or replace function public.next_timesheet_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.timesheet_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.timesheet_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

revoke all on function public.next_timesheet_number(uuid, text) from anon, authenticated, public;

-- --------------------------------------------------------- profiles addon
alter table public.profiles add column if not exists default_hourly_rate numeric(12,2);

-- ------------------------------------------------------------- timesheets
create table if not exists public.timesheets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  timesheet_number text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  week_start date not null,
  status public.timesheet_status not null default 'draft',
  total_regular_hours numeric(8,2) not null default 0,
  total_overtime_hours numeric(8,2) not null default 0,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id) on delete set null,
  approval_instance_id uuid references public.approval_instances(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheets_week_start_monday check (extract(isodow from week_start) = 1),
  constraint timesheets_unique_week unique (company_id, user_id, week_start)
);

create index if not exists timesheets_company_week_idx on public.timesheets(company_id, week_start desc);
create index if not exists timesheets_company_user_idx on public.timesheets(company_id, user_id);
create index if not exists timesheets_company_status_idx on public.timesheets(company_id, status);

grant select, insert, update, delete on public.timesheets to authenticated;
grant all on public.timesheets to service_role;
revoke all on public.timesheets from anon;
alter table public.timesheets enable row level security;

drop trigger if exists timesheets_updated_at on public.timesheets;
create trigger timesheets_updated_at before update on public.timesheets
  for each row execute function public.set_updated_at();

create or replace function public.timesheets_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.timesheet_number is null then
    new.timesheet_number := 'TS-' || lpad(public.next_timesheet_number(new.company_id, 'timesheet')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists timesheets_number_trg on public.timesheets;
create trigger timesheets_number_trg before insert on public.timesheets
  for each row execute function public.timesheets_before_insert();

-- ------------------------------------------------------- timesheet_entries
create table if not exists public.timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  work_date date not null,
  project_id uuid references public.projects(id) on delete set null,
  cwp_id uuid,
  activity public.timesheet_activity not null default 'regular',
  hours numeric(4,2) not null default 0,
  hourly_rate numeric(12,2),
  notes text,
  source_leave_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint timesheet_entries_hours_range check (hours >= 0 and hours <= 24),
  constraint timesheet_entries_unique_slot unique (timesheet_id, work_date, project_id, activity)
);

-- conditional FK: Batch 21 (construction_work_packages) may not be present
do $$ begin
  if to_regclass('public.construction_work_packages') is not null
     and not exists (select 1 from pg_constraint where conname = 'timesheet_entries_cwp_fk') then
    alter table public.timesheet_entries
      add constraint timesheet_entries_cwp_fk
      foreign key (cwp_id) references public.construction_work_packages(id) on delete set null;
  end if;
end $$;

create index if not exists timesheet_entries_timesheet_idx on public.timesheet_entries(timesheet_id, work_date);
create index if not exists timesheet_entries_company_date_idx on public.timesheet_entries(company_id, work_date desc);
create index if not exists timesheet_entries_project_idx on public.timesheet_entries(project_id);

grant select, insert, update, delete on public.timesheet_entries to authenticated;
grant all on public.timesheet_entries to service_role;
revoke all on public.timesheet_entries from anon;
alter table public.timesheet_entries enable row level security;

drop trigger if exists timesheet_entries_updated_at on public.timesheet_entries;
create trigger timesheet_entries_updated_at before update on public.timesheet_entries
  for each row execute function public.set_updated_at();

-- backstop: hour fields are frozen once the parent timesheet leaves draft
create or replace function public.timesheets_guard_locked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.timesheet_status;
begin
  select status into v_status from public.timesheets
   where id = coalesce(new.timesheet_id, old.timesheet_id);

  if v_status is null or v_status = 'draft' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    raise exception 'timesheet_locked: parent status %', v_status using errcode = 'check_violation';
  elsif tg_op = 'DELETE' then
    raise exception 'timesheet_locked: parent status %', v_status using errcode = 'check_violation';
  elsif new.hours is distinct from old.hours
     or new.activity is distinct from old.activity
     or new.work_date is distinct from old.work_date
     or new.project_id is distinct from old.project_id
     or new.timesheet_id is distinct from old.timesheet_id then
    raise exception 'timesheet_locked: parent status %', v_status using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists timesheet_entries_guard_locked on public.timesheet_entries;
create trigger timesheet_entries_guard_locked
  before insert or update or delete on public.timesheet_entries
  for each row execute function public.timesheets_guard_locked();

-- ---------------------------------------------------------- leave_requests
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_number text,
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type public.leave_type not null default 'annual',
  date_from date not null,
  date_to date not null,
  days numeric(6,2) not null default 0,
  reason text,
  status public.leave_request_status not null default 'pending',
  approver_id uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_comment text,
  attachment_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_range check (date_to >= date_from),
  constraint leave_requests_unique unique (company_id, user_id, leave_type, date_from, date_to)
);

create index if not exists leave_requests_company_status_idx on public.leave_requests(company_id, status);
create index if not exists leave_requests_company_user_idx on public.leave_requests(company_id, user_id, date_from desc);

grant select, insert, update, delete on public.leave_requests to authenticated;
grant all on public.leave_requests to service_role;
revoke all on public.leave_requests from anon;
alter table public.leave_requests enable row level security;

drop trigger if exists leave_requests_updated_at on public.leave_requests;
create trigger leave_requests_updated_at before update on public.leave_requests
  for each row execute function public.set_updated_at();

create or replace function public.leave_requests_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_number is null then
    new.request_number := 'LR-' || lpad(public.next_timesheet_number(new.company_id, 'leave_request')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists leave_requests_number_trg on public.leave_requests;
create trigger leave_requests_number_trg before insert on public.leave_requests
  for each row execute function public.leave_requests_before_insert();

do $$ begin
  if to_regclass('public.leave_requests') is not null
     and not exists (select 1 from pg_constraint where conname = 'timesheet_entries_leave_fk') then
    alter table public.timesheet_entries
      add constraint timesheet_entries_leave_fk
      foreign key (source_leave_request_id) references public.leave_requests(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------- leave_balances
create table if not exists public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  annual_entitlement_days numeric(6,2) not null default 21,
  annual_used_days numeric(6,2) not null default 0,
  sick_used_days numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_balances_unique unique (company_id, user_id)
);

grant select, insert, update, delete on public.leave_balances to authenticated;
grant all on public.leave_balances to service_role;
revoke all on public.leave_balances from anon;
alter table public.leave_balances enable row level security;

drop trigger if exists leave_balances_updated_at on public.leave_balances;
create trigger leave_balances_updated_at before update on public.leave_balances
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ RLS
-- timesheets
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (user_id = auth.uid()
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (user_id = auth.uid()
      or public.has_company_role('construction_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')));

drop policy if exists timesheets_update on public.timesheets;
create policy timesheets_update on public.timesheets
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and ((user_id = auth.uid() and status = 'draft')
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (user_id = auth.uid()
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists timesheets_delete on public.timesheets;
create policy timesheets_delete on public.timesheets
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and status = 'draft'
    and (user_id = auth.uid()
      or public.has_company_role('construction_admin') or public.has_company_role('company_admin')));

-- timesheet_entries
drop policy if exists timesheet_entries_select on public.timesheet_entries;
create policy timesheet_entries_select on public.timesheet_entries
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.timesheets t
       where t.id = timesheet_entries.timesheet_id
         and t.company_id = timesheet_entries.company_id
         and (t.user_id = auth.uid()
           or public.has_company_role('foreman') or public.has_company_role('construction_admin')
           or public.has_company_role('project_admin') or public.has_company_role('company_admin'))));

drop policy if exists timesheet_entries_insert on public.timesheet_entries;
create policy timesheet_entries_insert on public.timesheet_entries
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.timesheets t
       where t.id = timesheet_entries.timesheet_id
         and t.company_id = timesheet_entries.company_id
         and t.status = 'draft'
         and (t.user_id = auth.uid()
           or public.has_company_role('construction_admin') or public.has_company_role('project_admin')
           or public.has_company_role('company_admin'))));

drop policy if exists timesheet_entries_update on public.timesheet_entries;
create policy timesheet_entries_update on public.timesheet_entries
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.timesheets t
       where t.id = timesheet_entries.timesheet_id
         and t.company_id = timesheet_entries.company_id
         and (t.status = 'draft'
           or public.has_company_role('construction_admin') or public.has_company_role('project_admin')
           or public.has_company_role('company_admin'))
         and (t.user_id = auth.uid()
           or public.has_company_role('foreman') or public.has_company_role('construction_admin')
           or public.has_company_role('project_admin') or public.has_company_role('company_admin'))))
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.timesheets t
       where t.id = timesheet_entries.timesheet_id
         and t.company_id = timesheet_entries.company_id
         and (t.user_id = auth.uid()
           or public.has_company_role('foreman') or public.has_company_role('construction_admin')
           or public.has_company_role('project_admin') or public.has_company_role('company_admin'))));

drop policy if exists timesheet_entries_delete on public.timesheet_entries;
create policy timesheet_entries_delete on public.timesheet_entries
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.timesheets t
       where t.id = timesheet_entries.timesheet_id
         and t.company_id = timesheet_entries.company_id
         and t.status = 'draft'
         and (t.user_id = auth.uid()
           or public.has_company_role('construction_admin') or public.has_company_role('project_admin')
           or public.has_company_role('company_admin'))));

-- leave_requests
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (user_id = auth.uid()
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists leave_requests_insert on public.leave_requests;
create policy leave_requests_insert on public.leave_requests
  for insert to authenticated
  with check (public.is_company_member(company_id) and user_id = auth.uid() and status = 'pending');

drop policy if exists leave_requests_update on public.leave_requests;
create policy leave_requests_update on public.leave_requests
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and ((user_id = auth.uid() and status = 'pending')
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and ((user_id = auth.uid() and status in ('pending','cancelled'))
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists leave_requests_delete on public.leave_requests;
create policy leave_requests_delete on public.leave_requests
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and status = 'pending'
    and (user_id = auth.uid() or public.has_company_role('company_admin')));

-- leave_balances
drop policy if exists leave_balances_select on public.leave_balances;
create policy leave_balances_select on public.leave_balances
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (user_id = auth.uid()
      or public.has_company_role('foreman') or public.has_company_role('construction_admin')
      or public.has_company_role('project_admin') or public.has_company_role('company_admin')));

drop policy if exists leave_balances_insert on public.leave_balances;
create policy leave_balances_insert on public.leave_balances
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('construction_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')));

drop policy if exists leave_balances_update on public.leave_balances;
create policy leave_balances_update on public.leave_balances
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('construction_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('construction_admin') or public.has_company_role('project_admin')
      or public.has_company_role('company_admin')));

drop policy if exists leave_balances_delete on public.leave_balances;
create policy leave_balances_delete on public.leave_balances
  for delete to authenticated
  using (public.is_company_member(company_id) and public.has_company_role('company_admin'));