-- GC-03 — Forecast versioning + costing period close controls.

-- ---------------------------------------------------------------- settings
CREATE TABLE IF NOT EXISTS public.costing_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL UNIQUE REFERENCES public.companies(id) ON DELETE CASCADE,
  reporting_timezone text NOT NULL DEFAULT 'UTC',
  materiality_abs numeric(18,2) NOT NULL DEFAULT 0 CHECK (materiality_abs >= 0),
  materiality_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (materiality_pct >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.costing_settings TO authenticated;
GRANT ALL ON public.costing_settings TO service_role;
ALTER TABLE public.costing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY costing_settings_select ON public.costing_settings FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY costing_settings_insert ON public.costing_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)));
CREATE POLICY costing_settings_update ON public.costing_settings FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)))
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)));

CREATE TRIGGER costing_settings_updated_at BEFORE UPDATE ON public.costing_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- periods
DO $$ BEGIN
  CREATE TYPE public.costing_period_state AS ENUM ('open', 'soft_locked', 'hard_closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.costing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  state public.costing_period_state NOT NULL DEFAULT 'open',
  row_version integer NOT NULL DEFAULT 1,
  reason text,
  soft_locked_by uuid,
  soft_locked_at timestamptz,
  hard_closed_by uuid,
  hard_closed_at timestamptz,
  reopened_by uuid,
  reopened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT costing_periods_month_start CHECK (date_trunc('month', period_month)::date = period_month)
);

CREATE UNIQUE INDEX IF NOT EXISTS costing_periods_company_month_uniq
  ON public.costing_periods (company_id, period_month) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS costing_periods_project_month_uniq
  ON public.costing_periods (project_id, period_month) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS costing_periods_lookup_idx
  ON public.costing_periods (company_id, period_month, state);

