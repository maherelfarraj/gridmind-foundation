-- 1. search_path hardening
ALTER FUNCTION public.compute_next_run(text, integer, integer, integer, timestamptz) SET search_path = public;
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- 2. approval_instances select policy self-join bug
DROP POLICY IF EXISTS instances_select ON public.approval_instances;
CREATE POLICY instances_select ON public.approval_instances
FOR SELECT USING (
  public.is_company_member(company_id)
  AND (
    (NOT public.is_external_viewer())
    OR requested_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.approvals a
      WHERE a.instance_id = approval_instances.id
        AND a.approver_id = auth.uid()
    )
  )
);

-- 3. has_company_role: no JWT app_metadata fallback
CREATE OR REPLACE FUNCTION public.has_company_role(p_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = p_role
      and ur.company_id = p.company_id
  );
$$;

-- 4. webhook_endpoint_secrets: explicit least-privilege
REVOKE ALL ON public.webhook_endpoint_secrets FROM anon, authenticated;
GRANT ALL ON public.webhook_endpoint_secrets TO service_role;
ALTER TABLE public.webhook_endpoint_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_endpoint_secrets_service_only ON public.webhook_endpoint_secrets;
CREATE POLICY webhook_endpoint_secrets_service_only
ON public.webhook_endpoint_secrets FOR ALL TO service_role
USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS webhook_endpoint_secrets_no_client_access ON public.webhook_endpoint_secrets;
CREATE POLICY webhook_endpoint_secrets_no_client_access
ON public.webhook_endpoint_secrets FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);

-- 5. EXECUTE privilege hardening on SECURITY DEFINER / helper functions
DO $do$
DECLARE
  r record;
  internal_only text[] := ARRAY[
    '_portal_log','audit_approval_changes','audit_drawing_revision_status',
    'audit_project_transition','enforce_audit_log_retention','escalate_overdue_approvals',
    'list_storage_buckets_status','list_storage_object_policies','verify_api_key',
    'proposals_guard_immutable','proposals_enforce_pricing_lock',
    'set_updated_at','update_updated_at_column'
  ];
  public_ok text[] := ARRAY['resolve_share_link','consume_rate_limit','get_po_by_share_token'];
  authed_ok text[] := ARRAY[
    'assert_can_grant_role','assert_export_unlocked','approve_change_order',
    'cancel_approval_instance','create_invite','decide_approval','has_company_role',
    'has_module_access','has_role','incorporate_change_order','is_company_admin',
    'is_company_member','is_export_locked','is_external_viewer','portal_assert_access',
    'portal_decide_approval','portal_get_feed','portal_raise_ticket','redeem_invite',
    'start_approval_instance','storage_company_id','sync_export_locks','write_audit_log',
    'compute_next_run'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(internal_only || public_ok || authed_ok)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    IF r.proname = ANY(public_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    ELSIF r.proname = ANY(authed_ok) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;
  END LOOP;
END
$do$;