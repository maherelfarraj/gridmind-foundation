create or replace function public.portfolio_cash_curve_projects(
  p_back integer default 12,
  p_forward integer default 6
)
returns table (
  month date,
  project_id uuid,
  project_code text,
  project_name text,
  base_currency text,
  forecast_inflow numeric,
  forecast_outflow numeric,
  actual_inflow numeric,
  actual_outflow numeric,
  forecast_net numeric,
  actual_net numeric
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_cash_curve_projects');
  v_back integer := greatest(0, least(coalesce(p_back, 12), 120));
  v_fwd integer := greatest(0, least(coalesce(p_forward, 6), 120));
  v_start date := (date_trunc('month', current_date) - (v_back || ' months')::interval)::date;
  v_end date := (date_trunc('month', current_date) + ((v_fwd + 1) || ' months')::interval)::date;
begin
  return query
  with movements as (
    -- Planned/forecast entries plus any manual actual entries that are not a
    -- mirror of a payments-ledger row (FX at entry: amount_base is fixed).
    select date_trunc('month', cf.period)::date m,
           cf.project_id,
           cf.kind::text kind,
           cf.direction::text direction,
           coalesce(cf.amount_base, cf.amount) amt,
           coalesce(cf.base_currency_code, 'USD') cur
    from public.cash_flows cf
    where cf.company_id = v_company
      and coalesce(cf.voided, false) = false
      and cf.period >= v_start
      and cf.period < v_end
      and not (cf.kind::text = 'actual'
               and cf.reference_type = 'payment'
               and cf.reference_id is not null)
    union all
    -- Actual cash as it really moved: recorded receipts and payment runs.
    select date_trunc('month', pay.payment_date)::date,
           pay.project_id,
           'actual',
           case when pay.direction::text = 'receivable' then 'inflow' else 'outflow' end,
           coalesce(pay.amount_base, pay.amount),
           coalesce(pay.base_currency_code, 'USD')
    from public.payments pay
    where pay.company_id = v_company
      and pay.voided_at is null
      and pay.record_status::text = 'recorded'
      and pay.payment_date >= v_start
      and pay.payment_date < v_end
  )
  select mv.m,
         p.id,
         p.code,
         p.name,
         coalesce(min(mv.cur), 'USD'),
         coalesce(sum(mv.amt) filter (where mv.kind = 'forecast' and mv.direction = 'inflow'), 0),
         coalesce(sum(mv.amt) filter (where mv.kind = 'forecast' and mv.direction = 'outflow'), 0),
         coalesce(sum(mv.amt) filter (where mv.kind = 'actual' and mv.direction = 'inflow'), 0),
         coalesce(sum(mv.amt) filter (where mv.kind = 'actual' and mv.direction = 'outflow'), 0),
         coalesce(sum(mv.amt) filter (where mv.kind = 'forecast' and mv.direction = 'inflow'), 0)
         - coalesce(sum(mv.amt) filter (where mv.kind = 'forecast' and mv.direction = 'outflow'), 0),
         coalesce(sum(mv.amt) filter (where mv.kind = 'actual' and mv.direction = 'inflow'), 0)
         - coalesce(sum(mv.amt) filter (where mv.kind = 'actual' and mv.direction = 'outflow'), 0)
  from movements mv
  join public.projects p on p.id = mv.project_id
  group by 1, 2, 3, 4
  order by 1, 3;
end;
$$;

revoke all on function public.portfolio_cash_curve_projects(integer, integer) from public, anon;
grant execute on function public.portfolio_cash_curve_projects(integer, integer) to authenticated;

create or replace function public.portfolio_cash_month(p_month date)
returns table (
  id uuid,
  period date,
  project_id uuid,
  project_code text,
  project_name text,
  direction text,
  kind text,
  category text,
  amount numeric,
  currency_code text,
  amount_base numeric,
  base_currency text,
  reference_type text,
  reference_id uuid,
  notes text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_cash_month');
  v_start date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_end date := (date_trunc('month', coalesce(p_month, current_date)) + interval '1 month')::date;
begin
  return query
  select cf.id,
         cf.period,
         p.id,
         p.code,
         p.name,
         cf.direction::text,
         cf.kind::text,
         cf.category,
         cf.amount,
         cf.currency_code,
         coalesce(cf.amount_base, cf.amount),
         coalesce(cf.base_currency_code, 'USD'),
         cf.reference_type,
         cf.reference_id,
         cf.notes
  from public.cash_flows cf
  join public.projects p on p.id = cf.project_id
  where cf.company_id = v_company
    and coalesce(cf.voided, false) = false
    and cf.period >= v_start
    and cf.period < v_end
    and not (cf.kind::text = 'actual'
             and cf.reference_type = 'payment'
             and cf.reference_id is not null)
  union all
  select pay.id,
         pay.payment_date,
         p.id,
         p.code,
         p.name,
         case when pay.direction::text = 'receivable' then 'inflow' else 'outflow' end,
         'actual',
         pay.method::text,
         pay.amount,
         pay.currency_code,
         coalesce(pay.amount_base, pay.amount),
         coalesce(pay.base_currency_code, 'USD'),
         'payment',
         pay.id,
         coalesce(pay.notes, pay.payment_number)
  from public.payments pay
  join public.projects p on p.id = pay.project_id
  where pay.company_id = v_company
    and pay.voided_at is null
    and pay.record_status::text = 'recorded'
    and pay.payment_date >= v_start
    and pay.payment_date < v_end
  order by 2, 4, 6;
end;
$$;

revoke all on function public.portfolio_cash_month(date) from public, anon;
grant execute on function public.portfolio_cash_month(date) to authenticated;