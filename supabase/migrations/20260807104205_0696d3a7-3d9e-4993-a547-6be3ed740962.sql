-- Undo the sandbox_exec EXECUTE workaround.
--
-- The platform's restricted exec role intentionally cannot execute database
-- routines and its privileges are reset outside migrations, so any grant to it
-- is both non-persistent and the wrong fix. Written idempotently against exact
-- signatures so a replay on a fresh database converges to the same state.
DO $$
DECLARE
  sig text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    RETURN;
  END IF;
  FOR sig IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.oid::regprocedure::text IN (
         'document_history(uuid)',
         'document_current_in_lineage(uuid)',
         'issue_controlled_copy(uuid,uuid,uuid,text,text,text,date)'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM sandbox_exec', sig);
  END LOOP;
END $$;