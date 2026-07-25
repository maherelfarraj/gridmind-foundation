
-- 0052_approval_engine.sql — real approval engine; upgrades P-040 minimal tables. Idempotent.

-- Helper: external viewer detection
create or replace function public.is_external_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role in ('client_viewer','investor_viewer','lender_viewer')
  );
$$;

-- Rules
create table if not exists public.approval_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rule_key text not null,
  name text not null,
  description text,
  entity_type text not null,
  threshold_amount numeric(14,2),
  threshold_currency text not null default 'USD',
  sla_hours int not null default 48,
  escalation_role public.app_role,
  blocks_export boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rule_key)
);

create table if not exists public.approval_chain_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  rule_id uuid not null references public.approval_rules(id) on delete cascade,
  step_order int not null,
  role public.app_role not null,
  sla_hours int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, step_order)
);

-- Idempotent creation for legacy tables (P-040 already has these; guarded creates)
create table if not exists public.approval_instances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity text not null default '',
  entity_id uuid not null,
  status text not null default 'pending',
  requested_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.approval_instances add column if not exists entity text not null default '';
alter table public.approval_instances add column if not exists entity_type text not null default 'legacy';
alter table public.approval_instances add column if not exists rule_id uuid references public.approval_rules(id);
alter table public.approval_instances add column if not exists rule_key text;
alter table public.approval_instances add column if not exists current_step int not null default 1;
alter table public.approval_instances add column if not exists amount numeric(14,2);
alter table public.approval_instances add column if not exists requested_at timestamptz not null default now();
alter table public.approval_instances add column if not exists sla_due_at timestamptz;
alter table public.approval_instances add column if not exists completed_at timestamptz;
update public.approval_instances set entity_type = entity
  where entity_type = 'legacy' and entity <> '';
alter table public.approval_instances drop constraint if exists approval_instances_status_check;
alter table public.approval_instances add constraint approval_instances_status_check
  check (status in ('pending','in_progress','approved','rejected','cancelled'));

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instance_id uuid not null references public.approval_instances(id) on delete cascade,
  approver_id uuid not null references public.profiles(id),
  status text not null default 'pending',
  comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.approvals add column if not exists step_id uuid references public.approval_chain_steps(id);
alter table public.approvals add column if not exists step_order int not null default 1;
alter table public.approvals add column if not exists due_at timestamptz;
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check
  check (status in ('pending','approved','rejected','skipped'));

-- RLS
alter table public.approval_rules enable row level security;
alter table public.approval_chain_steps enable row level security;
alter table public.approval_instances enable row level security;
alter table public.approvals enable row level security;

drop policy if exists rules_select on public.approval_rules;
create policy rules_select on public.approval_rules for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists rules_write on public.approval_rules;
create policy rules_write on public.approval_rules for all to authenticated
  using (public.has_company_role('company_admin'))
  with check (public.has_company_role('company_admin'));

drop policy if exists chain_steps_select on public.approval_chain_steps;
create policy chain_steps_select on public.approval_chain_steps for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists chain_steps_write on public.approval_chain_steps;
create policy chain_steps_write on public.approval_chain_steps for all to authenticated
  using (public.has_company_role('company_admin'))
  with check (public.has_company_role('company_admin'));

drop policy if exists instances_select on public.approval_instances;
create policy instances_select on public.approval_instances for select to authenticated
  using (public.is_company_member(company_id) and (
    not public.is_external_viewer()
    or requested_by = auth.uid()
    or exists (select 1 from public.approvals a
               where a.instance_id = id and a.approver_id = auth.uid())
  ));
drop policy if exists instances_insert on public.approval_instances;
create policy instances_insert on public.approval_instances for insert to authenticated
  with check (public.is_company_member(company_id) and requested_by = auth.uid()
              and not public.is_external_viewer());
drop policy if exists instances_update on public.approval_instances;
create policy instances_update on public.approval_instances for update to authenticated
  using ((public.has_company_role('company_admin') or public.has_company_role('project_admin')
          or requested_by = auth.uid()) and not public.is_external_viewer());

drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select to authenticated
  using (public.is_company_member(company_id)
         and (not public.is_external_viewer() or approver_id = auth.uid()));
drop policy if exists approvals_insert on public.approvals;
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists approvals_update on public.approvals;
create policy approvals_update on public.approvals for update to authenticated
  using (approver_id = auth.uid() or public.has_company_role('company_admin'));

-- updated_at triggers
drop trigger if exists trg_rules_updated on public.approval_rules;
create trigger trg_rules_updated before update on public.approval_rules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_chain_steps_updated on public.approval_chain_steps;
create trigger trg_chain_steps_updated before update on public.approval_chain_steps
  for each row execute function public.set_updated_at();
drop trigger if exists trg_instances_updated on public.approval_instances;
create trigger trg_instances_updated before update on public.approval_instances
  for each row execute function public.set_updated_at();
drop trigger if exists trg_approvals_updated on public.approvals;
create trigger trg_approvals_updated before update on public.approvals
  for each row execute function public.set_updated_at();

