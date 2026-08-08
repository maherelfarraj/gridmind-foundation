-- GC-17 Governed Risk & Contingency Drawdown

-- 1. Quantification enrichment ------------------------------------------------
ALTER TABLE public.risk_quantifications
  ADD COLUMN IF NOT EXISTS distribution_kind text NOT NULL DEFAULT 'triangular',
  ADD COLUMN IF NOT EXISTS dist_sigma numeric(18,6),
  ADD COLUMN IF NOT EXISTS discrete_points jsonb,
  ADD COLUMN IF NOT EXISTS correlation_group text,
  ADD COLUMN IF NOT EXISTS schedule_days_low integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_days_high integer NOT NULL DEFAULT 0;

ALTER TABLE public.risk_quantifications
  DROP CONSTRAINT IF EXISTS risk_quantifications_distribution_kind_check;
ALTER TABLE public.risk_quantifications
  ADD CONSTRAINT risk_quantifications_distribution_kind_check
  CHECK (distribution_kind IN ('triangular','pert','uniform','normal','lognormal','discrete'));

ALTER TABLE public.risk_quantifications
  DROP CONSTRAINT IF EXISTS risk_quantifications_schedule_range_check;
ALTER TABLE public.risk_quantifications
  ADD CONSTRAINT risk_quantifications_schedule_range_check
  CHECK (schedule_days_low >= 0 AND schedule_days_high >= schedule_days_low);

CREATE INDEX IF NOT EXISTS risk_quantifications_corr_idx
  ON public.risk_quantifications (project_id, correlation_group);

-- 2. Register governance attributes -------------------------------------------
ALTER TABLE public.risks
  ADD COLUMN IF NOT EXISTS response_strategy text,
  ADD COLUMN IF NOT EXISTS trigger_condition text,
  ADD COLUMN IF NOT EXISTS proximity text,
  ADD COLUMN IF NOT EXISTS review_cadence_days integer,
  ADD COLUMN IF NOT EXISTS next_review_date date,
  ADD COLUMN IF NOT EXISTS residual_probability integer,
  ADD COLUMN IF NOT EXISTS residual_impact integer,
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;

ALTER TABLE public.risks DROP CONSTRAINT IF EXISTS risks_response_strategy_check;
ALTER TABLE public.risks ADD CONSTRAINT risks_response_strategy_check
  CHECK (response_strategy IS NULL OR response_strategy IN ('avoid','transfer','mitigate','accept','exploit','enhance','share'));

ALTER TABLE public.risks DROP CONSTRAINT IF EXISTS risks_proximity_check;
ALTER TABLE public.risks ADD CONSTRAINT risks_proximity_check
  CHECK (proximity IS NULL OR proximity IN ('imminent','near','mid','far'));

ALTER TABLE public.risks DROP CONSTRAINT IF EXISTS risks_residual_check;
ALTER TABLE public.risks ADD CONSTRAINT risks_residual_check
  CHECK ((residual_probability IS NULL OR (residual_probability BETWEEN 1 AND 5))
     AND (residual_impact IS NULL OR (residual_impact BETWEEN 1 AND 5)));

-- 3. Management reserve on contingency pools ----------------------------------
ALTER TABLE public.contingency_pools
  ADD COLUMN IF NOT EXISTS is_management_reserve boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reserve_expires_on date;

