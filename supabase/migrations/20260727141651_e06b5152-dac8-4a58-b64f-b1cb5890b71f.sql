-- 0090 (continued) — P-224 vendor-proposed delivery windows
create or replace function public.vendor_portal_propose_delivery(
  p_po_id uuid, p_lines jsonb   -- [{line_no, proposed_date, proposed_qty?, note?}]
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_po public.purchase_orders%rowtype;
  v_m public.vendor_portal_memberships%rowtype;
  v_line jsonb; v_po_line jsonb; v_issue date; v_cnt int; v_n int := 0;
  v_note text;
begin
  select * into v_po from public.purchase_orders where id = p_po_id;
  if not found then raise exception 'po_not_found'; end if;

  v_m := public.vendor_portal_assert_access(v_po.vendor_id);
  if not coalesce((v_m.exposure->>'deliveries')::boolean, false) then
    raise exception 'deliveries_not_exposed';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'lines_required';
  end if;

  v_issue := coalesce(v_po.issued_at::date, v_po.created_at::date);

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'proposed_date') is null then raise exception 'proposed_date_required'; end if;
    if (v_line->>'line_no') is null then raise exception 'line_not_on_po'; end if;
    if (v_line->>'proposed_date')::date < v_issue then
      raise exception 'proposed_date_before_issue';
    end if;

    select l into v_po_line
      from jsonb_array_elements(coalesce(v_po.lines, '[]'::jsonb)) l
     where (l->>'line_no')::int = (v_line->>'line_no')::int
     limit 1;
    if v_po_line is null then raise exception 'line_not_on_po'; end if;

    v_note := 'Vendor-proposed' || coalesce(' — ' || nullif(trim(v_line->>'note'), ''), '');

    update public.expediting_logs
       set current_eta = (v_line->>'proposed_date')::date,
           eta_confirmed = false,
           last_vendor_contact_at = now(),
           notes = v_note,
           updated_at = now()
     where po_id = v_po.id and po_line_no = (v_line->>'line_no')::int;
    get diagnostics v_cnt = row_count;

    if v_cnt = 0 then
      insert into public.expediting_logs
        (company_id, po_id, project_id, po_line_no, item_description, site_need_date,
         current_eta, eta_confirmed, last_vendor_contact_at, notes, created_by)
      values
        (v_po.company_id, v_po.id, v_po.project_id, (v_line->>'line_no')::int,
         coalesce(nullif(v_po_line->>'description', ''), 'PO line ' || (v_line->>'line_no')),
         coalesce((v_po_line->>'site_need_date')::date, v_po.required_by_date,
                  (v_line->>'proposed_date')::date),
         (v_line->>'proposed_date')::date, false, now(), v_note, null);
    end if;

    v_n := v_n + 1;
  end loop;

  perform public.vendor_portal_write_event(
    p_vendor_id => v_po.vendor_id,
    p_event     => 'vendor_portal.delivery_proposed',
    p_metadata  => jsonb_build_object('po_id', p_po_id, 'po_number', v_po.po_number,
                                      'lines', p_lines, 'line_count', v_n),
    p_ip        => null,
    p_user_agent=> null,
    p_company_id=> v_po.company_id
  );

  if to_regclass('public.notifications') is not null then
    insert into public.notifications (company_id, user_id, type, title, body, link, metadata)
    select v_po.company_id, ur.user_id, 'expediting',
           'Vendor proposed delivery dates on ' || v_po.po_number,
           v_n || ' line(s) updated — review in expediting',
           '/procurement/expediting',
           jsonb_build_object('po_id', p_po_id, 'vendor_id', v_po.vendor_id)
      from public.user_roles ur
     where ur.company_id = v_po.company_id
       and ur.role::text in ('procurement_admin','procurement_officer')
    on conflict do nothing;
  end if;

  perform public.write_audit_log('vendor_portal.delivery_proposed', 'purchase_orders', p_po_id,
    jsonb_build_object('vendor_id', v_po.vendor_id, 'line_count', v_n));

  return v_n;
end $$;

revoke all on function public.vendor_portal_propose_delivery(uuid, jsonb) from public, anon;
grant execute on function public.vendor_portal_propose_delivery(uuid, jsonb) to authenticated;