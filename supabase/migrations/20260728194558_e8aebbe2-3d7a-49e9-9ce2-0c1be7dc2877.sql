-- P-259 — Sub portal (external half).
-- Doctrine: portal users never read internal tables directly; they go through
-- SECURITY DEFINER sub_portal_* routines that project safe columns only.

-- 1) Internal-only raw SELECT on the subcontract tables ---------------------
drop policy if exists subcontracts_select on public.subcontracts;
create policy subcontracts_select on public.subcontracts
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_lines_select on public.subcontract_lines;
create policy subcontract_lines_select on public.subcontract_lines
  for select to authenticated
  using (exists (select 1 from public.subcontracts s
                  where s.id = subcontract_lines.subcontract_id
                    and public.is_company_member(s.company_id)
                    and not public.is_external_viewer()));

drop policy if exists subcontract_claims_select on public.subcontract_claims;
create policy subcontract_claims_select on public.subcontract_claims
  for select to authenticated
  using (exists (select 1 from public.subcontracts s
                  where s.id = subcontract_claims.subcontract_id
                    and public.is_company_member(s.company_id)
                    and not public.is_external_viewer()));

drop policy if exists subcontract_claim_lines_select on public.subcontract_claim_lines;
create policy subcontract_claim_lines_select on public.subcontract_claim_lines
  for select to authenticated
  using (exists (select 1
                   from public.subcontract_claims c
                   join public.subcontracts s on s.id = c.subcontract_id
                  where c.id = subcontract_claim_lines.claim_id
                    and public.is_company_member(s.company_id)
                    and not public.is_external_viewer()));

-- 2) Claim messages ---------------------------------------------------------
create table if not exists public.subcontract_claim_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  claim_id uuid not null references public.subcontract_claims(id) on delete cascade,
  author_id uuid,
  author_type text not null default 'internal' check (author_type in ('internal','sub')),
  internal_only boolean not null default false,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subcontract_claim_messages_claim_idx
  on public.subcontract_claim_messages (claim_id, created_at desc);

grant select, insert on public.subcontract_claim_messages to authenticated;
grant all on public.subcontract_claim_messages to service_role;

alter table public.subcontract_claim_messages enable row level security;

drop policy if exists subcontract_claim_messages_select on public.subcontract_claim_messages;
create policy subcontract_claim_messages_select on public.subcontract_claim_messages
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_claim_messages_insert on public.subcontract_claim_messages;
create policy subcontract_claim_messages_insert on public.subcontract_claim_messages
  for insert to authenticated
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and author_type = 'internal'
              and author_id = auth.uid());

drop trigger if exists subcontract_claim_messages_touch on public.subcontract_claim_messages;
create trigger subcontract_claim_messages_touch
  before update on public.subcontract_claim_messages
  for each row execute function public.update_updated_at_column();

-- 3) Compliance documents (feeds P-260) -------------------------------------
alter table public.vendor_portal_documents
  add column if not exists expires_on date;

