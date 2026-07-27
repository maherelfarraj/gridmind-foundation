-- 0090_vendor_portal_po_ack.sql — PO acknowledgment. Idempotent.
alter table public.purchase_orders add column if not exists acknowledged_at timestamptz;
alter table public.purchase_orders add column if not exists acknowledged_by_email text;
alter table public.purchase_orders add column if not exists acknowledgment_note text;
alter table public.purchase_orders add column if not exists acknowledgment_status text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'purchase_orders_ack_status_check') then
    alter table public.purchase_orders add constraint purchase_orders_ack_status_check
      check (acknowledgment_status is null or acknowledgment_status in
        ('accepted','accepted_with_comments','rejected'));
  end if;
end $$;

-- Return type changes from TABLE to jsonb, so the old signature must be dropped.
drop function if exists public.vendor_portal_get_pos(uuid);

create or replace function public.vendor_portal_get_pos(p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_m public.vendor_portal_memberships%rowtype;
  v_out jsonb := '[]'::jsonb;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if coalesce((v_m.exposure->>'pos')::boolean, false) is not true then
    raise exception 'vendor_portal_pos_not_exposed' using errcode = '42501';
  end if;

  if to_regclass('public.purchase_orders') is not null then
    execute $q$select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select id, po_number, status::text as status, lines, currency_code,
             total_amount, required_by_date, delivery_address, issued_at,
             acknowledged_at, acknowledgment_status, acknowledgment_note,
             acknowledged_by_email
        from public.purchase_orders
       where company_id = $1 and vendor_id = $2
         and status::text in ('issued','partially_received','received','closed')
       order by issued_at desc nulls last limit 200) t$q$
    into v_out using v_m.company_id, p_vendor_id;
  end if;

  perform public.vendor_portal_write_event(p_vendor_id, 'vendor_portal.pos_viewed',
    '{}'::jsonb, null, null);
  return v_out;
end $function$;

revoke all on function public.vendor_portal_get_pos(uuid) from public, anon;
grant execute on function public.vendor_portal_get_pos(uuid) to authenticated, service_role;

create or replace function public.vendor_portal_acknowledge_po(
  p_po_id uuid, p_decision text, p_comment text default null
) returns void language plpgsql security definer set search_path = public as $function$
declare
  v_po public.purchase_orders%rowtype;
  v_m public.vendor_portal_memberships%rowtype;
begin
  if p_decision not in ('accepted','accepted_with_comments','rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision in ('accepted_with_comments','rejected')
     and (p_comment is null or btrim(p_comment) = '') then
    raise exception 'comment_required' using errcode = '22023';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then raise exception 'po_not_found' using errcode = 'P0002'; end if;

  v_m := public.vendor_portal_assert_access(v_po.vendor_id);   -- guards vendor scope + company
  if coalesce((v_m.exposure->>'pos')::boolean, false) is not true then
    raise exception 'vendor_portal_pos_not_exposed' using errcode = '42501';
  end if;
  if v_m.company_id <> v_po.company_id then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;
  if v_po.status::text not in ('issued','partially_received') then
    raise exception 'po_not_acknowledgeable' using errcode = '22023';
  end if;

  update public.purchase_orders
     set acknowledged_at = now(), acknowledged_by_email = v_m.email,
         acknowledgment_note = p_comment, acknowledgment_status = p_decision
   where id = p_po_id;

  perform public.vendor_portal_write_event(v_po.vendor_id, 'vendor_portal.po_acknowledged',
    jsonb_build_object('po_id', p_po_id, 'po_number', v_po.po_number, 'decision', p_decision),
    null, null);

  if to_regclass('public.notifications') is not null then
    insert into public.notifications (company_id, user_id, type, title, body, link, metadata)
    select v_po.company_id, ur.user_id, 'vendor_portal',
           'Vendor acknowledged ' || v_po.po_number || ': ' || replace(p_decision, '_', ' '),
           coalesce(p_comment, ''),
           '/procurement/pos/' || p_po_id::text,
           jsonb_build_object('po_id', p_po_id, 'decision', p_decision)
      from public.user_roles ur
     where ur.company_id = v_po.company_id
       and ur.role::text in ('procurement_admin','procurement_officer')
    on conflict do nothing;
  end if;

  perform public.write_audit_log('vendor_portal.po_acknowledged', 'purchase_orders', p_po_id,
    jsonb_build_object('decision', p_decision, 'vendor_id', v_po.vendor_id, 'by', v_m.email));
end $function$;

revoke all on function public.vendor_portal_acknowledge_po(uuid, text, text) from public, anon;
grant execute on function public.vendor_portal_acknowledge_po(uuid, text, text) to authenticated, service_role;