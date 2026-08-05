-- Project completion integrity.
--
-- projects.status is owned lifecycle state. Completion and reopening are
-- governed transitions: application code cannot write into or out of the
-- completed state directly. Final handover approval invokes the same guarded
-- completion engine used by the explicit project-complete server function.

-- Block direct authenticated writes into or out of completed. SECURITY DEFINER
-- lifecycle functions execute as their owner and are therefore allowed through
-- this trigger; service-role maintenance remains unaffected.
create or replace function public.projects_guard_completed_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated'
       and new.status = 'completed'::public.project_status then
      raise exception 'PROJECT_STATUS_TRANSITION_REQUIRED'
        using errcode = '42501',
              hint = 'Create projects in a non-completed state; completion is governed.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if current_user = 'authenticated'
     and (
       new.status = 'completed'::public.project_status
       or old.status = 'completed'::public.project_status
     ) then
    raise exception 'PROJECT_STATUS_TRANSITION_REQUIRED'
      using errcode = '42501',
            hint = 'Use project_complete/project_reopen; completed state is governed.';
  end if;

  return new;
end;
$$;

revoke all on function public.projects_guard_completed_transition()
  from public, anon, authenticated;

drop trigger if exists projects_guard_completed_transition_trg on public.projects;
create trigger projects_guard_completed_transition_trg
before insert or update of status on public.projects
for each row execute function public.projects_guard_completed_transition();

-- Handover decisions must use decide_handover_gate. The marker is transaction
-- local and is set only by that SECURITY DEFINER function. This blocks direct
-- row updates and the generic decide_approval RPC from partially settling a
-- final handover workflow.
create or replace function public.approvals_guard_handover_decision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_handover boolean := false;
begin
  if new.status is not distinct from old.status
     and new.instance_id is not distinct from old.instance_id
     and new.approver_id is not distinct from old.approver_id then
    return new;
  end if;

  if current_user = 'service_role'
     or coalesce(current_setting('gridmind.handover_decision', true), '') = 'on' then
    return new;
  end if;

  select exists (
    select 1
      from public.approval_instances ai
      join public.project_phase_gates g
        on g.id = ai.entity_id
       and g.company_id = ai.company_id
     where ai.id in (old.instance_id, new.instance_id)
       and (ai.entity = 'project_phase_gate' or ai.entity_type = 'project_phase_gate')
       and g.phase = 'handover'::public.project_phase
  ) into v_is_handover;

  if v_is_handover then
    raise exception 'HANDOVER_GATE_DECISION_REQUIRED'
      using errcode = '42501',
            hint = 'Use decide_handover_gate for final handover approvals.';
  end if;

  return new;
end;
$$;

revoke all on function public.approvals_guard_handover_decision()
  from public, anon, authenticated;

drop trigger if exists approvals_guard_handover_decision_trg on public.approvals;
create trigger approvals_guard_handover_decision_trg
before update of status, instance_id, approver_id on public.approvals
for each row execute function public.approvals_guard_handover_decision();

create or replace function public.approval_instances_guard_handover_decision()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_handover boolean := false;
begin
  if new.status is not distinct from old.status
     and new.entity is not distinct from old.entity
     and new.entity_type is not distinct from old.entity_type
     and new.entity_id is not distinct from old.entity_id
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;

  if current_user = 'service_role'
     or coalesce(current_setting('gridmind.handover_decision', true), '') = 'on' then
    return new;
  end if;

  select exists (
    select 1
      from public.project_phase_gates g
     where g.id in (old.entity_id, new.entity_id)
       and g.company_id in (old.company_id, new.company_id)
       and (
         old.entity = 'project_phase_gate'
         or old.entity_type = 'project_phase_gate'
         or new.entity = 'project_phase_gate'
         or new.entity_type = 'project_phase_gate'
       )
       and g.phase = 'handover'::public.project_phase
  ) into v_is_handover;

  if v_is_handover then
    raise exception 'HANDOVER_GATE_DECISION_REQUIRED'
      using errcode = '42501',
            hint = 'Use decide_handover_gate for final handover approvals.';
  end if;

  return new;
end;
$$;

revoke all on function public.approval_instances_guard_handover_decision()
  from public, anon, authenticated;

drop trigger if exists approval_instances_guard_handover_decision_trg
  on public.approval_instances;
create trigger approval_instances_guard_handover_decision_trg
before update of status, entity, entity_type, entity_id, company_id
on public.approval_instances
for each row execute function public.approval_instances_guard_handover_decision();

