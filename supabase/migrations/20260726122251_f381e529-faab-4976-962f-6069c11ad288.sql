-- P-146 — SLD review & approval wiring

-- Review rounds: allow SLD-sourced rounds before a register entry exists.
alter table public.drawing_review_rounds
  add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.drawing_review_rounds alter column revision_id drop not null;
create index if not exists drr_metadata_sld_idx
  on public.drawing_review_rounds ((metadata->>'sld_revision_id'));

-- Drawing register tags (used to mark SLD-originated sheets).
alter table public.drawing_register
  add column if not exists tags text[] not null default '{}'::text[];

-- Seed the sld_drawing_approval rule + engineering_admin chain step per company.
do $$
declare c record; v_rule uuid;
begin
  if to_regclass('public.approval_rules') is null
     or to_regclass('public.approval_chain_steps') is null then
    return;
  end if;
  for c in select id from public.companies loop
    select id into v_rule from public.approval_rules
      where company_id = c.id and rule_key = 'sld_drawing_approval';
    if v_rule is null then
      insert into public.approval_rules
        (company_id, rule_key, name, entity_type, sla_hours)
      values (c.id, 'sld_drawing_approval', 'SLD Drawing Approval', 'sld_drawing', 72)
      returning id into v_rule;
    end if;
    if not exists (
      select 1 from public.approval_chain_steps where rule_id = v_rule and step_order = 1
    ) then
      insert into public.approval_chain_steps (company_id, rule_id, step_order, role, sla_hours)
      values (c.id, v_rule, 1, 'engineering_admin'::public.app_role, 72);
    end if;
  end loop;
end $$;