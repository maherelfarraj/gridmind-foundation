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
  select date_trunc('month', cf.period)::date as m,
         p.id,
         p.code,
         p.name,
         coalesce(min(cf.base_currency_code), 'USD'),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'forecast' and cf.direction::text = 'inflow'), 0),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'forecast' and cf.direction::text = 'outflow'), 0),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'actual' and cf.direction::text = 'inflow'), 0),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'actual' and cf.direction::text = 'outflow'), 0),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'forecast' and cf.direction::text = 'inflow'), 0)
         - coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'forecast' and cf.direction::text = 'outflow'), 0),
         coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'actual' and cf.direction::text = 'inflow'), 0)
         - coalesce(sum(coalesce(cf.amount_base, cf.amount))
           filter (where cf.kind::text = 'actual' and cf.direction::text = 'outflow'), 0)
  from public.cash_flows cf
  join public.projects p on p.id = cf.project_id
  where cf.company_id = v_company
    and coalesce(cf.voided, false) = false
    and cf.period >= v_start
    and cf.period < v_end
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
    and cf.period < (v_start + interval '1 month')::date
  order by cf.period, p.code, cf.direction;
end;
$$;

revoke all on function public.portfolio_cash_month(date) from public, anon;
grant execute on function public.portfolio_cash_month(date) to authenticated;