create or replace function public.project_phase_gates_guard_handover_decision()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user = 'service_role'
     or coalesce(current_setting('gridmind.handover_decision', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.phase = 'handover'::public.project_phase
       and new.status = 'approved' then
      raise exception 'HANDOVER_GATE_DECISION_REQUIRED'
        using errcode = '42501',
              hint = 'Use decide_handover_gate for final handover approvals.';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status
     and new.approval_instance_id is not distinct from old.approval_instance_id
     and new.phase is not distinct from old.phase
     and new.project_id is not distinct from old.project_id
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;

  if (old.phase = 'handover'::public.project_phase
      or new.phase = 'handover'::public.project_phase)
     and (
       new.status = 'approved'
       or old.status in ('in_review', 'approved')
     ) then
    raise exception 'HANDOVER_GATE_DECISION_REQUIRED'
      using errcode = '42501',
            hint = 'Use decide_handover_gate for final handover approvals.';
  end if;

  return new;
end;
$$;

revoke all on function public.project_phase_gates_guard_handover_decision()
  from public, anon, authenticated;

drop trigger if exists project_phase_gates_guard_handover_decision_trg
  on public.project_phase_gates;
create trigger project_phase_gates_guard_handover_decision_trg
before insert or update on public.project_phase_gates
for each row execute function public.project_phase_gates_guard_handover_decision();

-- A project admin assigned after a handover workflow started must be able to
-- participate without a manual database repair. This keeps old Lovable-created
-- workflows recoverable after role cleanup or late project-team assignment.
create or replace function public.user_roles_add_handover_approvals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role <> 'project_admin'::public.app_role then
    return new;
  end if;

  insert into public.approvals (
    company_id,
    instance_id,
    approver_id,
    status
  )
  select
    ai.company_id,
    ai.id,
    new.user_id,
    'pending'
  from public.approval_instances ai
  join public.project_phase_gates g
    on g.id = ai.entity_id
   and g.company_id = ai.company_id
  where ai.company_id = new.company_id
    and ai.status in ('pending', 'in_progress')
    and g.phase = 'handover'::public.project_phase
    and g.status = 'in_review'
    and (ai.entity = 'project_phase_gate' or ai.entity_type = 'project_phase_gate')
    and not exists (
      select 1
      from public.approvals a
      where a.instance_id = ai.id
        and a.approver_id = new.user_id
    );

  return new;
end;
$$;

revoke all on function public.user_roles_add_handover_approvals()
  from public, anon, authenticated;

drop trigger if exists user_roles_add_handover_approvals_trg on public.user_roles;
create trigger user_roles_add_handover_approvals_trg
after insert or update of role, company_id, user_id on public.user_roles
for each row execute function public.user_roles_add_handover_approvals();

-- Internal completion engine. It is deliberately not executable by app roles;
-- public.project_complete and public.decide_handover_gate are the only entry
-- points and both pass auth.uid() as p_actor.
create or replace function public.project_apply_completion(
  p_project_id uuid,
  p_actor uuid
)
returns public.project_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects%rowtype;
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select * into v_project
    from public.projects
   where id = p_project_id
   for update;

  if v_project.id is null
     or not public.is_company_member(v_project.company_id) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.user_roles ur
     where ur.user_id = p_actor
       and ur.company_id = v_project.company_id
       and ur.role = 'project_admin'::public.app_role
  ) then
    raise exception 'PROJECT_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if v_project.status = 'completed'::public.project_status then
    return v_project.status;
  end if;

  if v_project.phase <> 'handover'::public.project_phase then
    raise exception 'PROJECT_HANDOVER_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
      from public.project_phase_gates g
     where g.project_id = v_project.id
       and g.company_id = v_project.company_id
       and g.phase = 'handover'::public.project_phase
       and g.status = 'approved'
  ) then
    raise exception 'PROJECT_HANDOVER_GATE_REQUIRED' using errcode = 'P0001';
  end if;

  update public.projects
     set status = 'completed'::public.project_status,
         updated_at = now()
   where id = v_project.id;

  perform public.write_audit_log(
    'project.completed',
    'projects',
    v_project.id,
    jsonb_build_object(
      'from', v_project.status,
      'to', 'completed',
      'phase', v_project.phase
    )
  );

  return 'completed'::public.project_status;
end;
$$;