create or replace function public.vendor_portal_register_document(
  p_vendor_id uuid, p_title text, p_category text, p_file_path text,
  p_file_name text default null, p_mime_type text default null,
  p_file_size bigint default null, p_expires_on date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_m public.vendor_portal_memberships%rowtype; v_id uuid; v_company uuid; v_actor text;
begin
  if p_category not in ('vendor_submittal','vendor_published','vendor_compliance') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;

  if p_category = 'vendor_published' then
    select company_id into v_company from public.vendors where id = p_vendor_id;
    if v_company is null or not public.is_company_member(v_company)
       or public.is_external_viewer() then
      raise exception 'vendor_portal_access_denied' using errcode = '42501';
    end if;
    v_actor := 'internal';
  else
    v_m := public.vendor_portal_assert_access(p_vendor_id);
    if coalesce((v_m.exposure->>'documents')::boolean, false) is not true then
      raise exception 'documents_not_exposed' using errcode = '42501';
    end if;
    v_company := v_m.company_id;
    v_actor := 'vendor';
  end if;

  insert into public.vendor_portal_documents
    (company_id, vendor_id, title, category, storage_path, file_name, mime_type,
     file_size_bytes, actor_type, uploaded_by, expires_on)
  values (v_company, p_vendor_id, btrim(p_title), p_category, p_file_path, p_file_name,
          p_mime_type, p_file_size, v_actor::public.vendor_portal_actor, auth.uid(), p_expires_on)
  returning id into v_id;

  perform public.vendor_portal_write_event(
    p_vendor_id := p_vendor_id,
    p_event := case when v_actor = 'vendor' then 'vendor_portal.document_uploaded'
                    else 'vendor_portal.document_published' end,
    p_metadata := jsonb_build_object('document_id', v_id, 'title', btrim(p_title),
                                     'category', p_category, 'expires_on', p_expires_on),
    p_ip := null, p_user_agent := null, p_company_id := v_company);

  return v_id;
end $$;

revoke all on function public.vendor_portal_register_document(uuid, text, text, text, text, text, bigint, date) from public, anon;
grant execute on function public.vendor_portal_register_document(uuid, text, text, text, text, text, bigint, date) to authenticated, service_role;

-- 4) Sub portal read routines ----------------------------------------------
create or replace function public.sub_portal_list_subcontracts(p_vendor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid; v_out jsonb;
begin
  select m.company_id into v_company
    from public.vendor_portal_memberships m
   where m.vendor_id = p_vendor_id and m.user_id = auth.uid()
     and m.status::text = 'active'
     and (m.expires_at is null or m.expires_at > now())
   limit 1;
  if v_company is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_out
    from (
      select s.id, s.subcontract_number, s.title, s.scope_summary, s.contract_value,
             s.currency_code, s.retention_pct, s.start_date, s.end_date, s.status::text as status,
             s.certified_to_date, s.retention_held, s.retention_released,
             p.name as project_name, s.created_at
        from public.subcontracts s
        left join public.projects p on p.id = s.project_id
       where s.company_id = v_company
         and s.vendor_id = p_vendor_id
         and s.status::text <> 'draft'
    ) t;
  return v_out;
end $$;

create or replace function public.sub_portal_get_subcontract(p_subcontract_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_s public.subcontracts%rowtype; v_out jsonb;
begin
  select * into v_s from public.subcontracts where id = p_subcontract_id;
  if v_s.id is null or v_s.status::text = 'draft'
     or not public.sub_portal_has_seat(v_s.vendor_id, v_s.company_id) then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'subcontract', jsonb_build_object(
      'id', v_s.id, 'subcontract_number', v_s.subcontract_number, 'title', v_s.title,
      'scope_summary', v_s.scope_summary, 'contract_value', v_s.contract_value,
      'currency_code', v_s.currency_code, 'retention_pct', v_s.retention_pct,
      'start_date', v_s.start_date, 'end_date', v_s.end_date, 'status', v_s.status::text,
      'certified_to_date', v_s.certified_to_date, 'retention_held', v_s.retention_held,
      'retention_released', v_s.retention_released,
      'project_name', (select p.name from public.projects p where p.id = v_s.project_id),
      'created_at', v_s.created_at),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'line_no', l.line_no, 'description', l.description,
               'uom', l.uom, 'qty', l.qty, 'unit_price', l.unit_price, 'amount', l.amount,
               'certified_pct', coalesce((
                  select max(cl.cumulative_pct)
                    from public.subcontract_claim_lines cl
                    join public.subcontract_claims c on c.id = cl.claim_id
                   where cl.subcontract_line_id = l.id and c.status::text = 'certified'), 0),
               'pending_pct', coalesce((
                  select sum(cl.this_period_pct)
                    from public.subcontract_claim_lines cl
                    join public.subcontract_claims c on c.id = cl.claim_id
                   where cl.subcontract_line_id = l.id
                     and c.status::text in ('draft','submitted','under_review')), 0)
             ) order by l.line_no), '[]'::jsonb)
        from public.subcontract_lines l where l.subcontract_id = v_s.id),
    'claims', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id, 'claim_number', c.claim_number, 'period_start', c.period_start,
               'period_end', c.period_end, 'status', c.status::text,
               'this_period_amount', c.this_period_amount, 'gross_to_date', c.gross_to_date,
               'retention_amount', c.retention_amount, 'net_payable', c.net_payable,
               'submitted_at', c.submitted_at, 'certified_at', c.certified_at,
               'rejection_reason', c.rejection_reason, 'created_at', c.created_at
             ) order by c.created_at desc), '[]'::jsonb)
        from public.subcontract_claims c where c.subcontract_id = v_s.id)
  ) into v_out;
  return v_out;
end $$;

