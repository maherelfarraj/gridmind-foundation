-- Corrective: supersedes any name-based seed lookups; always key seeds on slug.

-- 1) Ensure Demo tenant exists (keyed on slug), correct name + plan tier.
insert into public.companies (name, slug, plan_tier)
values ('Demo EPC Co', 'demo', 'enterprise')
on conflict (slug) do update
  set name = excluded.name,
      plan_tier = excluded.plan_tier;

-- 2) Rename Test Co B display name if drifted.
update public.companies
   set name = 'Test Co B'
 where slug = 'test-co-b'
   and name <> 'Test Co B';

-- 3) Demo module_access_rules — all 9 modules enabled (enterprise baseline).
with demo as (select id from public.companies where slug = 'demo')
insert into public.module_access_rules (company_id, module, enabled)
select demo.id, m, true
from demo, unnest(array[
  'crm','engineering','procurement','planning_budget',
  'field_qaqc','commissioning','portals','om_scada','green_hydrogen'
]) as m
on conflict (company_id, module) do nothing;

-- 4) Demo audit_log_retention_policies — financial=2555 days, default=400 days.
with demo as (select id from public.companies where slug = 'demo')
insert into public.audit_log_retention_policies (company_id, entity, retention_days)
select demo.id, e.entity, e.days
from demo, (values ('financial', 2555), ('default', 400)) as e(entity, days)
on conflict (company_id, entity) do update
  set retention_days = excluded.retention_days;
