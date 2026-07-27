-- 0078 (continued, P-191) — controlled execution. Idempotent.
create table if not exists public.moc_implementation_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  change_request_id uuid not null references public.change_requests(id) on delete cascade,
  entity_type text,
  entity_id uuid,
  owner_role text not null default 'project_admin',
  title text not null,
  status text not null default 'pending' check (status in ('pending','done','skipped')),
  evidence jsonb not null default '[]',
  done_by uuid references public.profiles(id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_request_id, entity_type, entity_id, title)
);
alter table public.moc_implementation_tasks enable row level security;
drop policy if exists moc_tasks_select on public.moc_implementation_tasks;
create policy moc_tasks_select on public.moc_implementation_tasks for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists moc_tasks_update on public.moc_implementation_tasks;
create policy moc_tasks_update on public.moc_implementation_tasks for update to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer())
  with check (public.is_company_member(company_id) and not public.is_external_viewer());
drop trigger if exists trg_moc_tasks_updated on public.moc_implementation_tasks;
create trigger trg_moc_tasks_updated before update on public.moc_implementation_tasks
  for each row execute function public.set_updated_at();
grant select, update on public.moc_implementation_tasks to authenticated;
grant all on public.moc_implementation_tasks to service_role;

create index if not exists idx_moc_tasks_cr on public.moc_implementation_tasks (change_request_id);

create or replace function public.is_under_change_control(p_entity_type text, p_entity_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return true; end if;              -- fail closed
  return exists (
    select 1 from public.change_requests cr
     where cr.company_id = v_company and cr.status in ('assessment','approved','implementing')
       and exists (select 1 from jsonb_array_elements(coalesce(cr.affected_systems,'[]'::jsonb)) s
                   where s->>'entity_type' = p_entity_type
                     and nullif(s->>'entity_id','')::uuid = p_entity_id)
  ) or exists (
    select 1 from public.entity_links l
      join public.change_requests cr2
        on cr2.id = l.source_id and cr2.company_id = v_company
       and cr2.status in ('assessment','approved','implementing')
     where l.source_type = 'change_request' and l.link_type = 'impacts'
       and l.target_type = p_entity_type and l.target_id = p_entity_id
  );
end $$;

create or replace function public.generate_implementation_tasks(p_change_request_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_cr public.change_requests%rowtype; v_sys jsonb; v_link record;
  v_n int := 0; v_ins int;
begin
  select * into v_cr from public.change_requests where id = p_change_request_id for update;
  if not found then raise exception 'change_request_not_found'; end if;
  if v_cr.status not in ('approved','implementing') then
    raise exception 'cr_not_approved'; end if;

  for v_sys in select * from jsonb_array_elements(coalesce(v_cr.affected_systems, '[]'::jsonb)) loop
    if nullif(v_sys->>'entity_type','') is not null and nullif(v_sys->>'entity_id','') is not null then
      perform public.link_entities('change_request', v_cr.id, 'impacts',
        v_sys->>'entity_type', (v_sys->>'entity_id')::uuid, v_cr.company_id,
        jsonb_build_object('cr_number', v_cr.cr_number));
    end if;
    insert into public.moc_implementation_tasks
      (company_id, change_request_id, entity_type, entity_id, owner_role, title)
    values (v_cr.company_id, v_cr.id,
            nullif(v_sys->>'entity_type', ''), nullif(v_sys->>'entity_id', '')::uuid,
            coalesce(nullif(v_sys->>'owner_role', ''), 'project_admin'),
            'Implement ' || v_cr.cr_number || ' in ' || coalesce(nullif(v_sys->>'system',''), nullif(v_sys->>'label',''), 'affected system'))
    on conflict (change_request_id, entity_type, entity_id, title) do nothing;
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end loop;

  if v_cr.change_type = 'vendor_substitution' then
    insert into public.moc_implementation_tasks
      (company_id, change_request_id, owner_role, title)
    values
      (v_cr.company_id, v_cr.id, 'procurement_manager', 'Re-issue RFQ/PO with new vendor'),
      (v_cr.company_id, v_cr.id, 'procurement_manager', 'Update approved-vendor register')
    on conflict (change_request_id, entity_type, entity_id, title) do nothing;
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end if;

  for v_link in
    select l.target_type, l.target_id from public.entity_links l
     where l.company_id = v_cr.company_id and l.source_type = 'change_request'
       and l.source_id = v_cr.id and l.link_type = 'impacts'
  loop
    insert into public.moc_implementation_tasks
      (company_id, change_request_id, entity_type, entity_id, owner_role, title)
    values (v_cr.company_id, v_cr.id, v_link.target_type, v_link.target_id, 'project_admin',
            'Verify downstream impact of ' || v_cr.cr_number || ' on ' || v_link.target_type)
    on conflict (change_request_id, entity_type, entity_id, title) do nothing;
    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end loop;

  if to_regclass('public.notifications') is not null then
    insert into public.notifications (company_id, user_id, type, title, body, link)
    select v_cr.company_id, ur.user_id, 'moc',
           'Change ' || v_cr.cr_number || ' approved — implementation tasks assigned',
           v_cr.title, '/changes/' || v_cr.id
      from public.user_roles ur
     where ur.company_id = v_cr.company_id
       and ur.role::text in (select distinct owner_role from public.moc_implementation_tasks
                              where change_request_id = v_cr.id)
    on conflict do nothing;
  end if;

  perform public.write_audit_log('moc.tasks_generated', 'change_requests', v_cr.id,
    jsonb_build_object('task_count', v_n));
  return v_n;
end $$;

create or replace function public.close_change_request(
  p_id uuid, p_closure_notes text, p_updated_documents jsonb default '[]'::jsonb,
  p_updated_asbuilts jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_open int;
begin
  select count(*) into v_open from public.moc_implementation_tasks
   where change_request_id = p_id and status = 'pending';
  if v_open > 0 then raise exception 'open_tasks_remaining:%', v_open; end if;
  return public.transition_change_request(p_id, 'closed', jsonb_build_object(
    'closure_notes', p_closure_notes,
    'updated_documents', p_updated_documents,
    'updated_asbuilts', p_updated_asbuilts));
end $$;

revoke all on function public.is_under_change_control(text, uuid) from public, anon;
revoke all on function public.generate_implementation_tasks(uuid) from public, anon;
revoke all on function public.close_change_request(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function public.is_under_change_control(text, uuid),
  public.generate_implementation_tasks(uuid),
  public.close_change_request(uuid, text, jsonb, jsonb) to authenticated;