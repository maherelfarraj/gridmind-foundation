-- GC-06c — CI/diagnostics role access to the controlled-copy routines.
-- They stay SECURITY DEFINER with anon/PUBLIC revoked; only the sandbox
-- harness role (already bypassrls) gains EXECUTE for live-schema probes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.issue_controlled_copy(uuid, uuid, uuid, text, text, text, date) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.recall_controlled_copy(uuid, text, text) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.controlled_copy_queue(boolean) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.controlled_copy_completeness(uuid) TO sandbox_exec';
  END IF;
END $$;
