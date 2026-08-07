-- GC-04 — hardening + next-open-period reversal references

-- 1. Reversal reference (original may live in a closed period)
ALTER TABLE public.cost_accruals
  ADD COLUMN IF NOT EXISTS reverses_accrual_id uuid
    REFERENCES public.cost_accruals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cost_accruals_reverses_idx
  ON public.cost_accruals (reverses_accrual_id)
  WHERE reverses_accrual_id IS NOT NULL;

-- A given accrual may be reversed at most once.
CREATE UNIQUE INDEX IF NOT EXISTS cost_accruals_reverses_unique_idx
  ON public.cost_accruals (reverses_accrual_id)
  WHERE reverses_accrual_id IS NOT NULL;

-- 2. Revoke inherited PUBLIC/anon privileges; grant explicitly.
REVOKE ALL ON public.cost_accruals            FROM anon, PUBLIC;
REVOKE ALL ON public.cost_forecast_periods    FROM anon, PUBLIC;
REVOKE ALL ON public.costing_settings         FROM anon, PUBLIC;
REVOKE ALL ON public.costing_periods          FROM anon, PUBLIC;
REVOKE ALL ON public.forecast_versions        FROM anon, PUBLIC;
REVOKE ALL ON public.forecast_version_lines   FROM anon, PUBLIC;

REVOKE ALL ON public.cost_accruals            FROM authenticated;
REVOKE ALL ON public.cost_forecast_periods    FROM authenticated;
REVOKE ALL ON public.costing_settings         FROM authenticated;
REVOKE ALL ON public.costing_periods          FROM authenticated;
REVOKE ALL ON public.forecast_versions        FROM authenticated;
REVOKE ALL ON public.forecast_version_lines   FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_accruals         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_forecast_periods TO authenticated;
-- Settings/periods/versions are lifecycle-managed: no DELETE.
GRANT SELECT, INSERT, UPDATE ON public.costing_settings       TO authenticated;
GRANT SELECT                 ON public.costing_periods        TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.forecast_versions      TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.forecast_version_lines TO authenticated;

GRANT ALL ON public.cost_accruals          TO service_role;
GRANT ALL ON public.cost_forecast_periods  TO service_role;
GRANT ALL ON public.costing_settings       TO service_role;
GRANT ALL ON public.costing_periods        TO service_role;
GRANT ALL ON public.forecast_versions      TO service_role;
GRANT ALL ON public.forecast_version_lines TO service_role;

-- 3. Reversal rows carry the original's locked FX; the period guard still
--    applies to the *reversal's own* period, which must be open.
COMMENT ON COLUMN public.cost_accruals.reverses_accrual_id IS
  'When the original accrual''s period is closed, the reversal is posted in the next open period and references the original here. FX is copied, never re-rated.';
