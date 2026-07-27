-- 0086_estimate_approval.sql — estimate approval workflow + proposal conversion (P-212)

-- 1) Additive conversion + workflow columns
alter table public.estimates add column if not exists converted_proposal_id uuid references public.proposals(id) on delete set null;
alter table public.estimates add column if not exists converted_at timestamptz;
alter table public.estimates add column if not exists converted_by uuid references public.profiles(id);
alter table public.estimates add column if not exists submitted_at timestamptz;
alter table public.estimates add column if not exists submitted_by uuid references public.profiles(id);
alter table public.estimates add column if not exists approved_at timestamptz;
alter table public.estimates add column if not exists approved_by uuid references public.profiles(id);
alter table public.estimates add column if not exists rejection_comment text;

-- 2) Seed the estimate approval rule per company (engineering_admin → finance_admin chain)
insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, 'estimate_approval', 'Estimate review → Engineering then Finance', 'estimate',
       48, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'engineering_admin' from public.approval_rules r
 where r.rule_key = 'estimate_approval'
on conflict (rule_id, step_order) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'finance_admin' from public.approval_rules r
 where r.rule_key = 'estimate_approval'
on conflict (rule_id, step_order) do nothing;

-- 3) Let estimates join the digital thread (only when entity_links exists)
do $$ begin
  if to_regclass('public.entity_links') is not null then
    alter table public.entity_links drop constraint if exists entity_links_type_check;
    alter table public.entity_links add constraint entity_links_type_check check (
      source_type in ('opportunity','proposal','project','layout','simulation','sld','bom',
        'rfq','po','cwp','inspection','test','certificate','turnover','asset','work_order',
        'warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor',
        'contract','change_request','impact_assessment','estimate')
      and target_type in ('opportunity','proposal','project','layout','simulation','sld','bom',
        'rfq','po','cwp','inspection','test','certificate','turnover','asset','work_order',
        'warranty_claim','drawing','document','equipment','scada_alarm','spare_part','vendor',
        'contract','change_request','impact_assessment','estimate'));
  end if;
end $$;
