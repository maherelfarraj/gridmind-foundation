create or replace function public.vendor_portal_get_line_etas(p_vendor_id uuid)
returns table (
  po_id uuid, po_line_no int, item_description text, site_need_date date,
  current_eta date, eta_confirmed boolean, status text, notes text, updated_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
declare v_m public.vendor_portal_memberships%rowtype;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);
  if not coalesce((v_m.exposure->>'deliveries')::boolean, false) then
    raise exception 'deliveries_not_exposed';
  end if;
  return query
    select e.po_id, e.po_line_no, e.item_description, e.site_need_date,
           e.current_eta, e.eta_confirmed, e.status::text, e.notes, e.updated_at
      from public.expediting_logs e
      join public.purchase_orders p on p.id = e.po_id
     where p.vendor_id = p_vendor_id
       and p.company_id = v_m.company_id;
end $$;

revoke all on function public.vendor_portal_get_line_etas(uuid) from public, anon;
grant execute on function public.vendor_portal_get_line_etas(uuid) to authenticated;