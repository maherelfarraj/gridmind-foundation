-- 0065_pv_layout_approvals.sql — P-153 approval wiring for PV layouts. Idempotent.

-- Ensure the pv_layout_approval rule + single engineering_admin step exists for a company.
create or replace function public.ensure_pv_layout_rule(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule_id uuid;
begin
  insert into public.approval_rules
    (company_id, rule_key, name, description, entity_type, sla_hours, is_active)
  values
    (p_company_id, 'pv_layout_approval', 'PV layout approval',
     'Engineering sign-off on a PV plant layout option.', 'pv_layout', 48, true)
  on conflict (company_id, rule_key) do nothing;

  select id into v_rule_id
    from public.approval_rules
   where company_id = p_company_id and rule_key = 'pv_layout_approval';

  if v_rule_id is null then
    return null;
  end if;

  insert into public.approval_chain_steps (company_id, rule_id, step_order, role, sla_hours)
  values (p_company_id, v_rule_id, 1, 'engineering_admin'::public.app_role, 48)
  on conflict (rule_id, step_order) do nothing;

  return v_rule_id;
end;
$$;

revoke all on function public.ensure_pv_layout_rule(uuid) from public, anon;
grant execute on function public.ensure_pv_layout_rule(uuid) to authenticated;

-- Backfill the rule for every existing company.
do $$
declare r record;
begin
  for r in select id from public.companies loop
    perform public.ensure_pv_layout_rule(r.id);
  end loop;
end $$;

-- Submit a draft layout for approval (P-111 engine).
create or replace function public.submit_pv_layout(p_layout_id uuid)
returns public.pv_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout public.pv_layouts;
  v_instance uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_layout from public.pv_layouts where id = p_layout_id for update;
  if not found then
    raise exception 'layout_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_layout.company_id) then
    raise exception 'forbidden_company' using errcode = '42501';
  end if;
  if not (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')
  ) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;
  if v_layout.status not in ('draft','under_review') then
    raise exception 'layout_locked' using errcode = 'P0001';
  end if;

  perform public.ensure_pv_layout_rule(v_layout.company_id);

  v_instance := public.start_approval_instance(
    'pv_layout_approval', 'pv_layout', p_layout_id, null,
    jsonb_build_object('project_id', v_layout.project_id,
                       'layout_number', v_layout.layout_number,
                       'name', v_layout.name)
  );

  update public.pv_layouts
     set status = 'under_review',
         approval_instance_id = coalesce(v_instance, approval_instance_id),
         updated_at = now()
   where id = p_layout_id
  returning * into v_layout;

  perform public.write_audit_log('pv_layout.submitted', 'pv_layouts', p_layout_id,
    jsonb_build_object('project_id', v_layout.project_id,
                       'approval_instance_id', v_instance,
                       'layout_number', v_layout.layout_number));

  return v_layout;
end;
$$;

revoke all on function public.submit_pv_layout(uuid) from public, anon;
grant execute on function public.submit_pv_layout(uuid) to authenticated;

-- Engine callback: reflect the approval instance decision onto the layout.
-- Approval locks the layout and supersedes every sibling option on the project.
create or replace function public.decide_pv_layout_approval(p_layout_id uuid)
returns public.pv_layouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_layout public.pv_layouts;
  v_status text;
  v_superseded int := 0;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_layout from public.pv_layouts where id = p_layout_id for update;
  if not found then
    raise exception 'layout_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_layout.company_id) then
    raise exception 'forbidden_company' using errcode = '42501';
  end if;
  if not (
    public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'project_admin')
  ) then
    raise exception 'forbidden_role' using errcode = '42501';
  end if;

  select status into v_status
    from public.approval_instances
   where entity_type = 'pv_layout'
     and entity_id = p_layout_id
   order by requested_at desc
   limit 1;

  if v_status is null then
    raise exception 'no_approval_instance' using errcode = 'P0002';
  end if;

  if v_status = 'approved' then
    update public.pv_layouts
       set status = 'approved', updated_at = now()
     where id = p_layout_id
    returning * into v_layout;

    with sup as (
      update public.pv_layouts
         set status = 'superseded', updated_at = now()
       where project_id = v_layout.project_id
         and id <> p_layout_id
         and status in ('draft','under_review','approved')
      returning id
    )
    select count(*) into v_superseded from sup;

    perform public.write_audit_log('pv_layout.approved', 'pv_layouts', p_layout_id,
      jsonb_build_object('project_id', v_layout.project_id,
                         'superseded_siblings', v_superseded));

  elsif v_status in ('rejected','cancelled') then
    update public.pv_layouts
       set status = 'draft', updated_at = now()
     where id = p_layout_id
    returning * into v_layout;

    perform public.write_audit_log('pv_layout.' || v_status, 'pv_layouts', p_layout_id,
      jsonb_build_object('project_id', v_layout.project_id));
  else
    raise exception 'approval_pending' using errcode = 'P0001';
  end if;

  return v_layout;
end;
$$;

revoke all on function public.decide_pv_layout_approval(uuid) from public, anon;
grant execute on function public.decide_pv_layout_approval(uuid) to authenticated;