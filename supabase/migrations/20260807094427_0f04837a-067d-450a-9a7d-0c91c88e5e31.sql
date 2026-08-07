-- GC-06b — CI/diagnostics role access to the read-only document lineage
-- lookups. These are SECURITY DEFINER and remain revoked from PUBLIC/anon; the
-- sandbox harness role runs the live-schema supersedure probes and needs
-- EXECUTE explicitly rather than through a PUBLIC grant.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.document_history(uuid) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.document_current_in_lineage(uuid) TO sandbox_exec';
  END IF;
END $$;
