-- FX-02 — Durable FX import audit trail + feed health alert configuration.

-- 1. Extend the run log -------------------------------------------------
ALTER TABLE public.fx_import_runs
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS base_currency text,
  ADD COLUMN IF NOT EXISTS requested_currencies text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actor_kind text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.fx_import_runs
  DROP CONSTRAINT IF EXISTS fx_import_runs_actor_kind_chk;
ALTER TABLE public.fx_import_runs
  ADD CONSTRAINT fx_import_runs_actor_kind_chk
  CHECK (actor_kind IN ('user', 'cron', 'system'));

ALTER TABLE public.fx_import_runs
  DROP CONSTRAINT IF EXISTS fx_import_runs_status_chk;
ALTER TABLE public.fx_import_runs
  ADD CONSTRAINT fx_import_runs_status_chk
  CHECK (status IN ('running', 'success', 'failed', 'skipped'));

CREATE INDEX IF NOT EXISTS fx_import_runs_started_idx
  ON public.fx_import_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS fx_import_runs_status_started_idx
  ON public.fx_import_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS fx_import_runs_company_started_idx
  ON public.fx_import_runs (company_id, started_at DESC);

-- Read is finance/admin only; writes stay service-role.
DROP POLICY IF EXISTS fx_import_runs_read ON public.fx_import_runs;
CREATE POLICY fx_import_runs_read ON public.fx_import_runs
  FOR SELECT TO authenticated
  USING (
    public.has_company_role('finance_admin'::app_role)
    OR public.has_company_role('company_admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

-- 2. Per-organization alert settings ------------------------------------
CREATE TABLE IF NOT EXISTS public.fx_alert_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  notify_role app_role NOT NULL DEFAULT 'finance_admin'::app_role,
  failure_threshold integer NOT NULL DEFAULT 1,
  stale_business_days integer NOT NULL DEFAULT 3,
  alert_missing_currency boolean NOT NULL DEFAULT true,
  large_move_pct numeric(6,3),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_alert_settings_failure_threshold_chk CHECK (failure_threshold BETWEEN 1 AND 20),
  CONSTRAINT fx_alert_settings_stale_days_chk CHECK (stale_business_days BETWEEN 1 AND 30),
  CONSTRAINT fx_alert_settings_large_move_chk CHECK (large_move_pct IS NULL OR (large_move_pct > 0 AND large_move_pct <= 100))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_alert_settings TO authenticated;
GRANT ALL ON public.fx_alert_settings TO service_role;
ALTER TABLE public.fx_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY fx_alert_settings_read ON public.fx_alert_settings
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

CREATE POLICY fx_alert_settings_write ON public.fx_alert_settings
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

CREATE TRIGGER fx_alert_settings_set_updated_at
  BEFORE UPDATE ON public.fx_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Health state (notification de-duplication) -------------------------
CREATE TABLE IF NOT EXISTS public.fx_health_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'never_synced',
  consecutive_failures integer NOT NULL DEFAULT 0,
  last_notified_status text,
  last_notified_at timestamptz,
  last_run_id uuid REFERENCES public.fx_import_runs(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_health_state_status_chk CHECK (status IN ('healthy', 'degraded', 'failed', 'never_synced'))
);

GRANT SELECT ON public.fx_health_state TO authenticated;
GRANT ALL ON public.fx_health_state TO service_role;
ALTER TABLE public.fx_health_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY fx_health_state_read ON public.fx_health_state
  FOR SELECT TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

CREATE TRIGGER fx_health_state_set_updated_at
  BEFORE UPDATE ON public.fx_health_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
