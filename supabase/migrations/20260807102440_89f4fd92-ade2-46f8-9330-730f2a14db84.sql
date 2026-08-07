-- GC-07c — fix tautological self-join in the evidence INSERT policy.
DROP POLICY IF EXISTS costing_checklist_evidence_insert ON public.costing_checklist_evidence;

CREATE POLICY costing_checklist_evidence_insert
  ON public.costing_checklist_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    is_company_member(company_id)
    AND EXISTS (
      SELECT 1 FROM public.costing_checklist_items i
       WHERE i.id = costing_checklist_evidence.item_id
         AND i.company_id = costing_checklist_evidence.company_id
         AND i.project_id = costing_checklist_evidence.project_id
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
       WHERE d.id = costing_checklist_evidence.document_id
         AND d.company_id = costing_checklist_evidence.company_id
         AND d.project_id = costing_checklist_evidence.project_id
    )
  );