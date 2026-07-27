CREATE SCHEMA IF NOT EXISTS admin;

CREATE OR REPLACE FUNCTION admin.fixture_purge(p_keep_slugs text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, admin, pg_temp
AS $fn$
DECLARE
  v_ids uuid[];
  r record;
  v_pass int;
  v_deleted int;
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.companies WHERE slug <> ALL (p_keep_slugs);
  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
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

  RETURN v_deleted;
END;
$fn$;

REVOKE ALL ON FUNCTION admin.fixture_purge(text[]) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  v_before int;
  v_deleted int;
  v_after int;
  v_gsi uuid;
BEGIN
  SELECT count(*) INTO v_before FROM public.companies;
  SELECT admin.fixture_purge(ARRAY['gsi','sandbox']) INTO v_deleted;
  SELECT count(*) INTO v_after FROM public.companies;
  SELECT id INTO v_gsi FROM public.companies WHERE slug = 'gsi';

  INSERT INTO public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  VALUES (
    v_gsi, NULL, 'ops.fixture_purge', 'companies', NULL,
    jsonb_build_object(
      'approved_by', 'owner',
      'kept', ARRAY['gsi','sandbox'],
      'tenants_before', v_before,
      'tenants_deleted', v_deleted,
      'tenants_after', v_after,
      'day', 'day7_finale'
    )
  );
END
$do$;

-- Probe teardown
DO $do$
BEGIN
  PERFORM cron.unschedule('cron-probe');
EXCEPTION WHEN others THEN
  NULL;
END
$do$;

DROP TABLE IF EXISTS public.cron_probe;