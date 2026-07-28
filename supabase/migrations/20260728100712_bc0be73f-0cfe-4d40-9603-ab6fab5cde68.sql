-- Bucket 1: company-scope role-based write policies (cross-tenant hole class)

DROP POLICY IF EXISTS chain_steps_write ON public.approval_chain_steps;
CREATE POLICY chain_steps_write ON public.approval_chain_steps
  FOR ALL TO authenticated
  USING (is_company_member(company_id) AND has_company_role('company_admin'::app_role))
  WITH CHECK (is_company_member(company_id) AND has_company_role('company_admin'::app_role));

DROP POLICY IF EXISTS rules_write ON public.approval_rules;
CREATE POLICY rules_write ON public.approval_rules
  FOR ALL TO authenticated
  USING (is_company_member(company_id) AND has_company_role('company_admin'::app_role))
  WITH CHECK (is_company_member(company_id) AND has_company_role('company_admin'::app_role));

DROP POLICY IF EXISTS "admins write branding" ON public.company_branding;
CREATE POLICY "admins write branding" ON public.company_branding
  FOR ALL TO authenticated
  USING (is_company_member(company_id) AND has_company_role('company_admin'::app_role))
  WITH CHECK (is_company_member(company_id) AND has_company_role('company_admin'::app_role));

DROP POLICY IF EXISTS instances_update ON public.approval_instances;
CREATE POLICY instances_update ON public.approval_instances
  FOR UPDATE TO authenticated
  USING (
    (
      (requested_by = auth.uid())
      OR (
        is_company_member(company_id)
        AND (has_company_role('company_admin'::app_role) OR has_company_role('project_admin'::app_role))
      )
    )
    AND (NOT is_external_viewer())
  );

DROP POLICY IF EXISTS document_markups_update ON public.document_markups;
CREATE POLICY document_markups_update ON public.document_markups
  FOR UPDATE TO authenticated
  USING (
    (reviewer_id = auth.uid())
    OR (is_company_member(company_id) AND has_company_role('engineering_admin'::app_role))
  )
  WITH CHECK (
    (reviewer_id = auth.uid())
    OR (is_company_member(company_id) AND has_company_role('engineering_admin'::app_role))
  );