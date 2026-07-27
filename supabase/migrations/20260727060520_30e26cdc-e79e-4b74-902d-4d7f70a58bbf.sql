-- 0078_moc.sql — Management of Change core. Idempotent. (P-191 appends execution helpers.)

create table if not exists public.moc_counters (
  company_id uuid primary key references public.companies(id),
  last_number int not null default 0
);
alter table public.moc_counters enable row level security;   -- no policies: function-only access
grant all on public.moc_counters to service_role;

create or replace function public.next_cr_number(p_company_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into public.moc_counters (company_id, last_number) values (p_company_id, 1)
  on conflict (company_id) do update set last_number = public.moc_counters.last_number + 1
  returning last_number into v_n;
  return 'CR-' || lpad(v_n::text, 4, '0');
end $$;

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid,
  cr_number text not null,
  change_type text not null,
  title text not null,
  description text not null default '',
  reason text not null default '',
  originator_id uuid references public.profiles(id),
  affected_systems jsonb not null default '[]',
  technical_impact text,
  cost_impact numeric(14,2),
  cost_impact_notes text,
  schedule_impact_days int,
  schedule_impact_notes text,
  energy_yield_impact text,
  contract_impact text,
  hse_impact text,
  required_reviewers jsonb not null default '[]',
  approval_instance_id uuid references public.approval_instances(id),
  implementation_evidence jsonb not null default '[]',
  closure_notes text,
  updated_documents jsonb not null default '[]',
  updated_asbuilts jsonb not null default '[]',
  status text not null default 'draft',
  submitted_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  implemented_at timestamptz,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  metadata jsonb not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, cr_number)
);

do $$
begin
  if to_regclass('public.projects') is not null and not exists (
    select 1 from pg_constraint where conname = 'change_requests_project_fk') then
    alter table public.change_requests add constraint change_requests_project_fk
      foreign key (project_id) references public.projects(id);
  end if;
  if to_regclass('public.impact_assessments') is not null and not exists (
    select 1 from pg_constraint where conname = 'impact_assessments_cr_fk') then
    alter table public.impact_assessments add constraint impact_assessments_cr_fk
      foreign key (change_request_id) references public.change_requests(id);
  end if;
end $$;

alter table public.change_requests drop constraint if exists change_requests_type_check;
alter table public.change_requests add constraint change_requests_type_check check (change_type in
  ('design','vendor_substitution','site_condition','grid_requirement','client_instruction',
   'construction_deviation','value_engineering','obsolescence','software_firmware','scada_tag'));
alter table public.change_requests drop constraint if exists change_requests_status_check;
alter table public.change_requests add constraint change_requests_status_check check (status in
  ('draft','assessment','approved','rejected','implementing','closed','cancelled'));

create index if not exists change_requests_project_idx on public.change_requests(company_id, project_id, status);
create index if not exists change_requests_type_idx on public.change_requests(company_id, change_type, status);

create or replace function public.assign_cr_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cr_number is null or btrim(new.cr_number) = '' then
    new.cr_number := public.next_cr_number(new.company_id);
  end if;
  if new.originator_id is null then new.originator_id := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists trg_cr_number on public.change_requests;
create trigger trg_cr_number before insert on public.change_requests
  for each row execute function public.assign_cr_number();

-- RLS -----------------------------------------------------------------------
alter table public.change_requests enable row level security;
drop policy if exists cr_select on public.change_requests;
create policy cr_select on public.change_requests for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists cr_insert on public.change_requests;
create policy cr_insert on public.change_requests for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer()
              and (created_by = auth.uid() or originator_id = auth.uid()));
