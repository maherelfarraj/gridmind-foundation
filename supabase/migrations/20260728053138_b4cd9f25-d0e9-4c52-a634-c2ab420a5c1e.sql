DO $$
DECLARE t text; p text;
BEGIN
  FOR t, p IN
    SELECT * FROM (VALUES
      ('project_bess_config','project_bess_config_write'),
      ('project_cybersecurity_config','project_cybersecurity_config_write'),
      ('project_departments','project_departments_admin'),
      ('project_financial_config','project_financial_config_write'),
      ('project_pv_config','project_pv_config_write'),
      ('project_pvsyst_config','project_pvsyst_config_write'),
      ('project_scada_config','project_scada_config_write'),
      ('project_sld_config','project_sld_config_write'),
      ('project_substation_config','project_substation_config_write'),
      ('project_templates','project_templates_write'),
      ('project_yield_config','project_yield_config_write')
    ) v(t,p)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=p) THEN
      EXECUTE format(
        'ALTER POLICY %I ON public.%I USING (public.is_company_member(company_id) AND (%s)) WITH CHECK (public.is_company_member(company_id) AND (%s))',
        p, t,
        (SELECT qual FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=p),
        (SELECT coalesce(with_check, qual) FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=p)
      );
    END IF;
  END LOOP;
END $$;