-- Audit trigger
create or replace function public.audit_approval_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (new.company_id, auth.uid(),
          tg_table_name || '.' || lower(tg_op), tg_table_name, new.id,
          jsonb_build_object('status', new.status));
  return new;
end $$;
drop trigger if exists trg_audit_instances on public.approval_instances;
create trigger trg_audit_instances after insert or update of status on public.approval_instances
  for each row execute function public.audit_approval_changes();
drop trigger if exists trg_audit_approvals on public.approvals;
create trigger trg_audit_approvals after insert or update of status on public.approvals
  for each row execute function public.audit_approval_changes();

-- ============================================================================
-- Engine RPCs
-- ============================================================================

create or replace function public.start_approval_instance(
  p_rule_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_amount numeric default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_rule public.approval_rules%rowtype;
  v_existing uuid;
  v_instance_id uuid;
  v_step public.approval_chain_steps%rowtype;
  v_sla_hours int;
  v_sla_due timestamptz;
  v_role_count int;
  v_effective_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then
    raise exception 'no_company' using errcode = 'P0001';
  end if;

  select * into v_rule from public.approval_rules
    where company_id = v_company and rule_key = p_rule_key and is_active = true;
  if not found then
    return null;
  end if;

  if v_rule.threshold_amount is not null
     and (p_amount is null or p_amount <= v_rule.threshold_amount) then
    return null;
  end if;

  select id into v_existing from public.approval_instances
    where company_id = v_company
      and entity_type = p_entity_type
      and entity_id = p_entity_id
      and status in ('pending','in_progress')
    order by requested_at desc
    limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select * into v_step from public.approval_chain_steps
    where rule_id = v_rule.id order by step_order asc limit 1;
  if not found then
    raise exception 'rule_has_no_chain_steps' using errcode = 'P0001';
  end if;

  v_sla_hours := coalesce(v_step.sla_hours, v_rule.sla_hours);
  v_sla_due := now() + make_interval(hours => v_sla_hours);

  insert into public.approval_instances (
    company_id, entity, entity_type, entity_id, rule_id, rule_key, status,
    current_step, amount, requested_by, requested_at, sla_due_at, metadata
  ) values (
    v_company, p_entity_type, p_entity_type, p_entity_id, v_rule.id, v_rule.rule_key,
    'pending', v_step.step_order, p_amount, auth.uid(), now(), v_sla_due,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_instance_id;

  select count(*) into v_role_count from public.user_roles
    where company_id = v_company and role = v_step.role;
  v_effective_role := case when v_role_count > 0 then v_step.role else 'company_admin'::public.app_role end;

  insert into public.approvals (company_id, instance_id, approver_id, step_id, step_order, status, due_at)
  select v_company, v_instance_id, ur.user_id, v_step.id, v_step.step_order, 'pending', v_sla_due
    from public.user_roles ur
    where ur.company_id = v_company and ur.role = v_effective_role;

  return v_instance_id;
end $$;

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_comment text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_approval public.approvals%rowtype;
  v_instance public.approval_instances%rowtype;
  v_peer_pending int;
  v_next_step public.approval_chain_steps%rowtype;
  v_sla_hours int;
  v_sla_due timestamptz;
  v_role_count int;
  v_effective_role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and (p_comment is null or length(btrim(p_comment)) = 0) then
    raise exception 'comment_required_on_reject' using errcode = 'P0001';
  end if;

  select * into v_approval from public.approvals where id = p_approval_id for update;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_approval.approver_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- idempotent: same decision repeat = no-op
  if v_approval.status = p_decision then
    return;
  end if;
  if v_approval.status <> 'pending' then
    raise exception 'approval_already_decided' using errcode = 'P0001';
  end if;

  select * into v_instance from public.approval_instances where id = v_approval.instance_id for update;
  if v_instance.status not in ('pending','in_progress') then
    raise exception 'instance_closed' using errcode = 'P0001';
  end if;

  update public.approvals
     set status = p_decision, comment = p_comment, decided_at = now()
   where id = p_approval_id;

  if p_decision = 'rejected' then
    update public.approvals set status = 'skipped', decided_at = now()
      where instance_id = v_instance.id and status = 'pending' and id <> p_approval_id;
    update public.approval_instances
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), completed_at = now()
     where id = v_instance.id;
    return;
  end if;

  -- approved: check peers still pending on this step
  select count(*) into v_peer_pending from public.approvals
    where instance_id = v_instance.id
      and step_order = v_approval.step_order
      and status = 'pending';
  if v_peer_pending > 0 then
    if v_instance.status = 'pending' then
      update public.approval_instances set status = 'in_progress' where id = v_instance.id;
    end if;
    return;
  end if;

  -- Legacy rule-less: complete on first approve
  if v_instance.rule_id is null then
    update public.approval_instances
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), completed_at = now()
     where id = v_instance.id;
    return;
  end if;

  -- next chain step?
  select * into v_next_step from public.approval_chain_steps
    where rule_id = v_instance.rule_id and step_order > v_approval.step_order
    order by step_order asc limit 1;
  if not found then
    update public.approval_instances
       set status = 'approved', decided_by = auth.uid(), decided_at = now(), completed_at = now()
     where id = v_instance.id;
    return;
  end if;

  -- advance
  select sla_hours into v_sla_hours from public.approval_rules where id = v_instance.rule_id;
  v_sla_hours := coalesce(v_next_step.sla_hours, v_sla_hours, 48);
  v_sla_due := now() + make_interval(hours => v_sla_hours);

  select count(*) into v_role_count from public.user_roles
    where company_id = v_instance.company_id and role = v_next_step.role;
  v_effective_role := case when v_role_count > 0 then v_next_step.role else 'company_admin'::public.app_role end;

  update public.approval_instances
     set current_step = v_next_step.step_order, status = 'in_progress', sla_due_at = v_sla_due
   where id = v_instance.id;

  insert into public.approvals (company_id, instance_id, approver_id, step_id, step_order, status, due_at)
  select v_instance.company_id, v_instance.id, ur.user_id, v_next_step.id, v_next_step.step_order, 'pending', v_sla_due
    from public.user_roles ur
    where ur.company_id = v_instance.company_id and ur.role = v_effective_role;
