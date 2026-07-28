-- 0105_controlled_copy_discipline.sql — P-266

alter table public.controlled_copies
  add column if not exists recall_due_at timestamptz,
  add column if not exists recall_reason text,
  add column if not exists destroyed_at timestamptz;

create index if not exists controlled_copies_recall_due_idx
  on public.controlled_copies (company_id, recall_due_at)
  where status = 'issued'::public.controlled_copy_status;

-- ---------------------------------------------------------------- recall due
create or replace function public.controlled_copies_flag_recall_due()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status in ('superseded'::public.document_register_status,
                    'obsolete'::public.document_register_status)
     and new.status is distinct from old.status then
    update public.controlled_copies
       set recall_due_at = coalesce(recall_due_at, now()),
           recall_reason = coalesce(recall_reason, 'document_' || new.status::text),
           updated_at = now()
     where document_id = new.id
       and status = 'issued'::public.controlled_copy_status;
  end if;
  return new;
end $$;

drop trigger if exists document_register_flag_recall_due_trg on public.document_register;
create trigger document_register_flag_recall_due_trg
after update on public.document_register
for each row execute function public.controlled_copies_flag_recall_due();

-- --------------------------------------------------------------- issue a copy
create or replace function public.issue_controlled_copy(
  p_document_id uuid,
  p_holder_user_id uuid default null,
  p_holder_contact_id uuid default null,
  p_holder_name text default null,
  p_location text default null,
  p_notes text default null,
  p_issue_date date default null
)
returns public.controlled_copies
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_doc public.document_register%rowtype;
  v_current uuid;
  v_copy public.controlled_copies%rowtype;
  v_number integer;
begin
  select * into v_doc from public.document_register where id = p_document_id;
  if v_doc.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_doc.company_id) or public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not (public.has_company_role('engineering_admin'::public.app_role)
          or public.has_company_role('project_admin'::public.app_role)
          or public.has_company_role('construction_admin'::public.app_role)
          or public.has_company_role('company_admin'::public.app_role)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  if v_doc.status in ('superseded'::public.document_register_status,
                      'obsolete'::public.document_register_status) then
    select id into v_current from public.document_current_in_lineage(p_document_id) limit 1;
    raise exception 'doc_not_current'
      using errcode = 'P0409',
            detail = coalesce(v_current::text, ''),
            hint = 'Issue the current revision instead.';
  end if;

  if coalesce(btrim(coalesce(p_holder_name, '')), '') = ''
     and p_holder_user_id is null and p_holder_contact_id is null then
    raise exception 'holder_required' using errcode = '23514';
  end if;

  select coalesce(max(copy_number), 0) + 1 into v_number
    from public.controlled_copies where document_id = p_document_id;

  insert into public.controlled_copies
    (company_id, document_id, copy_number, revision_pinned, holder_user_id,
     holder_contact_id, holder_name, location, issue_date, status, notes, created_by)
  values
    (v_doc.company_id, p_document_id, v_number, v_doc.current_revision, p_holder_user_id,
     p_holder_contact_id, nullif(btrim(coalesce(p_holder_name, '')), ''), p_location,
     coalesce(p_issue_date, current_date), 'issued'::public.controlled_copy_status,
     p_notes, auth.uid())
  returning * into v_copy;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_doc.company_id, auth.uid(), 'controlled_copy.issued', 'controlled_copies', v_copy.id,
          jsonb_build_object('document_id', p_document_id, 'copy_number', v_number,
                             'revision', v_doc.current_revision));
  return v_copy;
end $$;

-- -------------------------------------------------------------- recall a copy
create or replace function public.recall_controlled_copy(
  p_copy_id uuid,
  p_disposition text default 'recalled',
  p_notes text default null
)
returns public.controlled_copies
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_copy public.controlled_copies%rowtype;
begin
  if p_disposition not in ('recalled', 'returned', 'destroyed') then
    raise exception 'invalid_disposition' using errcode = '22023';
  end if;
  select * into v_copy from public.controlled_copies where id = p_copy_id;
  if v_copy.id is null then
    raise exception 'copy_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_copy.company_id) or public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not (public.has_company_role('engineering_admin'::public.app_role)
          or public.has_company_role('project_admin'::public.app_role)
          or public.has_company_role('construction_admin'::public.app_role)
          or public.has_company_role('company_admin'::public.app_role)) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if v_copy.status <> 'issued'::public.controlled_copy_status then
    raise exception 'copy_not_outstanding' using errcode = '23514';
  end if;

  update public.controlled_copies
     set status = p_disposition::public.controlled_copy_status,
         recalled_at = case when p_disposition in ('recalled', 'destroyed') then now() else recalled_at end,
         recalled_by = case when p_disposition in ('recalled', 'destroyed') then auth.uid() else recalled_by end,
         returned_at = case when p_disposition = 'returned' then now() else returned_at end,
         destroyed_at = case when p_disposition = 'destroyed' then now() else destroyed_at end,
         notes = coalesce(p_notes, notes),
         updated_at = now()
   where id = p_copy_id
  returning * into v_copy;
  return v_copy;
end $$;

-- ------------------------------------------------------------- read-only RPCs
create or replace function public.controlled_copy_completeness(p_document_id uuid)
returns table (total integer, outstanding integer, closed integer, recall_due integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.document_register where id = p_document_id;
  if v_company is null or not public.is_company_member(v_company) or public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select count(*)::int,
           count(*) filter (where c.status = 'issued'::public.controlled_copy_status)::int,
           count(*) filter (where c.status <> 'issued'::public.controlled_copy_status)::int,
           count(*) filter (where c.status = 'issued'::public.controlled_copy_status
                              and c.recall_due_at is not null)::int
      from public.controlled_copies c
     where c.document_id = p_document_id;
end $$;

create or replace function public.controlled_copy_queue(p_only_due boolean default false)
returns table (
  id uuid,
  document_id uuid,
  doc_number text,
  title text,
  doc_status text,
  copy_number integer,
  revision_pinned text,
  holder_name text,
  holder_user_id uuid,
  holder_contact_id uuid,
  location text,
  issue_date date,
  status text,
  recall_due_at timestamptz,
  recall_reason text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if public.is_external_viewer() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
    select c.id, c.document_id, d.doc_number, d.title, d.status::text, c.copy_number,
           c.revision_pinned, c.holder_name, c.holder_user_id, c.holder_contact_id,
           c.location, c.issue_date, c.status::text, c.recall_due_at, c.recall_reason
      from public.controlled_copies c
      join public.document_register d on d.id = c.document_id
     where public.is_company_member(c.company_id)
       and c.status = 'issued'::public.controlled_copy_status
       and (not p_only_due or c.recall_due_at is not null)
     order by c.recall_due_at nulls last, d.doc_number, c.copy_number;
end $$;

revoke all on function public.issue_controlled_copy(uuid, uuid, uuid, text, text, text, date) from public, anon;
revoke all on function public.recall_controlled_copy(uuid, text, text) from public, anon;
revoke all on function public.controlled_copy_completeness(uuid) from public, anon;
revoke all on function public.controlled_copy_queue(boolean) from public, anon;
grant execute on function public.issue_controlled_copy(uuid, uuid, uuid, text, text, text, date) to authenticated;
grant execute on function public.recall_controlled_copy(uuid, text, text) to authenticated;
grant execute on function public.controlled_copy_completeness(uuid) to authenticated;
grant execute on function public.controlled_copy_queue(boolean) to authenticated;