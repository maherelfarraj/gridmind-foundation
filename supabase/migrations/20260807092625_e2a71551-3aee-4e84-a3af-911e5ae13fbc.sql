-- GC-05: fix forecast_version_lines company-scope self-comparison bug.
DROP POLICY IF EXISTS fvl_insert ON public.forecast_version_lines;
DROP POLICY IF EXISTS fvl_delete ON public.forecast_version_lines;

CREATE POLICY fvl_insert ON public.forecast_version_lines
FOR INSERT TO authenticated
WITH CHECK (
  is_company_member(company_id)
  AND (
    has_company_role('finance_admin'::app_role)
    OR has_company_role('project_admin'::app_role)
    OR has_company_role('company_admin'::app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.forecast_versions v
    WHERE v.id = forecast_version_lines.version_id
      AND v.company_id = forecast_version_lines.company_id
      AND v.status = 'working'::forecast_version_status
  )
);

CREATE POLICY fvl_delete ON public.forecast_version_lines
FOR DELETE TO authenticated
USING (
  is_company_member(company_id)
  AND (
    has_company_role('finance_admin'::app_role)
    OR has_company_role('project_admin'::app_role)
    OR has_company_role('company_admin'::app_role)
  )
  AND EXISTS (
    SELECT 1 FROM public.forecast_versions v
    WHERE v.id = forecast_version_lines.version_id
      AND v.company_id = forecast_version_lines.company_id
      AND v.status = 'working'::forecast_version_status
  )
);