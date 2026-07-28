-- P-252 — Per-project portfolio cards (drives the /portfolio project grid + gate rail).
create or replace function public.portfolio_project_cards()
returns table (
  project_id uuid,
  project_code text,
  project_name text,
  phase text,
  status text,
  target_cod date,
  contract_value numeric,
  currency_code text,
  planned_value numeric,
  earned_value numeric,
  actual_cost numeric,
  spi numeric,
  cpi numeric,
  punch_a_open integer,
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
  v_company uuid := public.portfolio_guard('portfolio_project_cards');
begin
  return query
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
  g as (
    select pg.* from public.project_phase_gates pg where pg.company_id = v_company
  )
  select p.id,
         p.code,
         p.name,
         p.phase::text,
         p.status::text,
         p.target_cod,
         coalesce((select sum(c.value) from public.contracts c
            where c.project_id = p.id and c.status::text <> 'cancelled'), 0),
         coalesce((select min(c.currency_code) from public.contracts c
            where c.project_id = p.id and c.status::text <> 'cancelled'), 'USD'),
         coalesce(e.planned_value, 0),
         coalesce(e.earned_value, 0),
         coalesce(e.actual_cost, 0),
         case when coalesce(e.planned_value, 0) > 0
              then round(e.earned_value / e.planned_value, 6) end,
         case when coalesce(e.actual_cost, 0) > 0
              then round(e.earned_value / e.actual_cost, 6) end,
         (select count(*)::int from public.qaqc_punch_items q
            where q.project_id = p.id and q.category::text = 'A'
              and q.status in ('open', 'ready_for_review')),
         (select count(*)::int from g where g.project_id = p.id),
         (select count(*)::int from g where g.project_id = p.id and g.status = 'approved'),
         (select g.name from g where g.project_id = p.id and g.status = 'approved'
            order by g.sort_order desc limit 1),
         coalesce((select g.status from g where g.project_id = p.id and g.status <> 'approved'
            order by g.sort_order limit 1), 'approved'),
         (select g.name from g where g.project_id = p.id and g.status <> 'approved'
            order by g.sort_order limit 1),
         p.target_cod
  from proj p
  left join latest_evm e on e.project_id = p.id
  order by p.code;
end;
$$;

revoke all on function public.portfolio_project_cards() from public, anon;
grant execute on function public.portfolio_project_cards() to authenticated;