drop policy if exists cr_update on public.change_requests;
create policy cr_update on public.change_requests for update to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer()
         and ((originator_id = auth.uid() and status = 'draft')
              or public.has_company_role('project_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop trigger if exists trg_cr_updated on public.change_requests;
create trigger trg_cr_updated before update on public.change_requests
  for each row execute function public.set_updated_at();

create or replace function public.audit_cr_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status then
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    values (new.company_id, auth.uid(), 'moc.' || lower(tg_op), 'change_requests', new.id,
            jsonb_build_object('cr_number', new.cr_number, 'change_type', new.change_type,
                               'status', new.status,
                               'previous_status', case when tg_op = 'UPDATE' then old.status end));
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_cr on public.change_requests;
create trigger trg_audit_cr after insert or update of status on public.change_requests
  for each row execute function public.audit_cr_status();

-- Illegal status jumps are rejected even on direct updates --------------------
create or replace function public.guard_cr_status()
returns trigger language plpgsql set search_path = public as $$
declare v_ok boolean;
begin
  if old.status is not distinct from new.status then return new; end if;
  v_ok := (old.status, new.status) in (
    ('draft','assessment'), ('draft','cancelled'),
    ('assessment','approved'), ('assessment','rejected'), ('assessment','cancelled'),
    ('approved','implementing'), ('approved','cancelled'),
    ('implementing','closed'));
  if not v_ok then
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_cr_status on public.change_requests;
create trigger trg_guard_cr_status before update of status on public.change_requests
  for each row execute function public.guard_cr_status();

-- Workflow RPCs ---------------------------------------------------------------
create or replace function public.submit_change_request(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cr public.change_requests%rowtype;
  v_rule_key text;
  v_instance uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_cr from public.change_requests where id = p_id;
  if not found then raise exception 'change_request_not_found' using errcode = 'P0002'; end if;
  if not public.is_company_member(v_cr.company_id) or public.is_external_viewer() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_cr.status <> 'draft' then
    return jsonb_build_object('id', v_cr.id, 'status', v_cr.status,
                              'approval_instance_id', v_cr.approval_instance_id, 'idempotent', true);
  end if;

  if btrim(coalesce(v_cr.description, '')) = '' or btrim(coalesce(v_cr.reason, '')) = '' then
    raise exception 'description_and_reason_required' using errcode = 'P0001';
  end if;

  v_rule_key := 'moc_' || v_cr.change_type;
  if not exists (select 1 from public.approval_rules
                  where company_id = v_cr.company_id and rule_key = v_rule_key and is_active = true) then
    v_rule_key := 'moc_default';
  end if;

  v_instance := public.start_approval_instance(
    v_rule_key, 'change_request', v_cr.id, v_cr.cost_impact,
    jsonb_build_object('project_id', v_cr.project_id, 'cr_number', v_cr.cr_number,
                       'change_type', v_cr.change_type));

  update public.change_requests
     set approval_instance_id = coalesce(v_instance, approval_instance_id),
         status = 'assessment',
         submitted_at = now()
   where id = v_cr.id;

  return jsonb_build_object('id', v_cr.id, 'status', 'assessment',
                            'rule_key', v_rule_key, 'approval_instance_id', v_instance,
                            'idempotent', false);
end $$;

create or replace function public.transition_change_request(p_id uuid, p_to text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cr public.change_requests%rowtype;
  v_inst public.approval_instances%rowtype;
  v_reason text;
  v_may_admin boolean;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select * into v_cr from public.change_requests where id = p_id;
  if not found then raise exception 'change_request_not_found' using errcode = 'P0002'; end if;
  if not public.is_company_member(v_cr.company_id) or public.is_external_viewer() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_may_admin := public.has_company_role('project_admin') or public.has_company_role('company_admin');
  if v_cr.approval_instance_id is not null then
    select * into v_inst from public.approval_instances where id = v_cr.approval_instance_id;
  end if;

  if p_to = v_cr.status then
    return jsonb_build_object('id', v_cr.id, 'status', v_cr.status, 'idempotent', true);
  end if;

  if p_to = 'approved' then
    if v_cr.status <> 'assessment' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    if v_inst.id is null or v_inst.status <> 'approved' then
      raise exception 'approval_not_complete' using errcode = 'P0001';
    end if;
    update public.change_requests set status = 'approved', approved_at = now() where id = v_cr.id;

  elsif p_to = 'rejected' then
    if v_cr.status <> 'assessment' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    v_reason := nullif(btrim(coalesce(p_payload->>'rejection_reason', '')), '');
    if coalesce(v_inst.status, '') <> 'rejected' and v_reason is null then
      raise exception 'rejection_reason_required' using errcode = 'P0001';
    end if;
    update public.change_requests
       set status = 'rejected', rejected_at = now(),
           rejection_reason = coalesce(v_reason, 'Rejected by approval chain')
     where id = v_cr.id;

  elsif p_to = 'implementing' then
    if v_cr.status <> 'approved' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    update public.change_requests set status = 'implementing', implemented_at = now() where id = v_cr.id;

  elsif p_to = 'closed' then
    if v_cr.status <> 'implementing' then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p_payload->'implementation_evidence', v_cr.implementation_evidence, '[]'::jsonb)) = 0 then
      raise exception 'implementation_evidence_required' using errcode = 'P0001';
    end if;
    if btrim(coalesce(p_payload->>'closure_notes', v_cr.closure_notes, '')) = '' then
      raise exception 'closure_notes_required' using errcode = 'P0001';
    end if;
    update public.change_requests
       set status = 'closed',
           implementation_evidence = coalesce(p_payload->'implementation_evidence', implementation_evidence),
           closure_notes = coalesce(nullif(btrim(coalesce(p_payload->>'closure_notes','')), ''), closure_notes),
           updated_documents = coalesce(p_payload->'updated_documents', updated_documents),
           updated_asbuilts = coalesce(p_payload->'updated_asbuilts', updated_asbuilts),
           closed_by = auth.uid(), closed_at = now()
     where id = v_cr.id;

  elsif p_to = 'cancelled' then
    if v_cr.status not in ('draft','assessment') then raise exception 'invalid_transition' using errcode = 'P0001'; end if;
    if not (v_cr.originator_id = auth.uid() or public.has_company_role('company_admin')) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if v_inst.id is not null and v_inst.status in ('pending','in_progress') then
      perform public.cancel_approval_instance(v_inst.id);
    end if;
    update public.change_requests set status = 'cancelled' where id = v_cr.id;

  else
    raise exception 'invalid_transition' using errcode = 'P0001';
  end if;

  if p_to in ('approved','implementing','closed') and not v_may_admin
     and v_cr.originator_id is distinct from auth.uid() then
    null; -- engine + RLS already govern authority; no extra restriction
  end if;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_cr.company_id, auth.uid(), 'moc.transition', 'change_requests', v_cr.id,
          jsonb_build_object('from', v_cr.status, 'to', p_to, 'cr_number', v_cr.cr_number));

  return jsonb_build_object('id', v_cr.id, 'status', p_to, 'idempotent', false);
end $$;

-- Seeded per-type approval chains ---------------------------------------------
insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, k.rule_key, k.name, 'change_request', k.sla, 'company_admin'::public.app_role
  from public.companies c
  cross join (values
    ('moc_default',            'MOC — default review',              72),
    ('moc_design',             'MOC — design change',               72),
    ('moc_vendor_substitution','MOC — vendor substitution',         48),
    ('moc_grid_requirement',   'MOC — grid requirement change',     72),
    ('moc_client_instruction', 'MOC — client instruction',          48),
    ('moc_software_firmware',  'MOC — software/firmware change',    48),
    ('moc_scada_tag',          'MOC — SCADA tag change',            24)
  ) as k(rule_key, name, sla)
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, s.step_order, s.role::public.app_role
  from public.approval_rules r
  join (values
    ('moc_default',            1, 'project_admin'),
    ('moc_design',             1, 'project_admin'),
    ('moc_design',             2, 'company_admin'),
    ('moc_vendor_substitution',1, 'project_admin'),
    ('moc_vendor_substitution',2, 'finance_admin'),
    ('moc_grid_requirement',   1, 'project_admin'),
    ('moc_grid_requirement',   2, 'company_admin'),
    ('moc_client_instruction', 1, 'legal_admin'),
    ('moc_client_instruction', 2, 'finance_admin'),
    ('moc_software_firmware',  1, 'om_admin'),
    ('moc_software_firmware',  2, 'company_admin'),
    ('moc_scada_tag',          1, 'om_admin')
  ) as s(rule_key, step_order, role) on s.rule_key = r.rule_key
 where r.entity_type = 'change_request'
on conflict (rule_id, step_order) do nothing;

grant select, insert, update on public.change_requests to authenticated;
grant all on public.change_requests to service_role;
grant execute on function public.submit_change_request(uuid) to authenticated;
grant execute on function public.transition_change_request(uuid, text, jsonb) to authenticated;
revoke all on function public.next_cr_number(uuid) from public, anon, authenticated;