DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.drawing_register_derived_lock(uuid, uuid, public.drawing_status)',
    'public.drawing_register_derive_status()',
    'public.drawing_revisions_sync_register()',
    'public.ifc_releases_sync_register()',
    'public.sld_drawings_guard_status()',
    'public.drawing_register_sync_sld()',
    'public.timesheets_guard_status()',
    'public.approval_instances_sync_timesheet()',
    'public.leave_requests_guard_status()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;