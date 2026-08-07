-- GC-06 — Full-suite remediation: document search-vector grant, FX import-run
-- tenancy scope, portfolio cash-drill index.

-- 1) document_register_tsv is a pure, non-SECURITY-DEFINER text builder used by
--    the generated tsvector column on document_register. Any role permitted to
--    INSERT the row must be able to evaluate it; RLS still governs the rows.
GRANT EXECUTE ON FUNCTION public.document_register_tsv(text, text, text[], text, text, text, text, jsonb) TO PUBLIC;

-- 2) fx_import_runs: replace the unscoped role-only SELECT policy with a
--    row-level company scope (closes the policy-lint R1/R2 finding).
DROP POLICY IF EXISTS fx_import_runs_read ON public.fx_import_runs;

CREATE POLICY fx_import_runs_read ON public.fx_import_runs
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)
      OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    )
  );

-- The feed itself is global: cron runs carry company_id = NULL and belong to no
-- tenant. Those rows are exposed only through this definer routine, which
-- applies the same finance/admin role gate and never leaks tenant-owned runs
-- from another organisation.
CREATE OR REPLACE FUNCTION public.fx_import_runs_recent(p_limit integer DEFAULT 25)
RETURNS SETOF public.fx_import_runs
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.*
    FROM public.fx_import_runs r
   WHERE (
           public.has_company_role('finance_admin'::public.app_role)
           OR public.has_company_role('company_admin'::public.app_role)
           OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
         )
     AND (r.company_id IS NULL OR public.is_company_member(r.company_id))
   ORDER BY r.started_at DESC, r.id DESC
   LIMIT greatest(1, least(coalesce(p_limit, 25), 200));
$$;

REVOKE ALL ON FUNCTION public.fx_import_runs_recent(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fx_import_runs_recent(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fx_import_runs_recent(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fx_import_runs_recent(integer) TO service_role;

-- 3) Portfolio month drill scans cash_flows by (company_id, period); the only
--    period index was project-leading, so the drill degraded to a seq scan and
--    hit the statement timeout under concurrent load.
CREATE INDEX IF NOT EXISTS cf_company_period_idx
  ON public.cash_flows (company_id, period);