revoke all on function public.project_apply_completion(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.project_complete(p_project_id uuid)
returns public.project_status
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return public.project_apply_completion(p_project_id, auth.uid());
end;
$$;

revoke all on function public.project_complete(uuid) from public, anon;
grant execute on function public.project_complete(uuid) to authenticated;

create or replace function public.project_reopen(
  p_project_id uuid,
  p_reason text
)
returns public.project_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_project public.projects%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select * into v_project
    from public.projects
   where id = p_project_id
   for update;

  if v_project.id is null
     or not public.is_company_member(v_project.company_id) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.user_roles ur
     where ur.user_id = v_actor
       and ur.company_id = v_project.company_id
       and ur.role = 'company_admin'::public.app_role
  ) then
    raise exception 'COMPANY_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if v_reason = '' then
    raise exception 'PROJECT_REOPEN_REASON_REQUIRED' using errcode = '23514';
  end if;

  if v_project.status <> 'completed'::public.project_status then
    raise exception 'PROJECT_NOT_COMPLETED' using errcode = 'P0001';
  end if;

  update public.projects
     set status = 'active'::public.project_status,
         updated_at = now()
   where id = v_project.id;

  perform public.write_audit_log(
    'project.reopened',
    'projects',
    v_project.id,
    jsonb_build_object(
      'from', 'completed',
      'to', 'active',
      'reason', v_reason
    )
  );

  return 'active'::public.project_status;
end;
$$;

revoke all on function public.project_reopen(uuid, text) from public, anon;
grant execute on function public.project_reopen(uuid, text) to authenticated;