-- 4. Simulation runs -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_sim_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'joint',
  status text NOT NULL DEFAULT 'draft',
  seed bigint NOT NULL,
  iterations integer NOT NULL,
  engine text NOT NULL DEFAULT 'gridmind-mc',
  engine_version text NOT NULL DEFAULT '1.0.0',
  input_checksum text NOT NULL,
  reporting_currency text NOT NULL REFERENCES public.currencies(code),
  fx_rate_date date,
  fx_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumptions text,
  exclusions text,
  inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  row_version integer NOT NULL DEFAULT 1,
  superseded_by uuid REFERENCES public.risk_sim_runs(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_sim_runs_scope_check CHECK (scope IN ('cost','schedule','joint')),
  CONSTRAINT risk_sim_runs_status_check CHECK (status IN ('draft','approved','superseded','rejected')),
  CONSTRAINT risk_sim_runs_iterations_check CHECK (iterations BETWEEN 1000 AND 200000),
  CONSTRAINT risk_sim_runs_seed_check CHECK (seed >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_sim_runs_idem_idx
  ON public.risk_sim_runs (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS risk_sim_runs_project_idx
  ON public.risk_sim_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_sim_runs_company_status_idx
  ON public.risk_sim_runs (company_id, status);

GRANT SELECT, INSERT, UPDATE ON public.risk_sim_runs TO authenticated;
GRANT ALL ON public.risk_sim_runs TO service_role;
ALTER TABLE public.risk_sim_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_sim_runs_select" ON public.risk_sim_runs
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

CREATE POLICY "risk_sim_runs_insert" ON public.risk_sim_runs
  FOR INSERT TO authenticated WITH CHECK (
    public.is_company_member(company_id) AND (
      public.has_company_role('project_admin'::app_role)
      OR public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

CREATE POLICY "risk_sim_runs_update" ON public.risk_sim_runs
  FOR UPDATE TO authenticated USING (
    public.is_company_member(company_id) AND (
      public.has_company_role('project_admin'::app_role)
      OR public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  ) WITH CHECK (
    public.is_company_member(company_id) AND (
      public.has_company_role('project_admin'::app_role)
      OR public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

CREATE OR REPLACE FUNCTION public.risk_sim_runs_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('approved','superseded') THEN
      -- only supersession bookkeeping may touch a frozen run
      IF NEW.status IS DISTINCT FROM 'superseded'
         OR NEW.results::text IS DISTINCT FROM OLD.results::text
         OR NEW.inputs::text IS DISTINCT FROM OLD.inputs::text
         OR NEW.seed IS DISTINCT FROM OLD.seed
         OR NEW.iterations IS DISTINCT FROM OLD.iterations
         OR NEW.input_checksum IS DISTINCT FROM OLD.input_checksum THEN
        RAISE EXCEPTION 'risk_sim_run_frozen';
      END IF;
    END IF;
    NEW.row_version := OLD.row_version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS risk_sim_runs_guard_trg ON public.risk_sim_runs;
CREATE TRIGGER risk_sim_runs_guard_trg
  BEFORE UPDATE ON public.risk_sim_runs
  FOR EACH ROW EXECUTE FUNCTION public.risk_sim_runs_guard();

-- 5. Append-only event history --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_contingency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_contingency_events_entity_check
    CHECK (entity_type IN ('risk','quantification','pool','movement','sim_run','alert'))
);

CREATE INDEX IF NOT EXISTS risk_contingency_events_entity_idx
  ON public.risk_contingency_events (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS risk_contingency_events_project_idx
  ON public.risk_contingency_events (project_id, created_at DESC);

GRANT SELECT, INSERT ON public.risk_contingency_events TO authenticated;
GRANT ALL ON public.risk_contingency_events TO service_role;
ALTER TABLE public.risk_contingency_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_contingency_events_select" ON public.risk_contingency_events
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));
CREATE POLICY "risk_contingency_events_insert" ON public.risk_contingency_events
  FOR INSERT TO authenticated WITH CHECK (public.is_company_member(company_id));

CREATE OR REPLACE FUNCTION public.risk_contingency_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'risk_contingency_events_append_only';
END;
$$;

DROP TRIGGER IF EXISTS risk_contingency_events_append_only_trg ON public.risk_contingency_events;
CREATE TRIGGER risk_contingency_events_append_only_trg
  BEFORE UPDATE OR DELETE ON public.risk_contingency_events
  FOR EACH ROW EXECUTE FUNCTION public.risk_contingency_events_append_only();

-- 6. Alerts ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.risk_contingency_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  family text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  status text NOT NULL DEFAULT 'open',
  dedupe_key text NOT NULL,
  title text NOT NULL,
  detail text,
  owner_id uuid REFERENCES public.profiles(id),
  due_date date,
  evidence_entity_type text,
  evidence_entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid REFERENCES public.profiles(id),
  acknowledged_at timestamptz,
  snoozed_until date,
  resolved_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT risk_contingency_alerts_severity_check CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT risk_contingency_alerts_status_check CHECK (status IN ('open','acknowledged','snoozed','resolved')),
  CONSTRAINT risk_contingency_alerts_family_check CHECK (family IN (
    'high_exposure','probability_impact_increase','new_top_contributor','p80_budget_breach',
    'p90_schedule_breach','contingency_inadequacy','burn_rate_spike','unlinked_drawdown',
    'overdue_mitigation','stale_simulation','input_quality','fx_materiality',
    'double_count','funding_mismatch','reserve_expiry','sod_exception'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS risk_contingency_alerts_dedupe_idx
  ON public.risk_contingency_alerts (company_id, dedupe_key);
CREATE INDEX IF NOT EXISTS risk_contingency_alerts_project_idx
  ON public.risk_contingency_alerts (project_id, status, severity);

GRANT SELECT, INSERT, UPDATE ON public.risk_contingency_alerts TO authenticated;
GRANT ALL ON public.risk_contingency_alerts TO service_role;
ALTER TABLE public.risk_contingency_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "risk_contingency_alerts_select" ON public.risk_contingency_alerts
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));
CREATE POLICY "risk_contingency_alerts_insert" ON public.risk_contingency_alerts
  FOR INSERT TO authenticated WITH CHECK (
    public.is_company_member(company_id) AND (
      public.has_company_role('project_admin'::app_role)
      OR public.has_company_role('finance_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );
CREATE POLICY "risk_contingency_alerts_update" ON public.risk_contingency_alerts
  FOR UPDATE TO authenticated USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP TRIGGER IF EXISTS set_updated_at_risk_contingency_alerts ON public.risk_contingency_alerts;
CREATE TRIGGER set_updated_at_risk_contingency_alerts
  BEFORE UPDATE ON public.risk_contingency_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.risk_sim_runs FROM anon;
REVOKE ALL ON public.risk_contingency_events FROM anon;
REVOKE ALL ON public.risk_contingency_alerts FROM anon;