create or replace function public.sub_portal_get_claim(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_c public.subcontract_claims%rowtype; v_s public.subcontracts%rowtype; v_out jsonb;
begin
  select * into v_c from public.subcontract_claims where id = p_claim_id;
  if v_c.id is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;
  select * into v_s from public.subcontracts where id = v_c.subcontract_id;
  if not public.sub_portal_has_seat(v_s.vendor_id, v_s.company_id) then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'claim', jsonb_build_object(
      'id', v_c.id, 'claim_number', v_c.claim_number, 'period_start', v_c.period_start,
      'period_end', v_c.period_end, 'status', v_c.status::text,
      'previous_certified', v_c.previous_certified, 'this_period_amount', v_c.this_period_amount,
      'gross_to_date', v_c.gross_to_date, 'retention_amount', v_c.retention_amount,
      'net_payable', v_c.net_payable, 'submitted_at', v_c.submitted_at,
      'certified_at', v_c.certified_at, 'rejection_reason', v_c.rejection_reason,
      'subcontract_id', v_c.subcontract_id),
    'subcontract', jsonb_build_object(
      'id', v_s.id, 'subcontract_number', v_s.subcontract_number, 'title', v_s.title,
      'currency_code', v_s.currency_code, 'retention_pct', v_s.retention_pct,
      'contract_value', v_s.contract_value),
    'lines', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', cl.id, 'subcontract_line_id', cl.subcontract_line_id,
               'line_no', l.line_no, 'description', l.description, 'uom', l.uom,
               'line_amount', cl.line_amount, 'previous_pct', cl.previous_pct,
               'this_period_pct', cl.this_period_pct, 'cumulative_pct', cl.cumulative_pct,
               'previous_amount', cl.previous_amount, 'this_period_amount', cl.this_period_amount
             ) order by l.line_no), '[]'::jsonb)
        from public.subcontract_claim_lines cl
        join public.subcontract_lines l on l.id = cl.subcontract_line_id
       where cl.claim_id = v_c.id),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'author_type', m.author_type, 'body', m.body,
               'created_at', m.created_at) order by m.created_at), '[]'::jsonb)
        from public.subcontract_claim_messages m
       where m.claim_id = v_c.id and m.internal_only = false)
  ) into v_out;
  return v_out;
end $$;

