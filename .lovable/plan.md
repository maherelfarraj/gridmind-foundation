## Corrective migration: `0013b_seed_corrective.sql`

Idempotent, slug-keyed. Safe to re-run. No display-name lookups anywhere.

```sql
-- Corrective: supersedes any name-based seed lookups; always key seeds on slug.
-- Re-affirms the Demo tenant + its module rules + audit retention, and fixes
-- the Test Co B display name. All statements are idempotent.

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
insert into public.audit_log_retention_policies (company_id, category, retention_days)
select demo.id, c.category, c.days
from demo, (values ('financial', 2555), ('default', 400)) as c(category, days)
on conflict (company_id, category) do update
  set retention_days = excluded.retention_days;
```

## After apply

Run and paste back:
```sql
select name, slug, plan_tier from public.companies order by created_at;
```
Expect exactly:
- `Demo EPC Co | demo | enterprise`
- `Test Co B | test-co-b | growth`

Then hand off: **next → P-036 (wizard step 4: team assignment + create project).**

## Assumptions to confirm before applying

- `public.companies.slug` has a UNIQUE constraint (required for the `on conflict (slug)` upsert). I'll verify with a quick read before writing the migration; if it's not unique I'll drop the upsert to a `WHERE NOT EXISTS` insert + separate `UPDATE` for name/plan.
- `module_access_rules` unique key is `(company_id, module)` and `audit_log_retention_policies` unique key is `(company_id, category)`. Same verification step; I'll adjust the `ON CONFLICT` targets to match the actual constraint names if they differ.