-- Atomic final-gate decision. This prevents approval/gate rows from being
-- committed while project completion fails. Approval waits for every assigned
-- project admin; rejection closes all remaining sibling approvals.
create or replace function public.decide_handover_gate(
  p_approval_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_approval public.approvals%rowtype;
  v_instance public.approval_instances%rowtype;
  v_gate public.project_phase_gates%rowtype;
  v_now timestamptz := now();
  v_status public.project_status;
  v_peer_pending integer := 0;
begin
  if v_actor is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'INVALID_HANDOVER_DECISION' using errcode = '22023';
  end if;
  if p_decision = 'reject'
     and btrim(coalesce(p_comment, '')) = '' then
    raise exception 'COMMENT_REQUIRED_ON_REJECT' using errcode = '23514';
  end if;

  select * into v_approval
    from public.approvals
   where id = p_approval_id
   for update;
  if v_approval.id is null then
    raise exception 'APPROVAL_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_approval.approver_id is distinct from v_actor then
    raise exception 'NOT_YOUR_APPROVAL' using errcode = '42501';
  end if;
  if v_approval.status <> 'pending' then
    raise exception 'APPROVAL_ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  select * into v_instance
    from public.approval_instances
   where id = v_approval.instance_id
   for update;
  if v_instance.id is null then
    raise exception 'APPROVAL_INSTANCE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_instance.status not in ('pending', 'in_progress') then
    raise exception 'APPROVAL_INSTANCE_ALREADY_DECIDED' using errcode = 'P0001';
  end if;
  if v_instance.company_id is distinct from v_approval.company_id
     or (
       v_instance.entity <> 'project_phase_gate'
       and v_instance.entity_type <> 'project_phase_gate'
     ) then
    raise exception 'HANDOVER_GATE_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_gate
    from public.project_phase_gates
   where id = v_instance.entity_id
   for update;
  if v_gate.id is null then
    raise exception 'GATE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_gate.phase <> 'handover'::public.project_phase then
    raise exception 'HANDOVER_GATE_REQUIRED' using errcode = 'P0001';
  end if;
  if v_gate.status <> 'in_review' then
    raise exception 'GATE_NOT_IN_REVIEW' using errcode = 'P0001';
  end if;
  if v_gate.company_id is distinct from v_instance.company_id then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_gate.company_id) then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.user_roles ur
     where ur.user_id = v_actor
       and ur.company_id = v_gate.company_id
       and ur.role = 'project_admin'::public.app_role
  ) then
    raise exception 'PROJECT_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  perform set_config('gridmind.handover_decision', 'on', true);

  update public.approvals
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         comment = p_comment,
         decided_at = v_now
   where id = v_approval.id;

  if p_decision = 'approve' then
    -- Legacy workflows may still contain company-admin approvers. They cannot
    -- decide final handover under the new contract, so remove them from the
    -- quorum before counting outstanding project-admin approvals.
    update public.approvals a
       set status = 'skipped',
           comment = coalesce(comment, 'Handover approval reassigned to project admins'),
           decided_at = v_now
     where a.instance_id = v_instance.id
       and a.status = 'pending'
       and not exists (
         select 1
           from public.user_roles ur
          where ur.user_id = a.approver_id
            and ur.company_id = v_gate.company_id
            and ur.role = 'project_admin'::public.app_role
       );

    select count(*) into v_peer_pending
      from public.approvals
     where instance_id = v_instance.id
       and status = 'pending';

    if v_peer_pending > 0 then
      update public.approval_instances
         set status = 'in_progress'
       where id = v_instance.id
         and status = 'pending';

      return jsonb_build_object(
        'ok', true,
        'decision', p_decision,
        'pending_approvals', v_peer_pending,
        'project_id', v_gate.project_id,
        'project_status', null,
        'gate_id', v_gate.id
      );
    end if;

    update public.approval_instances
       set status = 'approved',
           decided_by = v_actor,
           decided_at = v_now,
           completed_at = v_now
     where id = v_instance.id;

    update public.project_phase_gates
       set status = 'approved',
           approved_by = v_actor,
           approved_at = v_now
     where id = v_gate.id;

    v_status := public.project_apply_completion(v_gate.project_id, v_actor);

    perform public.write_audit_log(
      'gate.transition_approved',
      'project_phase_gates',
      v_gate.id,
      jsonb_build_object(
        'project_id', v_gate.project_id,
        'phase', v_gate.phase,
        'next_phase', null,
        'approval_instance_id', v_instance.id,
        'comment', p_comment
      )
    );
  else
    update public.approvals
       set status = 'skipped',
           comment = coalesce(comment, 'Superseded by handover rejection'),
           decided_at = v_now
     where instance_id = v_instance.id
       and id <> v_approval.id
       and status = 'pending';

    update public.approval_instances
       set status = 'rejected',
           decided_by = v_actor,
           decided_at = v_now,
           completed_at = v_now
     where id = v_instance.id;

    update public.project_phase_gates
       set status = 'open',
           approval_instance_id = null
     where id = v_gate.id;

    v_status := null;

    perform public.write_audit_log(
      'gate.transition_rejected',
      'project_phase_gates',
      v_gate.id,
      jsonb_build_object(
        'project_id', v_gate.project_id,
        'phase', v_gate.phase,
        'approval_instance_id', v_instance.id,
        'comment', p_comment
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'decision', p_decision,
    'project_id', v_gate.project_id,
    'project_status', v_status,
    'gate_id', v_gate.id
  );
end;
$$;

revoke all on function public.decide_handover_gate(uuid, text, text) from public, anon;
grant execute on function public.decide_handover_gate(uuid, text, text) to authenticated;

-- Backfill pending handover workflows created before project-admin ownership
-- was enforced. Existing approvers remain; every assigned project admin must
-- approve, while any rejection closes the workflow atomically.
insert into public.approvals (
  company_id,
  instance_id,
  approver_id,
  status
)
select
  ai.company_id,
  ai.id,
  ur.user_id,
  'pending'
from public.approval_instances ai
join public.project_phase_gates g
  on g.id = ai.entity_id
 and g.company_id = ai.company_id
join public.user_roles ur
  on ur.company_id = ai.company_id
 and ur.role = 'project_admin'::public.app_role
where ai.status in ('pending', 'in_progress')
  and g.phase = 'handover'::public.project_phase
  and g.status = 'in_review'
  and (ai.entity = 'project_phase_gate' or ai.entity_type = 'project_phase_gate')
  and not exists (
    select 1
      from public.approvals a
     where a.instance_id = ai.id
       and a.approver_id = ur.user_id
  );

-- Retire legacy non-project-admin approvers after the replacement rows exist.
-- The marker is local to the migration transaction and permits this controlled
-- cleanup through the handover decision trigger.
select set_config('gridmind.handover_decision', 'on', true);

update public.approvals a
   set status = 'skipped',
       comment = coalesce(comment, 'Handover approval reassigned to project admins'),
       decided_at = now()
  from public.approval_instances ai
  join public.project_phase_gates g
    on g.id = ai.entity_id
   and g.company_id = ai.company_id
 where a.instance_id = ai.id
   and a.status = 'pending'
   and ai.status in ('pending', 'in_progress')
   and g.phase = 'handover'::public.project_phase
   and g.status = 'in_review'
   and (ai.entity = 'project_phase_gate' or ai.entity_type = 'project_phase_gate')
   and exists (
     select 1
       from public.approvals pa
       join public.user_roles pur
         on pur.user_id = pa.approver_id
        and pur.company_id = ai.company_id
        and pur.role = 'project_admin'::public.app_role
      where pa.instance_id = ai.id
        and pa.status = 'pending'
   )
   and not exists (
     select 1
       from public.user_roles ur
      where ur.user_id = a.approver_id
        and ur.company_id = ai.company_id
        and ur.role = 'project_admin'::public.app_role
   );
