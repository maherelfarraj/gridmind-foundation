-- 0092_timesheet_approval_rule.sql — seed the P-111 timesheet_approval rule per company. Idempotent.
insert into public.approval_rules (company_id, rule_key, name, entity_type, threshold_amount, sla_hours, escalation_role, is_active)
select c.id, 'timesheet_approval', 'Timesheet review → Foreman then Project Admin', 'timesheet',
       null, 48, 'project_admin', true
  from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'foreman'
  from public.approval_rules r where r.rule_key = 'timesheet_approval'
on conflict (rule_id, step_order) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'project_admin'
  from public.approval_rules r where r.rule_key = 'timesheet_approval'
on conflict (rule_id, step_order) do nothing;