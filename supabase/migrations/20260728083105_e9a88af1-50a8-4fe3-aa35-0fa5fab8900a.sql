-- 1. document_markups insert: company-scoped external viewer check
DROP POLICY IF EXISTS "document_markups_insert" ON public.document_markups;
CREATE POLICY "document_markups_insert" ON public.document_markups
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    OR EXISTS (
      SELECT 1 FROM public.portal_memberships pm
      WHERE pm.company_id = document_markups.company_id
        AND pm.status = 'active'
        AND (
          pm.user_id = auth.uid()
          OR pm.email = ((auth.jwt() ->> 'email')::citext)
        )
    )
  );

-- 2. approval_instances select: restrict to authenticated role
DROP POLICY IF EXISTS "instances_select" ON public.approval_instances;
CREATE POLICY "instances_select" ON public.approval_instances
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      NOT public.is_external_viewer()
      OR requested_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.approvals a
        WHERE a.instance_id = approval_instances.id
          AND a.approver_id = auth.uid()
      )
    )
  );

-- 3. invites: remove email-matched self select (exposed role + token_hash).
-- Invite peek/redemption runs through SECURITY DEFINER RPCs and the
-- server-side admin client, so no client-side read path is needed.
DROP POLICY IF EXISTS "invites_self_select" ON public.invites;