-- 1) Link POs to approval instances
alter table public.purchase_orders
  add column if not exists approval_instance_id uuid references public.approval_instances(id) on delete set null;

create index if not exists purchase_orders_approval_instance_idx
  on public.purchase_orders(approval_instance_id);

-- 2) Seed the PO threshold rule for existing companies
insert into public.approval_rules (company_id, rule_key, name, description, entity_type, threshold_amount, sla_hours, escalation_role)
select c.id, 'po_threshold_finance', 'Purchase order above threshold → Finance',
       'Purchase orders above the threshold route to finance_admin (falls back to company_admin).',
       'purchase_order', 50000, 48, 'company_admin'
  from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'finance_admin'
  from public.approval_rules r
 where r.rule_key = 'po_threshold_finance'
on conflict (rule_id, step_order) do nothing;

-- 3) Default for future tenants
create or replace function public.seed_po_approval_rule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
begin
  insert into public.approval_rules (company_id, rule_key, name, description, entity_type, threshold_amount, sla_hours, escalation_role)
  values (new.id, 'po_threshold_finance', 'Purchase order above threshold → Finance',
          'Purchase orders above the threshold route to finance_admin (falls back to company_admin).',
          'purchase_order', 50000, 48, 'company_admin')
  on conflict (company_id, rule_key) do nothing
  returning id into v_rule_id;

  if v_rule_id is not null then
    insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
    values (new.id, v_rule_id, 1, 'finance_admin')
    on conflict (rule_id, step_order) do nothing;
  end if;

  return new;
end $$;

drop trigger if exists companies_seed_po_approval_rule on public.companies;
create trigger companies_seed_po_approval_rule
  after insert on public.companies
  for each row execute function public.seed_po_approval_rule();