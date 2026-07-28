REVOKE EXECUTE ON FUNCTION public.admin_get_db_health() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_slow_queries() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_table_sizes() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_no_open_hold_point(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cwp_block_forward_on_hold_point() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_ops_admin_for_company(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_gl_number(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_po_approval_rule() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_ops_updated_at() FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_get_db_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_slow_queries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_table_sizes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_no_open_hold_point(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ops_admin_for_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_gl_number(uuid, text) TO authenticated;

-- vendor_portal_events: reads for portal admins only, writes reserved for trusted server-side logic
REVOKE ALL ON TABLE public.vendor_portal_events FROM anon, authenticated, PUBLIC;
ALTER TABLE public.vendor_portal_events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.vendor_portal_events TO authenticated;
GRANT ALL ON TABLE public.vendor_portal_events TO service_role;

DROP POLICY IF EXISTS vendor_portal_events_no_client_insert ON public.vendor_portal_events;
CREATE POLICY vendor_portal_events_no_client_insert
  ON public.vendor_portal_events
  FOR INSERT TO authenticated, anon
  WITH CHECK (false);