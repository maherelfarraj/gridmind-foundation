-- 0090_vendor_portal_p222.sql — P-222 vendor portal shell data RPCs

-- 1) Distinct exposure error for POs
create or replace function public.vendor_portal_get_pos(p_vendor_id uuid)
returns table (
  id uuid,
  po_number text,
  status text,
  currency_code text,
  issued_at timestamptz,
  required_by_date date,
  total_amount numeric,
  lines jsonb
)
language plpgsql
security definer
set search_path = public
as $function$
declare v_m public.vendor_portal_memberships;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);

  if coalesce((v_m.exposure->>'pos')::boolean, false) is not true then
    raise exception 'vendor_portal_pos_not_exposed' using errcode = '42501';
  end if;

  return query
  select po.id,
         po.po_number,
         po.status::text,
         po.currency_code,
         po.issued_at,
         po.required_by_date,
         po.total_amount,
         coalesce(po.lines, '[]'::jsonb)
  from public.purchase_orders po
  where po.vendor_id = p_vendor_id
    and po.company_id = v_m.company_id
    and po.status::text in ('issued','partially_received','received','closed')
  order by po.issued_at desc nulls last, po.created_at desc;
end $function$;

-- 2) My memberships (vendor-side picker)
create or replace function public.vendor_portal_my_memberships()
returns table (
  id uuid,
  vendor_id uuid,
  vendor_name text,
  company_id uuid,
  company_name text,
  logo_url text,
  status text,
  exposure jsonb,
  expires_at timestamptz,
  last_seen_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $function$
  select m.id,
         m.vendor_id,
         v.name,
         m.company_id,
         c.name,
         b.logo_url,
         m.status::text,
         m.exposure,
         m.expires_at,
         m.last_seen_at,
         m.accepted_at
  from public.vendor_portal_memberships m
  left join public.vendors v on v.id = m.vendor_id
  left join public.companies c on c.id = m.company_id
  left join public.company_branding b on b.company_id = m.company_id
  where m.user_id = auth.uid()
  order by m.last_seen_at desc nulls last, m.created_at desc;
$function$;

-- 3) Deliveries
create or replace function public.vendor_portal_get_deliveries(p_vendor_id uuid)
returns table (
  id uuid,
  reference text,
  status text,
  carrier text,
  expected_date date,
  delivered_at timestamptz,
  po_number text,
  notes text
)
language plpgsql
security definer
set search_path = public
as $function$
declare v_m public.vendor_portal_memberships;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'deliveries')::boolean, false) is not true then
    raise exception 'vendor_portal_deliveries_not_exposed' using errcode = '42501';
  end if;

  return query
  select d.id,
         d.reference,
         d.status::text,
         d.carrier,
         d.expected_date,
         d.delivered_at,
         po.po_number,
         d.notes
  from public.delivery_tracking d
  join public.purchase_orders po on po.id = d.purchase_order_id
  where po.vendor_id = p_vendor_id
    and d.company_id = v_m.company_id
  order by coalesce(d.delivered_at::date, d.expected_date) desc nulls last;
end $function$;

-- 4) Invoices
create or replace function public.vendor_portal_get_invoices(p_vendor_id uuid)
returns table (
  id uuid,
  invoice_number text,
  status text,
  currency_code text,
  amount numeric,
  paid_amount numeric,
  issue_date date,
  due_date date,
  paid_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare v_m public.vendor_portal_memberships;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'invoices')::boolean, false) is not true then
    raise exception 'vendor_portal_invoices_not_exposed' using errcode = '42501';
  end if;

  return query
  select i.id,
         i.invoice_number,
         i.status::text,
         i.currency_code,
         i.amount,
         i.paid_amount,
         i.issue_date,
         i.due_date,
         i.paid_at
  from public.invoices i
  where i.vendor_id = p_vendor_id
    and i.company_id = v_m.company_id
  order by i.issue_date desc nulls last, i.created_at desc;
end $function$;

-- 5) Documents shared with the vendor (metadata.vendor_id tagged)
create or replace function public.vendor_portal_get_documents(p_vendor_id uuid)
returns table (
  id uuid,
  title text,
  category text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  storage_path text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare v_m public.vendor_portal_memberships;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'documents')::boolean, false) is not true then
    raise exception 'vendor_portal_documents_not_exposed' using errcode = '42501';
  end if;

  return query
  select d.id,
         d.title,
         d.category::text,
         d.file_name,
         d.mime_type,
         d.file_size_bytes,
         d.storage_path,
         d.created_at
  from public.documents d
  where d.company_id = v_m.company_id
    and d.metadata->>'vendor_id' = p_vendor_id::text
  order by d.created_at desc;
end $function$;

-- 6) Accept invite: activate invited memberships for the caller's email
create or replace function public.vendor_portal_accept_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_uid uuid := auth.uid();
  v_count integer := 0;
  r record;
begin
  if v_uid is null or v_email = '' then
    return 0;
  end if;

  for r in
    update public.vendor_portal_memberships m
       set status = 'active',
           user_id = v_uid,
           accepted_at = now(),
           updated_at = now()
     where lower(m.email) = v_email
       and m.status::text = 'invited'
    returning m.id, m.company_id, m.vendor_id
  loop
    v_count := v_count + 1;
    insert into public.vendor_portal_events
      (company_id, actor_type, actor_id, membership_id, vendor_id, event, metadata)
    values
      (r.company_id, 'vendor', v_uid, r.id, r.vendor_id, 'vendor_portal.member_accepted',
       jsonb_build_object('email', v_email));
    perform public.write_audit_log(
      'vendor_portal.member_accepted',
      'vendor_portal_memberships',
      r.id,
      jsonb_build_object('vendor_id', r.vendor_id, 'company_id', r.company_id, 'email', v_email)
    );
  end loop;

  return v_count;
end $function$;

revoke all on function public.vendor_portal_my_memberships() from public, anon;
revoke all on function public.vendor_portal_get_deliveries(uuid) from public, anon;
revoke all on function public.vendor_portal_get_invoices(uuid) from public, anon;
revoke all on function public.vendor_portal_get_documents(uuid) from public, anon;
revoke all on function public.vendor_portal_accept_invites() from public, anon;
revoke all on function public.vendor_portal_get_pos(uuid) from public, anon;

grant execute on function public.vendor_portal_my_memberships() to authenticated, service_role;
grant execute on function public.vendor_portal_get_deliveries(uuid) to authenticated, service_role;
grant execute on function public.vendor_portal_get_invoices(uuid) to authenticated, service_role;
grant execute on function public.vendor_portal_get_documents(uuid) to authenticated, service_role;
grant execute on function public.vendor_portal_accept_invites() to authenticated, service_role;
grant execute on function public.vendor_portal_get_pos(uuid) to authenticated, service_role;