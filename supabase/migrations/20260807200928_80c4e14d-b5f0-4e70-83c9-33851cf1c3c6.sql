REVOKE ALL ON public.recognition_settings, public.recognition_obligations, public.recognition_snapshots, public.recognition_snapshot_lines, public.recognition_exceptions, public.recognition_adjustments, public.recognition_events FROM anon, PUBLIC, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_obligations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_snapshots TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_snapshot_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_exceptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognition_adjustments TO authenticated;
GRANT SELECT, INSERT ON public.recognition_events TO authenticated;

GRANT ALL ON public.recognition_settings, public.recognition_obligations, public.recognition_snapshots, public.recognition_snapshot_lines, public.recognition_exceptions, public.recognition_adjustments, public.recognition_events TO service_role;

REVOKE ALL ON FUNCTION public.recognition_snapshots_guard() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.recognition_adjustments_guard() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.recognition_events_append_only() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.recognition_lines_frozen_guard() FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.recognition_obligations_version() FROM anon, authenticated, PUBLIC;