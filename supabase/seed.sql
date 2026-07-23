-- supabase/seed.sql
-- Idempotent dev seed for GridMind EPC.
-- Run AFTER signing up demo-admin@gridmindepc.com through the app UI; then re-run to link that user.

-- 1) demo company
insert into public.companies (name, slug, plan_tier)
values ('Demo EPC Co', 'demo', 'enterprise')
on conflict (slug) do update set plan_tier = excluded.plan_tier;

-- 2) currencies
insert into public.currencies (code, name, symbol, minor_unit) values
  ('USD','US Dollar','$',2),
  ('EUR','Euro','€',2),
  ('MAD','Moroccan Dirham','MAD',2),
  ('JOD','Jordanian Dinar','JOD',3),
  ('AED','UAE Dirham','AED',2),
  ('CNY','Chinese Yuan','¥',2)
on conflict (code) do nothing;

-- 3) default module gating for demo company
insert into public.module_access_rules (company_id, module, enabled)
select c.id, m.module, true
from public.companies c
cross join (values
  ('crm'),('engineering'),('procurement'),('planning_budget'),
  ('field_qaqc'),('commissioning'),('om_scada'),('portals'),
  ('green_hydrogen')
) as m(module)
where c.slug = 'demo'
on conflict (company_id, module) do update set enabled = excluded.enabled;

-- 4) audit retention defaults
insert into public.audit_log_retention_policies (company_id, entity, retention_days)
select c.id, e.entity, e.days
from public.companies c
cross join (values ('financial', 2555), ('default', 400)) as e(entity, days)
where c.slug = 'demo'
on conflict (company_id, entity) do nothing;

-- 5) demo admin — run AFTER signing up demo-admin@gridmindepc.com in the app
do $$
declare v_user uuid; v_company uuid;
begin
  select id into v_user from auth.users where email = 'demo-admin@gridmindepc.com';
  select id into v_company from public.companies where slug = 'demo';
  if v_user is null then
    raise notice 'demo admin auth user not found — sign up first, then re-run seed';
    return;
  end if;
  insert into public.profiles (id, company_id, full_name, email)
  values (v_user, v_company, 'Demo Admin', 'demo-admin@gridmindepc.com')
  on conflict (id) do update set company_id = excluded.company_id;
  insert into public.user_roles (user_id, company_id, role)
  values (v_user, v_company, 'company_admin'),
         (v_user, v_company, 'super_admin')
  on conflict (user_id, company_id, role) do nothing;
end $$;
