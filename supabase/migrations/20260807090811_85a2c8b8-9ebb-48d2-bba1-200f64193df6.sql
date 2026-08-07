GRANT DELETE ON public.forecast_version_lines TO authenticated;

CREATE POLICY fvl_delete ON public.forecast_version_lines FOR DELETE TO authenticated
  USING (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('project_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
    AND EXISTS (SELECT 1 FROM public.forecast_versions v
                WHERE v.id = version_id AND v.company_id = company_id AND v.status = 'working'));