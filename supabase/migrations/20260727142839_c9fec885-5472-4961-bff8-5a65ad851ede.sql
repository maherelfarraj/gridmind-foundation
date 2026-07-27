-- 0090 (continued) — P-225 vendor invoices + two-way document exchange

create table if not exists public.vendor_portal_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null,
  title text not null,
  category text not null check (category in ('vendor_submittal','vendor_published')),
  storage_path text not null,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  actor_type text not null default 'vendor' check (actor_type in ('vendor','internal')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_portal_documents_vendor_idx
  on public.vendor_portal_documents (company_id, vendor_id, created_at desc);

grant select, insert, update, delete on public.vendor_portal_documents to authenticated;
grant all on public.vendor_portal_documents to service_role;

alter table public.vendor_portal_documents enable row level security;

drop policy if exists vendor_portal_documents_select on public.vendor_portal_documents;
create policy vendor_portal_documents_select on public.vendor_portal_documents
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists vendor_portal_documents_write on public.vendor_portal_documents;
create policy vendor_portal_documents_write on public.vendor_portal_documents
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin') or public.has_company_role('procurement_officer')
         or public.has_company_role('company_admin'))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin') or public.has_company_role('procurement_officer')
         or public.has_company_role('company_admin'))
  );

drop trigger if exists vendor_portal_documents_updated_at on public.vendor_portal_documents;
create trigger vendor_portal_documents_updated_at
  before update on public.vendor_portal_documents
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Vendor invoice submission → three_way_matches (P-067 schema, unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.vendor_portal_submit_invoice(
  p_po_id uuid, p_vendor_invoice_number text, p_invoice_date date,
  p_invoice_amount numeric, p_currency text, p_file_path text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_po public.purchase_orders%rowtype;
  v_m public.vendor_portal_memberships%rowtype;
  v_id uuid;
begin
  if p_vendor_invoice_number is null or btrim(p_vendor_invoice_number) = '' then
    raise exception 'invoice_number_required' using errcode = '22023';
  end if;
  if p_invoice_amount is null or p_invoice_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then raise exception 'po_not_found' using errcode = '42704'; end if;

  v_m := public.vendor_portal_assert_access(v_po.vendor_id);
  if coalesce((v_m.exposure->>'invoices')::boolean, false) is not true then
    raise exception 'invoices_not_exposed' using errcode = '42501';
  end if;

  if p_file_path is null or p_file_path not like
     v_po.company_id::text || '/vendor-invoices/' || v_po.vendor_id::text || '/' || p_po_id::text || '/%' then
    raise exception 'invalid_file_path' using errcode = '42501';
  end if;

  insert into public.three_way_matches
    (company_id, po_id, vendor_invoice_number, invoice_date, invoice_amount,
     invoice_currency_code, invoice_file_path, status, created_by)
  values (v_po.company_id, p_po_id, btrim(p_vendor_invoice_number), p_invoice_date,
          p_invoice_amount, coalesce(p_currency, v_po.currency_code), p_file_path, 'pending', auth.uid())
  returning id into v_id;

  perform public.vendor_portal_write_event(
    p_vendor_id := v_po.vendor_id,
    p_event := 'vendor_portal.invoice_submitted',
    p_metadata := jsonb_build_object('po_id', p_po_id, 'po_number', v_po.po_number, 'match_id', v_id,
                                     'amount', p_invoice_amount, 'currency', p_currency),
    p_ip := null, p_user_agent := null, p_company_id := v_po.company_id);

  insert into public.notifications (company_id, user_id, type, title, body, link)
  select v_po.company_id, ur.user_id, 'vendor_portal.invoice_submitted',
         'Vendor invoice ' || btrim(p_vendor_invoice_number) || ' uploaded for ' || v_po.po_number,
         'Amount ' || p_invoice_amount::text || ' ' || coalesce(p_currency, v_po.currency_code)
           || ' — queued for 3-way match',
         '/procurement/matching'
    from public.user_roles ur
   where ur.company_id = v_po.company_id
     and ur.role::text in ('procurement_admin','procurement_officer');

  perform public.write_audit_log('vendor_portal.invoice_submitted', 'three_way_matches', v_id,
    jsonb_build_object('po_id', p_po_id, 'vendor_id', v_po.vendor_id, 'amount', p_invoice_amount));

  return v_id;
end $$;

create or replace function public.vendor_portal_get_submitted_invoices(p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.vendor_portal_memberships%rowtype; v_out jsonb := '[]'::jsonb;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'invoices')::boolean, false) is not true then
    raise exception 'invoices_not_exposed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_out from (
    select m.id, m.vendor_invoice_number, m.invoice_date, m.invoice_amount,
           m.invoice_currency_code, m.status::text as status, m.invoice_file_path,
           m.amount_variance, m.payment_release_blocked, m.created_at, p.po_number
      from public.three_way_matches m
      join public.purchase_orders p on p.id = m.po_id
     where m.company_id = v_m.company_id and p.vendor_id = p_vendor_id
     order by m.created_at desc limit 200) t;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Two-way document exchange
