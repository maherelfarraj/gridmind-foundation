-- P-251 — Portfolio aggregation layer.
-- Company-scoped, external-viewer-proof, audited (ops.portfolio_view).

create or replace function public.portfolio_guard(p_rpc text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if public.is_external_viewer() then
    raise exception 'portfolio_access_denied' using errcode = '42501';
  end if;
  select p.company_id into v_company from public.profiles p where p.id = auth.uid();
  if v_company is null then
    raise exception 'portfolio_access_denied' using errcode = '42501';
  end if;
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_company, auth.uid(), 'ops.portfolio_view', 'portfolio', null,
          jsonb_build_object('rpc', p_rpc));
  return v_company;
end;
$$;

revoke all on function public.portfolio_guard(text) from public, anon;
grant execute on function public.portfolio_guard(text) to authenticated;

-- ---------------------------------------------------------------- KPIs -----
create or replace function public.portfolio_kpis()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_kpis');
  v_base text;
  v_result jsonb;
begin
  select coalesce(min(pfc.currency_code), 'USD') into v_base
  from public.project_financial_config pfc where pfc.company_id = v_company;

  with proj as (
    select * from public.projects where company_id = v_company
  ),
  latest_evm as (
    select distinct on (e.project_id) e.*
    from public.evm_snapshots e
    join proj p on p.id = e.project_id
    where e.company_id = v_company
    order by e.project_id, e.snapshot_date desc, e.created_at desc
  ),
  evm_agg as (
    select coalesce(sum(planned_value), 0) pv,
           coalesce(sum(earned_value), 0) ev,
           coalesce(sum(actual_cost), 0) ac,
           coalesce(sum(budget_at_completion), 0) bac
    from latest_evm
  ),
  inv as (
    select direction,
           coalesce(sum(greatest(coalesce(amount, 0) + coalesce(tax_amount, 0)
                                 - coalesce(paid_amount, 0), 0)), 0) open_amount
    from public.invoices
    where company_id = v_company
      and status not in ('paid', 'cancelled', 'draft')
    group by direction
  ),
  cash_mtd as (
    select direction, coalesce(sum(amount_base), 0) total
    from public.cash_flows
    where company_id = v_company
      and kind = 'actual'
      and coalesce(voided, false) = false
      and period >= date_trunc('month', current_date)::date
      and period < (date_trunc('month', current_date) + interval '1 month')::date
    group by direction
  )
  select jsonb_build_object(
    'base_currency', v_base,
    'projects', jsonb_build_object(
      'total', (select count(*) from proj),
      'by_phase', coalesce((select jsonb_object_agg(phase, n) from
        (select phase::text phase, count(*) n from proj group by 1) x), '{}'::jsonb),
      'by_status', coalesce((select jsonb_object_agg(status, n) from
        (select status::text status, count(*) n from proj group by 1) y), '{}'::jsonb)
    ),
    'contract_value', coalesce((select sum(value) from public.contracts
       where company_id = v_company and status::text <> 'cancelled'), 0),
    'evm', (select jsonb_build_object(
        'pv', pv, 'ev', ev, 'ac', ac, 'bac', bac,
        -- weighted, never an average of ratios
        'spi', case when pv > 0 then round(ev / pv, 6) else null end,
        'cpi', case when ac > 0 then round(ev / ac, 6) else null end,
        'projects_counted', (select count(*) from latest_evm)
      ) from evm_agg),
    'ar_open', coalesce((select open_amount from inv where direction = 'receivable'), 0),
    'ap_open', coalesce((select open_amount from inv where direction = 'payable'), 0),
    'cash_mtd', jsonb_build_object(
      'inflow', coalesce((select total from cash_mtd where direction = 'inflow'), 0),
      'outflow', coalesce((select total from cash_mtd where direction = 'outflow'), 0)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.portfolio_kpis() from public, anon;
grant execute on function public.portfolio_kpis() to authenticated;

-- --------------------------------------------------------------- Gates -----
create or replace function public.portfolio_gates()
returns table (
  project_id uuid,
  project_code text,
  project_name text,
  phase text,
  status text,
  gates_total integer,
  gates_approved integer,
  current_gate_name text,
  current_gate_status text,
  next_gate_name text,
  next_gate_due date
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_gates');
begin
  return query
  with g as (
    select pg.*, row_number() over (partition by pg.project_id
      order by pg.sort_order, pg.created_at) rn
    from public.project_phase_gates pg
    where pg.company_id = v_company
  ),
  pending as (
    select distinct on (g.project_id) g.project_id, g.name, g.sort_order
    from g where g.status <> 'approved'
    order by g.project_id, g.sort_order, g.created_at
  )
  select p.id,
         p.code,
         p.name,
         p.phase::text,
         p.status::text,
         (select count(*)::int from g where g.project_id = p.id),
         (select count(*)::int from g where g.project_id = p.id and g.status = 'approved'),
         (select g.name from g where g.project_id = p.id
            and g.status = 'approved' order by g.sort_order desc limit 1),
         coalesce((select g.status from g where g.project_id = p.id
            and g.status <> 'approved' order by g.sort_order limit 1), 'approved'),
         (select pd.name from pending pd where pd.project_id = p.id),
         p.target_cod
  from public.projects p
  where p.company_id = v_company
  order by p.code;
end;
$$;

revoke all on function public.portfolio_gates() from public, anon;
grant execute on function public.portfolio_gates() to authenticated;

-- ------------------------------------------------------- HSE / Quality -----
create or replace function public.portfolio_hse_quality()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_company uuid := public.portfolio_guard('portfolio_hse_quality');
  v_hours numeric;
  v_recordable numeric;
  v_result jsonb;
begin
  select coalesce(sum(ml.hours), 0) into v_hours
  from public.manpower_logs ml
  where ml.company_id = v_company;

  select count(*) into v_recordable
  from public.hse_incidents i
  where i.company_id = v_company and coalesce(i.osha_recordable, false);

  select jsonb_build_object(
    'incidents_open', (select count(*) from public.hse_incidents
        where company_id = v_company and status <> 'closed'),
    'incidents_total', (select count(*) from public.hse_incidents where company_id = v_company),
    'recordable_count', v_recordable,
    'exposure_hours', v_hours,
    -- hours-weighted aggregate: one rate over the whole portfolio's hours
    'trir', case when v_hours > 0 then round(v_recordable * 200000 / v_hours, 4) else null end,
    'punch_open', coalesce((select jsonb_object_agg(category, n) from (
        select category::text category, count(*) n
        from public.qaqc_punch_items
        where company_id = v_company and status in ('open', 'ready_for_review')
        group by 1) pc), '{}'::jsonb),
    'punch_open_total', (select count(*) from public.qaqc_punch_items
        where company_id = v_company and status in ('open', 'ready_for_review')),
    'ncr_open', (select count(*) from public.ncrs
        where company_id = v_company and status in ('open', 'in_progress')),
    'by_project', coalesce((select jsonb_agg(row_to_json(t)) from (
        select p.id project_id, p.code project_code, p.name project_name,
          (select count(*) from public.hse_incidents i
             where i.project_id = p.id and i.status <> 'closed') incidents_open,
          (select count(*) from public.qaqc_punch_items q
             where q.project_id = p.id and q.status in ('open', 'ready_for_review')) punch_open,
          (select count(*) from public.ncrs n
             where n.project_id = p.id and n.status in ('open', 'in_progress')) ncr_open
        from public.projects p
        where p.company_id = v_company
        order by p.code) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.portfolio_hse_quality() from public, anon;
grant execute on function public.portfolio_hse_quality() to authenticated;

-- ---------------------------------------------------------- Cash curve -----
create or replace function public.portfolio_cash_curve(p_months integer default 24)
returns table (
  month date,
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
  v_company uuid := public.portfolio_guard('portfolio_cash_curve');
  v_months integer := greatest(1, least(coalesce(p_months, 24), 120));
begin
  return query
  with rows_scoped as (
    select date_trunc('month', cf.period)::date m,
           cf.kind::text kind,
           cf.direction::text direction,
           -- FX at entry: amount_base is fixed at write time, never revalued
           coalesce(cf.amount_base, cf.amount) amt,
           cf.base_currency_code
    from public.cash_flows cf
    where cf.company_id = v_company
      and coalesce(cf.voided, false) = false
      and cf.period >= (date_trunc('month', current_date) - (v_months || ' months')::interval)::date
  )
  select r.m,
         coalesce(min(r.base_currency_code), 'USD'),
         coalesce(sum(amt) filter (where kind = 'forecast' and direction = 'inflow'), 0),
         coalesce(sum(amt) filter (where kind = 'forecast' and direction = 'outflow'), 0),
         coalesce(sum(amt) filter (where kind = 'actual' and direction = 'inflow'), 0),
         coalesce(sum(amt) filter (where kind = 'actual' and direction = 'outflow'), 0),
         coalesce(sum(amt) filter (where kind = 'forecast' and direction = 'inflow'), 0)
           - coalesce(sum(amt) filter (where kind = 'forecast' and direction = 'outflow'), 0),
         coalesce(sum(amt) filter (where kind = 'actual' and direction = 'inflow'), 0)
           - coalesce(sum(amt) filter (where kind = 'actual' and direction = 'outflow'), 0)
  from rows_scoped r
  group by r.m
  order by r.m;
end;
$$;

revoke all on function public.portfolio_cash_curve(integer) from public, anon;
grant execute on function public.portfolio_cash_curve(integer) to authenticated;