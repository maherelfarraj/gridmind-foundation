CREATE OR REPLACE FUNCTION public.fixture_purge_tenants(p_company_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ids uuid[];
  r record;
  v_pass int;
  v_deleted int;
  v_gsi uuid;
BEGIN
  IF p_company_ids IS NULL OR array_length(p_company_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Protected tenants can never be purged by this routine.
  SELECT array_agg(id) INTO v_ids
  FROM public.companies
  WHERE id = ANY (p_company_ids)
    AND slug NOT IN ('gsi', 'sandbox');

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_pass IN 1..8 LOOP
    FOR r IN
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'company_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name <> 'companies'
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE company_id = ANY($1)', r.table_name) USING v_ids;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END LOOP;

    BEGIN
      DELETE FROM public.companies WHERE id = ANY (v_ids);
      EXIT;
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END LOOP;

  SELECT count(*) INTO v_deleted
  FROM unnest(v_ids) AS x(id)
  WHERE NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = x.id);

  SELECT id INTO v_gsi FROM public.companies WHERE slug = 'gsi';
  IF v_gsi IS NOT NULL AND v_deleted > 0 THEN
    INSERT INTO public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    VALUES (
      v_gsi, NULL, 'ops.fixture_purge', 'companies', NULL,
      jsonb_build_object(
        'source', 'test_suite_teardown',
        'requested', array_length(p_company_ids, 1),
        'tenants_deleted', v_deleted
      )
    );
  END IF;

  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fixture_purge_tenants(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_purge_tenants(uuid[]) TO service_role;