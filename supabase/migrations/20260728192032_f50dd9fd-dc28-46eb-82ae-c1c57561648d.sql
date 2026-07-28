-- 0099_subcontract_claim_settlement.sql — P-258: engine-owned claim certification.

-- Guard: only the approval engine may move a claim into/out of 'certified'.
create or replace function public.subcontract_claims_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and ('certified' in (new.status::text, old.status::text))
     and coalesce(current_setting('gridmind.approval_settle', true), 'off') <> 'on' then
    raise exception 'subcontract_claim_engine_only'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists subcontract_claims_guard_status_trg on public.subcontract_claims;
create trigger subcontract_claims_guard_status_trg
  before update on public.subcontract_claims
  for each row execute function public.subcontract_claims_guard_status();

-- Extend the derived-entity settler with the subcontract claim mirror.
create or replace function public.settle_derived_entity(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst    public.approval_instances%rowtype;
  v_applied boolean := false;
  v_approved boolean;
  v_comment text;
begin
  select * into v_inst from public.approval_instances where id = p_instance_id;
  if not found or v_inst.status not in ('approved', 'rejected') then
    return jsonb_build_object('settled', false, 'reason', 'not_decided');
  end if;
  v_approved := (v_inst.status = 'approved');

  if v_inst.entity_type = 'sld_drawing' then
    perform set_config('gridmind.approval_settle', 'on', true);
    update public.sld_drawings
       set status = case when v_approved then 'approved'::public.sld_status
                         else 'draft'::public.sld_status end,
           updated_at = now()
     where id = v_inst.entity_id
       and status = 'under_review'::public.sld_status;
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

  elsif v_inst.entity_type in ('timesheet', 'timesheet_week') then
    perform set_config('gridmind.approval_settle', 'on', true);
    update public.timesheets
       set status = case when v_approved then 'approved'::public.timesheet_status
                         else 'rejected'::public.timesheet_status end,
           approval_instance_id = coalesce(approval_instance_id, v_inst.id),
           updated_at = now()
     where id = v_inst.entity_id
       and status in ('submitted'::public.timesheet_status,
                      'in_review'::public.timesheet_status);
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

  elsif v_inst.entity_type = 'subcontract_claim' then
    select a.comment into v_comment
      from public.approvals a
     where a.instance_id = v_inst.id and a.decided_at is not null
     order by a.decided_at desc
     limit 1;

    perform set_config('gridmind.approval_settle', 'on', true);
    update public.subcontract_claims
       set status = case when v_approved then 'certified'::public.subcontract_claim_status
                         else 'rejected'::public.subcontract_claim_status end,
           approval_instance_id = coalesce(approval_instance_id, v_inst.id),
           certified_by = case when v_approved
                               then coalesce(certified_by, v_inst.decided_by, auth.uid())
                               else certified_by end,
           certified_at = case when v_approved
                               then coalesce(certified_at, v_inst.decided_at, now())
                               else certified_at end,
           rejection_reason = case when v_approved then null else v_comment end,
           updated_at = now()
     where id = v_inst.entity_id
       and status in ('submitted'::public.subcontract_claim_status,
                      'under_review'::public.subcontract_claim_status);
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

  else
    return jsonb_build_object('settled', false, 'reason', 'entity_not_mirrored',
                              'entity_type', v_inst.entity_type);
  end if;

  return jsonb_build_object('settled', v_applied, 'entity_type', v_inst.entity_type,
                            'entity_id', v_inst.entity_id);
end; $$;

revoke all on function public.settle_derived_entity(uuid) from public, anon;
grant execute on function public.settle_derived_entity(uuid) to authenticated, service_role;