-- ---------------------------------------------------------------------------
create or replace function public.vendor_portal_register_document(
  p_vendor_id uuid, p_title text, p_category text, p_file_path text,
  p_file_name text default null, p_mime_type text default null, p_file_size bigint default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_m public.vendor_portal_memberships%rowtype; v_id uuid; v_company uuid; v_actor text;
begin
  if p_category not in ('vendor_submittal','vendor_published') then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'title_required' using errcode = '22023';
  end if;

  if p_category = 'vendor_submittal' then
    v_m := public.vendor_portal_assert_access(p_vendor_id);
    if coalesce((v_m.exposure->>'documents')::boolean, false) is not true then
      raise exception 'documents_not_exposed' using errcode = '42501';
    end if;
    v_company := v_m.company_id;
    v_actor := 'vendor';
  else
    select company_id into v_company from public.profiles where id = auth.uid();
    if v_company is null then raise exception 'no_company' using errcode = '42501'; end if;
    if not (public.has_company_role('procurement_admin') or public.has_company_role('procurement_officer')
            or public.has_company_role('company_admin')) then
      raise exception 'forbidden_role' using errcode = '42501';
    end if;
    v_actor := 'internal';
  end if;

  if p_file_path is null or p_file_path not like
     v_company::text || '/vendor-docs/' || p_vendor_id::text || '/%' then
    raise exception 'invalid_file_path' using errcode = '42501';
  end if;

  insert into public.vendor_portal_documents
    (company_id, vendor_id, title, category, storage_path, file_name, mime_type, file_size_bytes,
     actor_type, created_by)
  values (v_company, p_vendor_id, btrim(p_title), p_category, p_file_path, p_file_name, p_mime_type,
          p_file_size, v_actor, auth.uid())
  returning id into v_id;

  perform public.vendor_portal_write_event(
    p_vendor_id := p_vendor_id,
    p_event := 'vendor_portal.document_shared',
    p_metadata := jsonb_build_object('title', btrim(p_title), 'category', p_category,
                                     'path', p_file_path, 'actor_type', v_actor),
    p_ip := null, p_user_agent := null, p_company_id := v_company);

  if p_category = 'vendor_published' then
    insert into public.notifications (company_id, user_id, type, title, body, link)
    select v_company, vpm.user_id, 'vendor_portal.document_published',
           'New document shared with you: ' || btrim(p_title),
           'Your buyer published a document to the vendor portal.',
           '/vendor/' || p_vendor_id::text || '/documents'
      from public.vendor_portal_memberships vpm
     where vpm.company_id = v_company and vpm.vendor_id = p_vendor_id
       and vpm.status = 'active' and vpm.user_id is not null;
  end if;

  perform public.write_audit_log('vendor_portal.document_shared', 'vendor_portal_documents', v_id,
    jsonb_build_object('vendor_id', p_vendor_id, 'category', p_category, 'actor_type', v_actor));

  return v_id;
end $$;

create or replace function public.vendor_portal_get_portal_documents(p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.vendor_portal_memberships%rowtype; v_out jsonb := '[]'::jsonb;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'documents')::boolean, false) is not true then
    raise exception 'documents_not_exposed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_out from (
    select id, title, category, storage_path, file_name, mime_type, file_size_bytes,
           actor_type, created_at
      from public.vendor_portal_documents
     where company_id = v_m.company_id and vendor_id = p_vendor_id
     order by created_at desc limit 200) t;
  return v_out;
end $$;

revoke all on function public.vendor_portal_submit_invoice(uuid,text,date,numeric,text,text) from public, anon;
revoke all on function public.vendor_portal_get_submitted_invoices(uuid) from public, anon;
revoke all on function public.vendor_portal_register_document(uuid,text,text,text,text,text,bigint) from public, anon;
revoke all on function public.vendor_portal_get_portal_documents(uuid) from public, anon;

grant execute on function public.vendor_portal_submit_invoice(uuid,text,date,numeric,text,text) to authenticated;
grant execute on function public.vendor_portal_get_submitted_invoices(uuid) to authenticated;
grant execute on function public.vendor_portal_register_document(uuid,text,text,text,text,text,bigint) to authenticated;
grant execute on function public.vendor_portal_get_portal_documents(uuid) to authenticated;