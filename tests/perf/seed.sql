-- GC-15 perf fixture — transaction-scoped seeded volume for the four hot paths.
-- Everything below runs inside ONE transaction that is ALWAYS rolled back, so
-- no row ever becomes visible to another session or survives the test.
--
-- Identifiers are derived deterministically from a fixed namespace so repeated
-- runs are byte-identical and can never collide with real tenants.
\set ON_ERROR_STOP on
begin;

-- Belt and braces: the fixture must never be able to commit.
set transaction isolation level repeatable read;

create temporary table perf_ids on commit drop as
select
  md5('gc15-perf::company')::uuid                                     as company_id,
  md5('gc15-perf::company')::uuid                                     as ns;

insert into public.companies (id, name, slug)
select company_id, 'GC15 Perf Fixture (rolled back)', 'gc15-perf-fixture' from perf_ids;

insert into public.projects (id, company_id, name, code, archetype)
select md5('gc15-perf::project::' || g)::uuid,
       p.company_id,
       'GC15 Perf Project ' || g,
       'GC15-PERF-' || lpad(g::text, 3, '0'),
       'utility_pv'::project_archetype
from perf_ids p, generate_series(1, :projects) g;

-- ---------------------------------------------------------------------------
-- Cash flow: :periods months per project, :versions superseded historic
-- versions plus exactly one live (submitted) snapshot — the shape the partial
-- unique index cashflow_snapshots_active_idx enforces in production.
-- ---------------------------------------------------------------------------
insert into public.cashflow_snapshots (
  id, company_id, project_id, period_month, data_date, status, version_no,
  reporting_currency, project_currency
)
select md5('gc15-perf::cs::' || g || '::' || m || '::' || v)::uuid,
       p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (date '2019-01-01' + (m || ' months')::interval)::date,
       (date '2019-01-31' + (m || ' months')::interval)::date,
       case when v = :versions then 'submitted' else 'superseded' end::cashflow_snapshot_status,
       v,
       'USD', 'USD'
from perf_ids p,
     generate_series(1, :projects) g,
     generate_series(0, :periods - 1) m,
     generate_series(1, :versions) v;

insert into public.cashflow_snapshot_lines (
  company_id, snapshot_id, bucket_start, bucket_end, direction, source,
  category, amount_native, currency_code, amount_reporting, sort_order
)
select s.company_id,
       s.id,
       (s.period_month + (b || ' months')::interval)::date,
       (s.period_month + ((b + 1) || ' months')::interval - interval '1 day')::date,
       (array['inflow','outflow'])[1 + (b + k) % 2]::cash_flow_direction,
       (array['actual','invoice','commitment','accrual','forecast','retention'])[1 + (b * 3 + k) % 6]::cashflow_source,
       'cat-' || ((b + k) % 7),
       100000 + (b * 977 + k * 131) % 500000,
       'USD',
       100000 + (b * 977 + k * 131) % 500000,
       b * 10 + k
from public.cashflow_snapshots s,
     generate_series(0, :buckets - 1) b,
     generate_series(0, :lines_per_bucket - 1) k
where s.company_id = (select company_id from perf_ids)
  and s.status = 'submitted';

-- ---------------------------------------------------------------------------
-- Recognition: same shape.
-- ---------------------------------------------------------------------------
insert into public.recognition_snapshots (
  id, company_id, project_id, period_month, data_date, billing_cutoff, status,
  version_no, reporting_currency, project_currency
)
select md5('gc15-perf::rs::' || g || '::' || m || '::' || v)::uuid,
       p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (date '2019-01-01' + (m || ' months')::interval)::date,
       (date '2019-01-31' + (m || ' months')::interval)::date,
       (date '2019-01-31' + (m || ' months')::interval)::date,
       case when v = :versions then 'submitted' else 'superseded' end::recognition_snapshot_status,
       v,
       'USD', 'USD'
from perf_ids p,
     generate_series(1, :projects) g,
     generate_series(0, :periods - 1) m,
     generate_series(1, :versions) v;

insert into public.recognition_snapshot_lines (
  company_id, snapshot_id, label, method, currency_code,
  transaction_price, cost_incurred, progress_pct, period_revenue, sort_order
)
select s.company_id,
       s.id,
       'WBS ' || b || '.' || k,
       (array['cost_to_cost','milestone','output','straight_line'])[1 + (b + k) % 4]::recognition_method,
       'USD',
       1000000 + (b * 811 + k * 97) % 900000,
       400000 + (b * 613 + k * 71) % 300000,
       (b * 7 + k) % 100,
       50000 + (b * 331 + k * 29) % 40000,
       b * 10 + k
from public.recognition_snapshots s,
     generate_series(0, :buckets - 1) b,
     generate_series(0, :lines_per_bucket - 1) k
where s.company_id = (select company_id from perf_ids)
  and s.status = 'submitted';

-- ---------------------------------------------------------------------------
-- GC-16 Contracts & claims: claim register per project plus governed snapshots
-- and their frozen lines, same shape as the cashflow/recognition fixtures.
-- ---------------------------------------------------------------------------
insert into public.contract_claims (
  id, company_id, project_id, claim_ref, title, kind, status, currency_code,
  asserted_amount, submitted_amount, assessed_amount, approved_amount,
  forecast_amount, certified_amount, paid_amount, at_risk_amount, ld_exposure
)
select md5('gc16-perf::claim::' || g || '::' || c)::uuid,
       p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       'CL-' || lpad(g::text, 3, '0') || '-' || lpad(c::text, 4, '0'),
       'Perf claim ' || g || '/' || c,
       (array['variation','eot','prolongation','disruption','acceleration'])[1 + (g + c) % 5]::cc_claim_kind,
       (array['draft','notified','submitted','assessed','approved'])[1 + (g * 3 + c) % 5]::cc_claim_status,
       'USD',
       100000 + (g * 977 + c * 131) % 400000,
       90000 + (g * 811 + c * 97) % 300000,
       80000 + (g * 613 + c * 71) % 200000,
       70000 + (g * 419 + c * 53) % 150000,
       75000 + (g * 331 + c * 41) % 120000,
       60000 + (g * 233 + c * 37) % 90000,
       50000 + (g * 149 + c * 29) % 60000,
       20000 + (g * 101 + c * 23) % 40000,
       (g * 71 + c * 17) % 25000
