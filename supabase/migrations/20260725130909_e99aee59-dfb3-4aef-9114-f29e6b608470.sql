-- P-117: scheduled_reports (weekly/monthly/quarterly PDF report delivery)

create table if not exists public.scheduled_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid null references public.projects(id) on delete cascade,
  name text not null,
  report_type text not null default 'om_monthly'
    check (report_type in ('om_monthly','weekly_field','quarterly_investor')),
  frequency text not null
    check (frequency in ('weekly','monthly','quarterly')),
  day_of_week smallint check (day_of_week between 0 and 6),
  day_of_month smallint check (day_of_month between 1 and 28),
  hour_utc smallint not null default 9 check (hour_utc between 0 and 23),
  recipients text[] not null default '{}',
  template_sections jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text check (last_run_status in ('success','error','skipped')),
  last_run_error text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scheduled_reports_freq_days check (
    (frequency = 'weekly' and day_of_week is not null) or
    (frequency in ('monthly','quarterly') and day_of_month is not null)
  ),
  constraint scheduled_reports_recipients_nonempty check (array_length(recipients, 1) >= 1)
);

create index if not exists scheduled_reports_company_idx
  on public.scheduled_reports (company_id, is_active, next_run_at);
create index if not exists scheduled_reports_next_run_idx
  on public.scheduled_reports (next_run_at) where is_active;

grant select, insert, update, delete on public.scheduled_reports to authenticated;
grant all on public.scheduled_reports to service_role;

alter table public.scheduled_reports enable row level security;

create policy "scheduled_reports_select" on public.scheduled_reports
  for select to authenticated
  using (public.is_company_member(company_id));

create policy "scheduled_reports_insert" on public.scheduled_reports
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('company_admin'::app_role)
      or public.has_company_role('project_admin'::app_role)
    )
  );

create policy "scheduled_reports_update" on public.scheduled_reports
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('company_admin'::app_role)
      or public.has_company_role('project_admin'::app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('company_admin'::app_role)
      or public.has_company_role('project_admin'::app_role)
    )
  );

create policy "scheduled_reports_delete" on public.scheduled_reports
  for delete to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('company_admin'::app_role)
      or public.has_company_role('project_admin'::app_role)
    )
  );

drop trigger if exists trg_scheduled_reports_updated_at on public.scheduled_reports;
create trigger trg_scheduled_reports_updated_at
  before update on public.scheduled_reports
  for each row execute function public.set_updated_at();

-- compute_next_run: given frequency + day + hour_utc + from_ts, return the next fire time.
create or replace function public.compute_next_run(
  p_frequency text,
  p_day_of_week int,
  p_day_of_month int,
  p_hour_utc int,
  p_from timestamptz default now()
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_from date := (p_from at time zone 'UTC')::date;
  v_hour int := coalesce(p_hour_utc, 9);
  v_candidate timestamptz;
  v_dow int;
  v_target_dow int;
  v_delta int;
  v_year int;
  v_month int;
  v_dom int;
  v_next_month_start date;
begin
  if p_frequency = 'weekly' then
    if p_day_of_week is null then
      raise exception 'day_of_week required for weekly';
    end if;
    v_dow := extract(dow from v_from)::int;
    v_target_dow := p_day_of_week;
    v_delta := (v_target_dow - v_dow + 7) % 7;
    v_candidate := ((v_from + v_delta)::timestamp + make_interval(hours => v_hour)) at time zone 'UTC';
    if v_candidate <= p_from then
      v_candidate := v_candidate + interval '7 days';
    end if;
    return v_candidate;

  elsif p_frequency = 'monthly' then
    if p_day_of_month is null then
      raise exception 'day_of_month required for monthly';
    end if;
    v_dom := least(greatest(p_day_of_month, 1), 28);
    v_year := extract(year from v_from)::int;
    v_month := extract(month from v_from)::int;
    v_candidate := (make_date(v_year, v_month, v_dom)::timestamp + make_interval(hours => v_hour)) at time zone 'UTC';
    if v_candidate <= p_from then
      v_next_month_start := (make_date(v_year, v_month, 1) + interval '1 month')::date;
      v_candidate := (make_date(
        extract(year from v_next_month_start)::int,
        extract(month from v_next_month_start)::int,
        v_dom
      )::timestamp + make_interval(hours => v_hour)) at time zone 'UTC';
    end if;
    return v_candidate;

  elsif p_frequency = 'quarterly' then
    if p_day_of_month is null then
      raise exception 'day_of_month required for quarterly';
    end if;
    v_dom := least(greatest(p_day_of_month, 1), 28);
    v_year := extract(year from v_from)::int;
    v_month := extract(month from v_from)::int;
    -- quarter start month: 1, 4, 7, 10
    v_month := ((v_month - 1) / 3) * 3 + 1;
    v_candidate := (make_date(v_year, v_month, v_dom)::timestamp + make_interval(hours => v_hour)) at time zone 'UTC';
    if v_candidate <= p_from then
      v_next_month_start := (make_date(v_year, v_month, 1) + interval '3 months')::date;
      v_candidate := (make_date(
        extract(year from v_next_month_start)::int,
        extract(month from v_next_month_start)::int,
        v_dom
      )::timestamp + make_interval(hours => v_hour)) at time zone 'UTC';
    end if;
    return v_candidate;
  else
    raise exception 'invalid frequency: %', p_frequency;
  end if;
end;
$$;

grant execute on function public.compute_next_run(text, int, int, int, timestamptz) to authenticated, service_role;