end $$;

create or replace function public.cancel_approval_instance(p_instance_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_instance public.approval_instances%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_instance from public.approval_instances where id = p_instance_id for update;
  if not found then
    raise exception 'instance_not_found' using errcode = 'P0002';
  end if;
  if v_instance.requested_by <> auth.uid()
     and not public.has_company_role('company_admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_instance.status not in ('pending','in_progress') then
    raise exception 'instance_closed' using errcode = 'P0001';
  end if;

  update public.approvals set status = 'skipped', decided_at = now()
    where instance_id = p_instance_id and status = 'pending';
  update public.approval_instances
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now(), completed_at = now()
   where id = p_instance_id;
end $$;

create or replace function public.escalate_overdue_approvals()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_count int := 0;
begin
  for v_row in
    select id, company_id from public.approval_instances
      where status in ('pending','in_progress')
        and sla_due_at is not null and sla_due_at < now()
        and (metadata->>'escalated_at') is null
  loop
    update public.approval_instances
       set metadata = coalesce(metadata,'{}'::jsonb)
                      || jsonb_build_object('escalated_at', now())
     where id = v_row.id;
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
      values (v_row.company_id, null, 'approval.escalated', 'approval_instances', v_row.id,
              jsonb_build_object('at', now()));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ============================================================================
-- Seeds
-- ============================================================================
insert into public.approval_rules (company_id, rule_key, name, entity_type, threshold_amount, sla_hours, escalation_role, blocks_export)
select c.id, 'po_threshold_finance', 'PO above threshold → Finance approval', 'purchase_order',
       50000, 48, 'company_admin', true from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role, blocks_export)
select c.id, 'proposal_pricing_cfo', 'Proposal pricing → CFO approval', 'proposal_pricing',
       48, 'company_admin', true from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, 'phase_gate_transition', 'Phase gate transition approval', 'project_phase_gate',
       72, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, 'contract_legal_finance', 'Contract → Legal then Finance', 'contract',
       72, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_rules (company_id, rule_key, name, entity_type, threshold_amount, sla_hours, escalation_role)
select c.id, 'change_order_finance', 'Change order above threshold → Finance', 'change_order',
       25000, 48, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'finance_admin' from public.approval_rules r
 where r.rule_key in ('po_threshold_finance','proposal_pricing_cfo','change_order_finance')
on conflict (rule_id, step_order) do nothing;
insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'company_admin' from public.approval_rules r
 where r.rule_key = 'phase_gate_transition'
on conflict (rule_id, step_order) do nothing;
insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'legal_admin' from public.approval_rules r
 where r.rule_key = 'contract_legal_finance'
on conflict (rule_id, step_order) do nothing;
insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'finance_admin' from public.approval_rules r
 where r.rule_key = 'contract_legal_finance'
on conflict (rule_id, step_order) do nothing;

-- Indexes
create index if not exists approval_rules_company_key_idx on public.approval_rules(company_id, rule_key);
create index if not exists chain_steps_rule_idx on public.approval_chain_steps(rule_id, step_order);
create index if not exists instances_entity_idx on public.approval_instances(company_id, entity_type, entity_id);
create index if not exists instances_status_sla_idx on public.approval_instances(company_id, status, sla_due_at);
create index if not exists approvals_instance_idx on public.approvals(instance_id, step_order);
create index if not exists approvals_inbox_idx on public.approvals(approver_id, status);

-- Grants
grant select, insert, update on public.approval_rules, public.approval_chain_steps,
  public.approval_instances, public.approvals to authenticated;
grant all on public.approval_rules, public.approval_chain_steps,
  public.approval_instances, public.approvals to service_role;
revoke execute on function public.escalate_overdue_approvals() from public, anon, authenticated;
grant execute on function public.escalate_overdue_approvals() to service_role;
grant execute on function public.start_approval_instance(text,text,uuid,numeric,jsonb) to authenticated;
grant execute on function public.decide_approval(uuid,text,text) to authenticated;
grant execute on function public.cancel_approval_instance(uuid) to authenticated;
grant execute on function public.is_external_viewer() to authenticated;