-- 5) Sub portal write routines ---------------------------------------------
create or replace function public.sub_portal_submit_claim(
  p_subcontract_id uuid,
  p_period_start date,
  p_period_end date,
  p_lines jsonb,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_s public.subcontracts%rowtype;
  v_claim_id uuid;
  v_instance uuid;
  v_line jsonb;
  v_line_id uuid;
  v_pct numeric;
  v_count int := 0;
begin
  select * into v_s from public.subcontracts where id = p_subcontract_id;
  if v_s.id is null or not public.sub_portal_has_seat(v_s.vendor_id, v_s.company_id) then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;
  if v_s.status::text <> 'active' then
    raise exception 'subcontract_not_active' using errcode = '42501';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'lines_required' using errcode = '22023';
  end if;
  if exists (select 1 from public.subcontract_claims c
              where c.subcontract_id = v_s.id
                and c.status::text in ('draft','submitted','under_review')) then
    raise exception 'claim_already_open' using errcode = '42501';
  end if;

  insert into public.subcontract_claims
    (company_id, subcontract_id, period_start, period_end, status, created_by)
  values (v_s.company_id, v_s.id, p_period_start, p_period_end, 'draft', auth.uid())
  returning id into v_claim_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'subcontract_line_id','')::uuid;
    v_pct := coalesce((v_line->>'this_period_pct')::numeric, 0);
    if v_line_id is null then
      raise exception 'line_not_on_subcontract' using errcode = '22023';
    end if;
    if not exists (select 1 from public.subcontract_lines l
                    where l.id = v_line_id and l.subcontract_id = v_s.id) then
      raise exception 'line_not_on_subcontract' using errcode = '22023';
    end if;
    if v_pct = 0 then continue; end if;
    if v_pct < 0 then
      raise exception 'claim_cumulative_out_of_range' using errcode = '22023';
    end if;
    -- the derive trigger recomputes previous/cumulative and enforces 0..100
    insert into public.subcontract_claim_lines
      (company_id, claim_id, subcontract_line_id, this_period_pct)
    values (v_s.company_id, v_claim_id, v_line_id, round(v_pct, 3));
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'lines_required' using errcode = '22023';
  end if;

  perform public.subcontract_claim_recalc(v_claim_id);

  select public.start_approval_instance(
    'subcontract_claim_certify', 'subcontract_claim', v_claim_id,
    (select net_payable from public.subcontract_claims where id = v_claim_id),
    jsonb_build_object(
      'title', coalesce(v_s.subcontract_number,'') || ' ' || v_s.title,
      'subcontract_id', v_s.id,
      'currency', v_s.currency_code,
      'source', 'sub_portal')
  ) into v_instance;

  update public.subcontract_claims
     set status = 'submitted',
         submitted_by = auth.uid(),
         submitted_at = now(),
         approval_instance_id = v_instance,
         rejection_reason = null,
         updated_at = now()
   where id = v_claim_id;

  if p_note is not null and btrim(p_note) <> '' then
    insert into public.subcontract_claim_messages
      (company_id, claim_id, author_id, author_type, body)
    values (v_s.company_id, v_claim_id, auth.uid(), 'sub', btrim(p_note));
  end if;

  perform public.vendor_portal_write_event(
    p_vendor_id := v_s.vendor_id,
    p_event := 'sub_portal.claim_submitted',
    p_metadata := jsonb_build_object('claim_id', v_claim_id, 'subcontract_id', v_s.id,
                                     'line_count', v_count),
    p_ip := null, p_user_agent := null, p_company_id := v_s.company_id);

  insert into public.notifications (company_id, user_id, type, title, body, link)
  select v_s.company_id, ur.user_id, 'sub_portal.claim_submitted',
         'Progress claim submitted for ' || coalesce(v_s.subcontract_number, v_s.title),
         'A subcontractor submitted a progress claim for certification.',
         '/procurement/subcontracts/claims/' || v_claim_id::text
    from public.user_roles ur
   where ur.company_id = v_s.company_id
     and ur.role::text in ('project_admin','construction_admin','procurement_admin','finance_admin');

  perform public.write_audit_log('sub_portal.claim_submitted', 'subcontract_claims', v_claim_id,
    jsonb_build_object('subcontract_id', v_s.id, 'vendor_id', v_s.vendor_id,
                       'line_count', v_count, 'instance_id', v_instance));

  return jsonb_build_object('claim_id', v_claim_id, 'instance_id', v_instance);
end $$;

create or replace function public.sub_portal_add_claim_message(p_claim_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_c public.subcontract_claims%rowtype; v_s public.subcontracts%rowtype; v_id uuid;
begin
  if p_body is null or btrim(p_body) = '' then
    raise exception 'message_required' using errcode = '22023';
  end if;
  select * into v_c from public.subcontract_claims where id = p_claim_id;
  if v_c.id is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;
  select * into v_s from public.subcontracts where id = v_c.subcontract_id;
  if not public.sub_portal_has_seat(v_s.vendor_id, v_s.company_id) then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  insert into public.subcontract_claim_messages
    (company_id, claim_id, author_id, author_type, body)
  values (v_s.company_id, p_claim_id, auth.uid(), 'sub', btrim(left(p_body, 4000)))
  returning id into v_id;

  perform public.vendor_portal_write_event(
    p_vendor_id := v_s.vendor_id,
    p_event := 'sub_portal.claim_message',
    p_metadata := jsonb_build_object('claim_id', p_claim_id),
    p_ip := null, p_user_agent := null, p_company_id := v_s.company_id);

  return v_id;
end $$;

revoke all on function public.sub_portal_list_subcontracts(uuid) from public, anon;
revoke all on function public.sub_portal_get_subcontract(uuid) from public, anon;
revoke all on function public.sub_portal_get_claim(uuid) from public, anon;
revoke all on function public.sub_portal_submit_claim(uuid, date, date, jsonb, text) from public, anon;
revoke all on function public.sub_portal_add_claim_message(uuid, text) from public, anon;
grant execute on function public.sub_portal_list_subcontracts(uuid) to authenticated, service_role;
grant execute on function public.sub_portal_get_subcontract(uuid) to authenticated, service_role;
grant execute on function public.sub_portal_get_claim(uuid) to authenticated, service_role;
grant execute on function public.sub_portal_submit_claim(uuid, date, date, jsonb, text) to authenticated, service_role;
grant execute on function public.sub_portal_add_claim_message(uuid, text) to authenticated, service_role;