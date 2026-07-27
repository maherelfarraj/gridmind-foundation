-- 0083_bond_release.sql — P-204 release/cancel columns + seeded approval rule (idempotent)

-- 1) Additive release/cancel columns
alter table public.bond_instruments add column if not exists released_at timestamptz;
alter table public.bond_instruments add column if not exists released_by uuid references public.profiles(id);
alter table public.bond_instruments add column if not exists status_reason text; -- mandatory for released/returned/cancelled

-- 2) Seed the bond-release approval rule per company (finance_admin -> legal_admin chain)
insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, 'bond_release', 'Bond/guarantee release → Finance then Legal', 'bond_instrument',
       72, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'finance_admin' from public.approval_rules r
 where r.rule_key = 'bond_release'
on conflict (rule_id, step_order) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'legal_admin' from public.approval_rules r
 where r.rule_key = 'bond_release'
on conflict (rule_id, step_order) do nothing;