from perf_ids p,
     generate_series(1, :projects) g,
     generate_series(1, :buckets) c;

insert into public.contract_claim_snapshots (
  id, company_id, project_id, period_month, data_date, status, version_no,
  reporting_currency, project_currency
)
select md5('gc16-perf::ccs::' || g || '::' || m || '::' || v)::uuid,
       p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (date '2019-01-01' + (m || ' months')::interval)::date,
       (date '2019-01-31' + (m || ' months')::interval)::date,
       case when v = :versions then 'submitted' else 'superseded' end::cc_snapshot_status,
       v,
       'USD', 'USD'
from perf_ids p,
     generate_series(1, :projects) g,
     generate_series(0, :periods - 1) m,
     generate_series(1, :versions) v;

insert into public.contract_claim_snapshot_lines (
  company_id, snapshot_id, label, kind, status, currency_code,
  asserted_amount, submitted_amount, assessed_amount, approved_amount,
  forecast_amount, certified_amount, paid_amount, at_risk_amount,
  exposure_amount, exposure_reporting, eot_days_approved, sort_order
)
select s.company_id,
       s.id,
       'Claim line ' || b || '.' || k,
       (array['variation','eot','prolongation','disruption'])[1 + (b + k) % 4]::cc_claim_kind,
       (array['submitted','assessed','approved','certified'])[1 + (b * 3 + k) % 4]::cc_claim_status,
       'USD',
       100000 + (b * 977 + k * 131) % 400000,
       90000 + (b * 811 + k * 97) % 300000,
       80000 + (b * 613 + k * 71) % 200000,
       70000 + (b * 419 + k * 53) % 150000,
       75000 + (b * 331 + k * 41) % 120000,
       60000 + (b * 233 + k * 37) % 90000,
       50000 + (b * 149 + k * 29) % 60000,
       20000 + (b * 101 + k * 23) % 40000,
       30000 + (b * 89 + k * 19) % 50000,
       30000 + (b * 89 + k * 19) % 50000,
       (b + k) % 60,
       b * 10 + k
from public.contract_claim_snapshots s,
     generate_series(0, :buckets - 1) b,
     generate_series(0, :lines_per_bucket - 1) k
where s.company_id = (select company_id from perf_ids)
  and s.status = 'submitted';

-- ---------------------------------------------------------------------------
-- GC-17 risk & contingency: seeded simulation runs, append-only history and
-- the deduplicated alert register, at a volume where the planner has a real
-- choice between the project/company indexes and a sequential scan.
-- ---------------------------------------------------------------------------
insert into public.risk_sim_runs (
  id, company_id, project_id, scope, status, seed, iterations, input_checksum,
  reporting_currency, fx_rate_date, inputs, results, diagnostics, created_at
)
select md5('gc17-perf::run::' || g || '::' || v)::uuid,
       p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (array['cost','schedule','joint'])[1 + (g + v) % 3],
       case when v = 1 then 'approved' else 'superseded' end,
       100000 + g * 31 + v,
       10000,
       md5('gc17-perf::checksum::' || g || '::' || v),
       'USD',
       date '2025-01-31',
       '[]'::jsonb,
       jsonb_build_object('cost', jsonb_build_object('p50', 100000 + g, 'p80', 180000 + g, 'p90', 220000 + g)),
       jsonb_build_object('converged', true),
       now() - ((g * 7 + v) || ' days')::interval
from perf_ids p, generate_series(1, :projects) g, generate_series(1, 30) v;

insert into public.risk_contingency_events (
  company_id, project_id, entity_type, entity_id, action, payload, created_at
)
select p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (array['risk','quantification','pool','movement','sim_run','alert'])[1 + (g + e) % 6],
       md5('gc17-perf::entity::' || g || '::' || (e % 25))::uuid,
       (array['run','approved','rejected','draw','release'])[1 + (g * 3 + e) % 5],
       '{}'::jsonb,
       now() - ((e) || ' hours')::interval
from perf_ids p, generate_series(1, :projects) g, generate_series(1, 200) e;

insert into public.risk_contingency_alerts (
  company_id, project_id, family, severity, status, dedupe_key, title, created_at
)
select p.company_id,
       md5('gc15-perf::project::' || g)::uuid,
       (array['high_exposure','contingency_inadequacy','burn_rate_spike','unlinked_drawdown',
              'overdue_mitigation','stale_simulation','input_quality','fx_materiality'])[1 + (g + a) % 8],
       (array['info','warning','critical'])[1 + (g + a) % 3],
       (array['open','acknowledged','snoozed','resolved'])[1 + (g * 2 + a) % 4],
       'gc17-perf::' || g || '::' || a,
       'GC17 perf alert ' || g || '-' || a,
       now() - ((a) || ' days')::interval
from perf_ids p, generate_series(1, :projects) g, generate_series(1, 40) a;

analyze public.risk_sim_runs;
analyze public.risk_contingency_events;
analyze public.risk_contingency_alerts;