GRANT SELECT ON public.costing_periods TO authenticated;
GRANT ALL ON public.costing_periods TO service_role;
ALTER TABLE public.costing_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY costing_periods_select ON public.costing_periods FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE TRIGGER costing_periods_updated_at BEFORE UPDATE ON public.costing_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- --------------------------------------------------------- forecast versions
DO $$ BEGIN
  CREATE TYPE public.forecast_version_status AS ENUM ('working', 'submitted', 'approved', 'superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.forecast_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reporting_period date NOT NULL,
  version_no integer NOT NULL,
  status public.forecast_version_status NOT NULL DEFAULT 'working',
  row_version integer NOT NULL DEFAULT 1,
  base_currency_code text NOT NULL DEFAULT 'USD',
  label text,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_version_id uuid REFERENCES public.forecast_versions(id) ON DELETE SET NULL,
  superseded_by_id uuid REFERENCES public.forecast_versions(id) ON DELETE SET NULL,
  materiality_explanation text,
  replace_reason text,
  created_by uuid,
  submitted_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forecast_versions_period_month CHECK (date_trunc('month', reporting_period)::date = reporting_period),
  CONSTRAINT forecast_versions_version_no CHECK (version_no > 0),
  CONSTRAINT forecast_versions_unique UNIQUE (project_id, reporting_period, version_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS forecast_versions_one_approved
  ON public.forecast_versions (project_id, reporting_period) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS forecast_versions_lookup_idx
  ON public.forecast_versions (company_id, project_id, reporting_period DESC, status);

GRANT SELECT, INSERT, UPDATE ON public.forecast_versions TO authenticated;
GRANT ALL ON public.forecast_versions TO service_role;
ALTER TABLE public.forecast_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY forecast_versions_select ON public.forecast_versions FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY forecast_versions_insert ON public.forecast_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('project_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)));
CREATE POLICY forecast_versions_update ON public.forecast_versions FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('project_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)))
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('project_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role)));

CREATE TRIGGER forecast_versions_updated_at BEFORE UPDATE ON public.forecast_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.forecast_version_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.forecast_versions(id) ON DELETE CASCADE,
  cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL,
  cost_code_key text NOT NULL,
  cost_code text,
  cost_code_name text,
  currency_code text NOT NULL DEFAULT 'USD',
  base_currency_code text NOT NULL DEFAULT 'USD',
  fx_rate numeric(20,8) NOT NULL DEFAULT 1,
  fx_rate_date date,
  fx_source text NOT NULL DEFAULT 'parity',
  fx_override_reason text,
  etc_amount numeric(18,2) NOT NULL DEFAULT 0,
  etc_amount_base numeric(18,2) NOT NULL DEFAULT 0,
  budget_current numeric(18,2) NOT NULL DEFAULT 0,
  committed numeric(18,2) NOT NULL DEFAULT 0,
  actual numeric(18,2) NOT NULL DEFAULT 0,
  accruals numeric(18,2) NOT NULL DEFAULT 0,
  eac numeric(18,2) NOT NULL DEFAULT 0,
  vac numeric(18,2) NOT NULL DEFAULT 0,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forecast_version_lines_unique UNIQUE (version_id, cost_code_key)
);

CREATE INDEX IF NOT EXISTS forecast_version_lines_version_idx
  ON public.forecast_version_lines (version_id, cost_code_key);
CREATE INDEX IF NOT EXISTS forecast_version_lines_project_idx
  ON public.forecast_version_lines (project_id, cost_code_id);

GRANT SELECT, INSERT ON public.forecast_version_lines TO authenticated;
GRANT ALL ON public.forecast_version_lines TO service_role;
ALTER TABLE public.forecast_version_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY fvl_select ON public.forecast_version_lines FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY fvl_insert ON public.forecast_version_lines FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('project_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
    AND EXISTS (SELECT 1 FROM public.forecast_versions v
                WHERE v.id = version_id AND v.company_id = company_id AND v.status = 'working'));

-- ------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION public.forecast_version_lines_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status public.forecast_version_status;
BEGIN
  SELECT status INTO v_status FROM public.forecast_versions
   WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF v_status IS DISTINCT FROM 'working' THEN
    RAISE EXCEPTION 'forecast_snapshot_immutable: snapshot lines of a % version cannot be modified',
      COALESCE(v_status::text, 'missing');
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS forecast_version_lines_guard ON public.forecast_version_lines;
CREATE TRIGGER forecast_version_lines_guard
  BEFORE UPDATE OR DELETE ON public.forecast_version_lines
  FOR EACH ROW EXECUTE FUNCTION public.forecast_version_lines_guard();

CREATE OR REPLACE FUNCTION public.forecast_versions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'approved' THEN
    IF NEW.totals IS DISTINCT FROM OLD.totals
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.reporting_period IS DISTINCT FROM OLD.reporting_period
       OR NEW.base_currency_code IS DISTINCT FROM OLD.base_currency_code
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'forecast_snapshot_immutable: an approved forecast version cannot be re-rated or edited';
    END IF;
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'forecast_snapshot_immutable: a superseded version cannot be revived';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS forecast_versions_guard ON public.forecast_versions;
CREATE TRIGGER forecast_versions_guard
  BEFORE UPDATE ON public.forecast_versions
  FOR EACH ROW EXECUTE FUNCTION public.forecast_versions_guard();

-- ------------------------------------------------- period state + assertion
-- SECURITY DEFINER is required: enforcement must see period rows for callers
-- whose RLS visibility is narrower, and must not be bypassable client-side.
-- search_path is pinned and EXECUTE is revoked from PUBLIC/anon below.
CREATE OR REPLACE FUNCTION public.costing_period_state(
  p_company_id uuid, p_project_id uuid, p_date date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v integer;
BEGIN
  IF p_company_id IS NULL OR p_date IS NULL THEN RETURN 'open'; END IF;
  SELECT COALESCE(MAX(CASE cp.state
           WHEN 'hard_closed' THEN 3 WHEN 'soft_locked' THEN 2 ELSE 1 END), 1)
    INTO v
    FROM public.costing_periods cp
   WHERE cp.company_id = p_company_id
     AND cp.period_month = date_trunc('month', p_date)::date
     AND (cp.project_id IS NULL OR cp.project_id = p_project_id);
  RETURN CASE v WHEN 3 THEN 'hard_closed' WHEN 2 THEN 'soft_locked' ELSE 'open' END;
END $$;

CREATE OR REPLACE FUNCTION public.assert_costing_period_open(
  p_company_id uuid, p_project_id uuid, p_date date, p_adjustment boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v text; v_month date;
BEGIN
  IF p_company_id IS NULL OR p_date IS NULL THEN RETURN; END IF;
  v_month := date_trunc('month', p_date)::date;
  v := public.costing_period_state(p_company_id, p_project_id, p_date);
  IF v = 'hard_closed' THEN
    RAISE EXCEPTION 'costing_period_hard_closed: % is hard closed; post a correction in the next open period', v_month;
  ELSIF v = 'soft_locked' THEN
    IF NOT (COALESCE(p_adjustment, false)
            AND (public.has_company_role('finance_admin'::public.app_role)
              OR public.has_company_role('company_admin'::public.app_role))) THEN
      RAISE EXCEPTION 'costing_period_soft_locked: % is soft locked; only an audited finance-admin adjustment may post', v_month;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.transition_costing_period(
  p_company_id uuid, p_project_id uuid, p_period_month date,
  p_target public.costing_period_state, p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL)
RETURNS public.costing_periods LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_month date := date_trunc('month', p_period_month)::date;
        v_row public.costing_periods;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;
  IF NOT (public.has_company_role('finance_admin'::public.app_role)
       OR public.has_company_role('company_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance_admin or company_admin required';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.company_id = p_company_id) THEN
    RAISE EXCEPTION 'forbidden: project does not belong to this company';
  END IF;

  INSERT INTO public.costing_periods (company_id, project_id, period_month, state)
  VALUES (p_company_id, p_project_id, v_month, 'open')
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row FROM public.costing_periods
   WHERE company_id = p_company_id AND period_month = v_month
     AND project_id IS NOT DISTINCT FROM p_project_id
   FOR UPDATE;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.row_version THEN
    RAISE EXCEPTION 'costing_period_version_conflict: expected % but found %',
      p_expected_version, v_row.row_version;
  END IF;

  -- Idempotent: repeating the current state is a successful no-op.
  IF v_row.state = p_target THEN RETURN v_row; END IF;

  IF v_row.state = 'open' AND p_target = 'hard_closed' THEN
    RAISE EXCEPTION 'costing_period_invalid_transition: soft lock the period before hard closing it';
  END IF;
  IF p_target = 'open' AND COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'costing_period_reason_required: reopening a % period requires a reason', v_row.state;
  END IF;
  IF v_row.state = 'hard_closed' AND p_target <> 'open' THEN
    RAISE EXCEPTION 'costing_period_invalid_transition: reopen the period before changing a hard close';
  END IF;

  UPDATE public.costing_periods SET
    state = p_target,
    row_version = v_row.row_version + 1,
    reason = p_reason,
    soft_locked_by  = CASE WHEN p_target = 'soft_locked' THEN auth.uid() ELSE soft_locked_by END,
    soft_locked_at  = CASE WHEN p_target = 'soft_locked' THEN now() ELSE soft_locked_at END,
    hard_closed_by  = CASE WHEN p_target = 'hard_closed' THEN auth.uid() ELSE hard_closed_by END,
    hard_closed_at  = CASE WHEN p_target = 'hard_closed' THEN now() ELSE hard_closed_at END,
    reopened_by     = CASE WHEN p_target = 'open' THEN auth.uid() ELSE reopened_by END,
    reopened_at     = CASE WHEN p_target = 'open' THEN now() ELSE reopened_at END
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.approve_forecast_version(
  p_version_id uuid, p_expected_row_version integer DEFAULT NULL)
RETURNS public.forecast_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.forecast_versions; v_prev uuid;
BEGIN
  SELECT * INTO v_row FROM public.forecast_versions WHERE id = p_version_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'forecast_version_not_found'; END IF;
  IF NOT public.is_company_member(v_row.company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;
  IF NOT (public.has_company_role('finance_admin'::public.app_role)
       OR public.has_company_role('company_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance_admin or company_admin required';
  END IF;
  IF p_expected_row_version IS NOT NULL AND p_expected_row_version <> v_row.row_version THEN
    RAISE EXCEPTION 'forecast_version_conflict: expected % but found %',
      p_expected_row_version, v_row.row_version;
  END IF;
  IF v_row.status = 'approved' THEN RETURN v_row; END IF;
  IF v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'forecast_invalid_transition: only a submitted version can be approved';
  END IF;

  PERFORM public.assert_costing_period_open(
    v_row.company_id, v_row.project_id, v_row.reporting_period, false);

  SELECT id INTO v_prev FROM public.forecast_versions
   WHERE project_id = v_row.project_id AND reporting_period = v_row.reporting_period
     AND status = 'approved' FOR UPDATE;

  IF v_prev IS NOT NULL THEN
    UPDATE public.forecast_versions
       SET status = 'superseded', superseded_at = now(), superseded_by_id = v_row.id,
           row_version = row_version + 1
     WHERE id = v_prev;
  END IF;

  UPDATE public.forecast_versions
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
         previous_version_id = COALESCE(previous_version_id, v_prev),
         row_version = row_version + 1
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

-- ------------------------------------------------ database-level enforcement
CREATE OR REPLACE FUNCTION public.costing_rows_period_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r record;
BEGIN
  r := COALESCE(NEW, OLD);
  PERFORM public.assert_costing_period_open(r.company_id, r.project_id, r.period, false);
  IF TG_OP = 'UPDATE' AND OLD.period IS DISTINCT FROM NEW.period THEN
    PERFORM public.assert_costing_period_open(OLD.company_id, OLD.project_id, OLD.period, false);
  END IF;
  RETURN r;
END $$;

DROP TRIGGER IF EXISTS cost_accruals_period_guard ON public.cost_accruals;
CREATE TRIGGER cost_accruals_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_accruals
  FOR EACH ROW EXECUTE FUNCTION public.costing_rows_period_guard();

DROP TRIGGER IF EXISTS cost_forecast_periods_period_guard ON public.cost_forecast_periods;
CREATE TRIGGER cost_forecast_periods_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_forecast_periods
  FOR EACH ROW EXECUTE FUNCTION public.costing_rows_period_guard();

-- --------------------------------------------------------------- privileges
REVOKE ALL ON FUNCTION public.costing_period_state(uuid, uuid, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.assert_costing_period_open(uuid, uuid, date, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.transition_costing_period(uuid, uuid, date, public.costing_period_state, text, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.approve_forecast_version(uuid, integer) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.costing_period_state(uuid, uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_costing_period_open(uuid, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_costing_period(uuid, uuid, date, public.costing_period_state, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_forecast_version(uuid, integer) TO authenticated;

REVOKE DELETE ON public.forecast_versions FROM authenticated;
REVOKE DELETE ON public.forecast_version_lines FROM authenticated;
REVOKE DELETE ON public.costing_settings FROM authenticated;