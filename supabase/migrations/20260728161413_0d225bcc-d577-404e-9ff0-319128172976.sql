REVOKE EXECUTE ON FUNCTION public.settle_derived_entity(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sld_apply_status(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.leave_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_derived_entity(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sld_apply_status(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_decide(uuid, text, text) TO authenticated;