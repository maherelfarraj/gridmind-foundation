-- 0081_finance_period_close.sql — P-200 period close enforcement.

do $$ begin
  create type public.finance_period_status as enum ('open','closing','closed');
exception when duplicate_object then null; end $$;

-- Raises when the month of p_date is a closed finance period. Server fns map the
-- 'finance_period_closed' message prefix to a typed 409.
create or replace function public.assert_finance_period_open(p_company_id uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare v_status public.finance_period_status;
begin
  select status into v_status from public.finance_periods
   where company_id = p_company_id
     and period_month = date_trunc('month', p_date)::date;
  if v_status = 'closed' then
    raise exception 'finance_period_closed: % is closed for financial mutations',
      date_trunc('month', p_date)::date;
  end if;
end $$;

create or replace function public.close_finance_period(p_company_id uuid, p_period_month date)
returns public.finance_periods language plpgsql security definer set search_path = public as $$
declare v_row public.finance_periods;
begin
  if not (public.has_company_role('finance_admin') or public.has_company_role('company_admin')) then
    raise exception 'forbidden: finance_admin or company_admin required';
  end if;
  if not public.is_company_member(p_company_id) then
    raise exception 'forbidden: not a member of this company';
  end if;
  insert into public.finance_periods (company_id, period_month, status)
  values (p_company_id, date_trunc('month', p_period_month)::date, 'open')
  on conflict (company_id, period_month) do nothing;
  update public.finance_periods
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where company_id = p_company_id
     and period_month = date_trunc('month', p_period_month)::date
     and status <> 'closed'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.finance_periods
     where company_id = p_company_id
       and period_month = date_trunc('month', p_period_month)::date;
  end if;
  return v_row;
end $$;

create or replace function public.reopen_finance_period(p_company_id uuid, p_period_month date)
returns public.finance_periods language plpgsql security definer set search_path = public as $$
declare v_row public.finance_periods;
begin
  if not public.has_company_role('company_admin') then
    raise exception 'forbidden: company_admin required to reopen';
  end if;
  if not public.is_company_member(p_company_id) then
    raise exception 'forbidden: not a member of this company';
  end if;
  update public.finance_periods
     set status = 'open', closed_by = null, closed_at = null
   where company_id = p_company_id
     and period_month = date_trunc('month', p_period_month)::date
     and status = 'closed'
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.finance_periods
     where company_id = p_company_id
       and period_month = date_trunc('month', p_period_month)::date;
  end if;
  return v_row;
end $$;

revoke all on function public.assert_finance_period_open(uuid, date) from public, anon;
revoke all on function public.close_finance_period(uuid, date) from public, anon;
revoke all on function public.reopen_finance_period(uuid, date) from public, anon;

grant execute on function public.assert_finance_period_open(uuid, date) to authenticated;
grant execute on function public.close_finance_period(uuid, date) to authenticated;
grant execute on function public.reopen_finance_period(uuid, date) to authenticated;