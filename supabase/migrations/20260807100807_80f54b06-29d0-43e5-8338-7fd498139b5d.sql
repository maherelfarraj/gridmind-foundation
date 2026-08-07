-- GC-07 — Period Close Cockpit: checklist templates/runs, exception register,
-- evidence links, and a transactional hard-close gate.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.costing_checklist_item_status AS ENUM
    ('pending','in_progress','ready_for_review','completed','waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.costing_exception_severity AS ENUM ('blocker','warning');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.costing_exception_status AS ENUM
    ('open','in_progress','resolved','accepted_risk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Company close policy
-- ---------------------------------------------------------------------------
ALTER TABLE public.costing_settings
  ADD COLUMN IF NOT EXISTS allow_self_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_on_warnings boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 1. Templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costing_checklist_templates TO authenticated;
GRANT ALL ON public.costing_checklist_templates TO service_role;
ALTER TABLE public.costing_checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS costing_checklist_templates_one_active
  ON public.costing_checklist_templates (company_id) WHERE is_active;

DROP POLICY IF EXISTS costing_checklist_templates_select ON public.costing_checklist_templates;
CREATE POLICY costing_checklist_templates_select ON public.costing_checklist_templates
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS costing_checklist_templates_write ON public.costing_checklist_templates;
CREATE POLICY costing_checklist_templates_write ON public.costing_checklist_templates
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
  );

CREATE TABLE IF NOT EXISTS public.costing_checklist_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.costing_checklist_templates(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  instructions text,
  is_required boolean NOT NULL DEFAULT true,
  requires_evidence boolean NOT NULL DEFAULT false,
  owner_role public.app_role,
  due_day_offset integer NOT NULL DEFAULT 5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, seq)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.costing_checklist_template_items TO authenticated;
GRANT ALL ON public.costing_checklist_template_items TO service_role;
ALTER TABLE public.costing_checklist_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS costing_checklist_template_items_select ON public.costing_checklist_template_items;
CREATE POLICY costing_checklist_template_items_select ON public.costing_checklist_template_items
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS costing_checklist_template_items_write ON public.costing_checklist_template_items;
CREATE POLICY costing_checklist_template_items_write ON public.costing_checklist_template_items
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
  );

-- ---------------------------------------------------------------------------
-- 2. Runs + items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  template_id uuid REFERENCES public.costing_checklist_templates(id) ON DELETE SET NULL,
  template_name text NOT NULL,
  template_version integer NOT NULL DEFAULT 1,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, period_month)
);
GRANT SELECT ON public.costing_checklist_runs TO authenticated;
GRANT ALL ON public.costing_checklist_runs TO service_role;
ALTER TABLE public.costing_checklist_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS costing_checklist_runs_select ON public.costing_checklist_runs;
CREATE POLICY costing_checklist_runs_select ON public.costing_checklist_runs
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

CREATE INDEX IF NOT EXISTS costing_checklist_runs_period_idx
  ON public.costing_checklist_runs (company_id, project_id, period_month DESC);

CREATE TABLE IF NOT EXISTS public.costing_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.costing_checklist_runs(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  seq integer NOT NULL,
  category text NOT NULL DEFAULT 'general',
  title text NOT NULL,
  instructions text,
  is_required boolean NOT NULL DEFAULT true,
  requires_evidence boolean NOT NULL DEFAULT false,
  owner_role public.app_role,
  due_date date,
  status public.costing_checklist_item_status NOT NULL DEFAULT 'pending',
  assignee_id uuid,
  reviewer_id uuid,
  notes text,
  started_at timestamptz,
  ready_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  waived_by uuid,
  waived_at timestamptz,
  waiver_reason text,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq),
  CONSTRAINT costing_checklist_items_waiver_reason
    CHECK (status <> 'waived' OR COALESCE(btrim(waiver_reason), '') <> '')
);
GRANT SELECT ON public.costing_checklist_items TO authenticated;
GRANT ALL ON public.costing_checklist_items TO service_role;
ALTER TABLE public.costing_checklist_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS costing_checklist_items_select ON public.costing_checklist_items;
CREATE POLICY costing_checklist_items_select ON public.costing_checklist_items
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

CREATE INDEX IF NOT EXISTS costing_checklist_items_period_idx
  ON public.costing_checklist_items (company_id, project_id, period_month, seq);
CREATE INDEX IF NOT EXISTS costing_checklist_items_open_idx
  ON public.costing_checklist_items (company_id, project_id, period_month)
  WHERE status <> 'completed' AND status <> 'waived';
CREATE INDEX IF NOT EXISTS costing_checklist_items_assignee_idx
  ON public.costing_checklist_items (assignee_id) WHERE assignee_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Evidence (reuses the private documents library)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_checklist_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.costing_checklist_items(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE RESTRICT,
  label text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, document_id)
);
GRANT SELECT, INSERT, DELETE ON public.costing_checklist_evidence TO authenticated;
GRANT ALL ON public.costing_checklist_evidence TO service_role;
ALTER TABLE public.costing_checklist_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS costing_checklist_evidence_select ON public.costing_checklist_evidence;
CREATE POLICY costing_checklist_evidence_select ON public.costing_checklist_evidence
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS costing_checklist_evidence_insert ON public.costing_checklist_evidence;
CREATE POLICY costing_checklist_evidence_insert ON public.costing_checklist_evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND EXISTS (
      SELECT 1 FROM public.costing_checklist_items i
       WHERE i.id = item_id AND i.company_id = company_id AND i.project_id = project_id
    )
    AND EXISTS (
      SELECT 1 FROM public.documents d
       WHERE d.id = document_id AND d.company_id = company_id AND d.project_id = project_id
    )
  );

DROP POLICY IF EXISTS costing_checklist_evidence_delete ON public.costing_checklist_evidence;
CREATE POLICY costing_checklist_evidence_delete ON public.costing_checklist_evidence
  FOR DELETE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (uploaded_by = auth.uid()
      OR public.has_company_role('finance_admin'::public.app_role)
      OR public.has_company_role('company_admin'::public.app_role))
  );

CREATE INDEX IF NOT EXISTS costing_checklist_evidence_item_idx
  ON public.costing_checklist_evidence (item_id);

-- ---------------------------------------------------------------------------
-- 4. Exception register
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.costing_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  source text NOT NULL DEFAULT 'readiness',
  exception_type text NOT NULL,
  severity public.costing_exception_severity NOT NULL DEFAULT 'blocker',
  entity_table text,
  entity_id uuid,
  fingerprint text NOT NULL,
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status public.costing_exception_status NOT NULL DEFAULT 'open',
  owner_id uuid,
  due_date date,
  resolution_note text,
  resolved_by uuid,
  resolved_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, period_month, source, fingerprint),
  CONSTRAINT costing_exceptions_resolution_note
    CHECK (status NOT IN ('resolved','accepted_risk')
           OR COALESCE(btrim(resolution_note), '') <> '')
);
GRANT SELECT ON public.costing_exceptions TO authenticated;
GRANT ALL ON public.costing_exceptions TO service_role;
ALTER TABLE public.costing_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS costing_exceptions_select ON public.costing_exceptions;
CREATE POLICY costing_exceptions_select ON public.costing_exceptions
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

CREATE INDEX IF NOT EXISTS costing_exceptions_period_idx
  ON public.costing_exceptions (company_id, project_id, period_month, severity);
CREATE INDEX IF NOT EXISTS costing_exceptions_unresolved_idx
  ON public.costing_exceptions (company_id, project_id, period_month)
  WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS costing_exceptions_owner_idx
  ON public.costing_exceptions (owner_id) WHERE owner_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_cct_updated ON public.costing_checklist_templates;
CREATE TRIGGER trg_cct_updated BEFORE UPDATE ON public.costing_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_ccti_updated ON public.costing_checklist_template_items;
CREATE TRIGGER trg_ccti_updated BEFORE UPDATE ON public.costing_checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_ccr_updated ON public.costing_checklist_runs;
CREATE TRIGGER trg_ccr_updated BEFORE UPDATE ON public.costing_checklist_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_cci_updated ON public.costing_checklist_items;
CREATE TRIGGER trg_cci_updated BEFORE UPDATE ON public.costing_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_cex_updated ON public.costing_exceptions;
CREATE TRIGGER trg_cex_updated BEFORE UPDATE ON public.costing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 6. Hard-close immutability
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.costing_close_artifact_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row record;
BEGIN
  v_row := COALESCE(NEW, OLD);
  IF public.costing_period_state(v_row.company_id, v_row.project_id, v_row.period_month)
     = 'hard_closed' THEN
    RAISE EXCEPTION 'costing_period_hard_closed: close artefacts are immutable once the period is hard closed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.costing_close_artifact_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.costing_evidence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row record; v_month date;
BEGIN
  v_row := COALESCE(NEW, OLD);
  SELECT i.period_month INTO v_month
    FROM public.costing_checklist_items i WHERE i.id = v_row.item_id;
  IF v_month IS NOT NULL
     AND public.costing_period_state(v_row.company_id, v_row.project_id, v_month) = 'hard_closed' THEN
    RAISE EXCEPTION 'costing_period_hard_closed: evidence is immutable once the period is hard closed';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.costing_evidence_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_cci_immutable ON public.costing_checklist_items;
CREATE TRIGGER trg_cci_immutable BEFORE UPDATE OR DELETE ON public.costing_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.costing_close_artifact_guard();

DROP TRIGGER IF EXISTS trg_cex_immutable ON public.costing_exceptions;
CREATE TRIGGER trg_cex_immutable BEFORE UPDATE OR DELETE ON public.costing_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.costing_close_artifact_guard();

DROP TRIGGER IF EXISTS trg_cce_immutable ON public.costing_checklist_evidence;
CREATE TRIGGER trg_cce_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.costing_checklist_evidence
  FOR EACH ROW EXECUTE FUNCTION public.costing_evidence_guard();

-- ---------------------------------------------------------------------------
-- 7. Default template + idempotent checklist generation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_costing_checklist_template(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.costing_checklist_templates
   WHERE company_id = p_company_id AND is_active LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.costing_checklist_templates (company_id, name, description, created_by)
  VALUES (p_company_id, 'Standard month-end close', 'Default GridMind costing close checklist.', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.costing_checklist_template_items
    (template_id, company_id, seq, category, title, instructions, is_required, requires_evidence, owner_role, due_day_offset)
  VALUES
    (v_id, p_company_id, 10, 'actuals',     'Vendor invoices booked and coded', 'All payable invoices for the month are booked and carry a cost code.', true,  false, 'finance_admin',  3),
    (v_id, p_company_id, 20, 'accruals',    'Accruals reviewed and approved',   'No draft accruals remain in the period.',                              true,  false, 'finance_admin',  3),
    (v_id, p_company_id, 30, 'commitments', 'Commitments reconciled',           'Approved POs, subcontracts and change orders agree to the register.',  true,  false, 'project_admin',  4),
    (v_id, p_company_id, 40, 'fx',          'FX rates locked for the period',   'Every foreign-currency row carries a locked rate.',                    true,  false, 'finance_admin',  4),
    (v_id, p_company_id, 50, 'forecast',    'Forecast version approved',        'A forecast version for the month is approved and frozen.',             true,  true,  'finance_admin',  5),
    (v_id, p_company_id, 60, 'review',      'Cost report reviewed with the PM', 'Attach the reviewed cost report.',                                     true,  true,  'project_admin',  5),
    (v_id, p_company_id, 70, 'exceptions',  'Exception register cleared',       'All blocker exceptions resolved or accepted with approval.',           true,  false, 'finance_admin',  6),
    (v_id, p_company_id, 80, 'signoff',     'Finance sign-off',                 'Attach the signed close pack.',                                        true,  true,  'finance_admin',  6);

  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_costing_checklist_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_costing_checklist_template(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_costing_checklist(
  p_company_id uuid, p_project_id uuid, p_period_month date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_month date := date_trunc('month', p_period_month)::date;
        v_run uuid; v_template uuid; v_name text; v_version integer;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p
                  WHERE p.id = p_project_id AND p.company_id = p_company_id) THEN
    RAISE EXCEPTION 'forbidden: project does not belong to this company';
  END IF;

  SELECT id INTO v_run FROM public.costing_checklist_runs
   WHERE company_id = p_company_id AND project_id = p_project_id AND period_month = v_month;
  IF v_run IS NOT NULL THEN RETURN v_run; END IF;

  v_template := public.ensure_costing_checklist_template(p_company_id);
  SELECT name, version INTO v_name, v_version
    FROM public.costing_checklist_templates WHERE id = v_template;

  INSERT INTO public.costing_checklist_runs
    (company_id, project_id, period_month, template_id, template_name, template_version, generated_by)
  VALUES (p_company_id, p_project_id, v_month, v_template, v_name, v_version, auth.uid())
  ON CONFLICT (company_id, project_id, period_month) DO NOTHING
  RETURNING id INTO v_run;

  IF v_run IS NULL THEN
    SELECT id INTO v_run FROM public.costing_checklist_runs
     WHERE company_id = p_company_id AND project_id = p_project_id AND period_month = v_month;
    RETURN v_run;
  END IF;

  INSERT INTO public.costing_checklist_items
    (run_id, company_id, project_id, period_month, seq, category, title, instructions,
     is_required, requires_evidence, owner_role, due_date)
  SELECT v_run, p_company_id, p_project_id, v_month, ti.seq, ti.category, ti.title, ti.instructions,
         ti.is_required, ti.requires_evidence, ti.owner_role,
         ((v_month + interval '1 month')::date + ti.due_day_offset)
    FROM public.costing_checklist_template_items ti
   WHERE ti.template_id = v_template
   ORDER BY ti.seq;

  RETURN v_run;
END $$;
REVOKE EXECUTE ON FUNCTION public.ensure_costing_checklist(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_costing_checklist(uuid, uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Checklist item transitions (role gate, SoD, optimistic concurrency)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_costing_checklist_item(
  p_item_id uuid,
  p_expected_version integer,
  p_status public.costing_checklist_item_status DEFAULT NULL,
  p_assignee_id uuid DEFAULT NULL,
  p_reviewer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_waiver_reason text DEFAULT NULL,
  p_clear_assignee boolean DEFAULT false)
RETURNS public.costing_checklist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_item public.costing_checklist_items;
        v_status public.costing_checklist_item_status;
        v_uid uuid := auth.uid();
        v_admin boolean;
        v_self_review boolean;
BEGIN
  SELECT * INTO v_item FROM public.costing_checklist_items WHERE id = p_item_id FOR UPDATE;
  IF v_item.id IS NULL THEN RAISE EXCEPTION 'checklist_item_not_found'; END IF;
  IF NOT public.is_company_member(v_item.company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;

  v_admin := public.has_company_role('finance_admin'::public.app_role)
          OR public.has_company_role('company_admin'::public.app_role)
          OR public.has_company_role('project_admin'::public.app_role);
  IF NOT (v_admin OR v_uid = v_item.assignee_id OR v_uid = v_item.reviewer_id) THEN
    RAISE EXCEPTION 'forbidden: only the assignee, reviewer or a finance/project admin may update this item';
  END IF;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_item.row_version THEN
    RAISE EXCEPTION 'costing_checklist_version_conflict: expected % but found %',
      p_expected_version, v_item.row_version;
  END IF;

  v_status := COALESCE(p_status, v_item.status);

  IF v_status = 'waived' THEN
    IF COALESCE(btrim(p_waiver_reason), '') = '' THEN
      RAISE EXCEPTION 'costing_checklist_waiver_reason_required: a waiver reason is required';
    END IF;
    IF NOT (public.has_company_role('finance_admin'::public.app_role)
         OR public.has_company_role('company_admin'::public.app_role)) THEN
      RAISE EXCEPTION 'forbidden: finance_admin or company_admin required to waive an item';
    END IF;
  END IF;

  IF v_status = 'completed' AND v_item.requires_evidence THEN
    IF NOT EXISTS (SELECT 1 FROM public.costing_checklist_evidence e WHERE e.item_id = v_item.id) THEN
      RAISE EXCEPTION 'costing_checklist_evidence_required: attach evidence before completing this item';
    END IF;
    SELECT allow_self_review INTO v_self_review
      FROM public.costing_settings WHERE company_id = v_item.company_id;
    IF NOT COALESCE(v_self_review, false)
       AND v_item.ready_at IS NOT NULL
       AND v_uid IS NOT DISTINCT FROM COALESCE(v_item.completed_by, v_item.assignee_id) THEN
      RAISE EXCEPTION 'costing_checklist_segregation_of_duties: the reviewer must differ from the person who prepared this item';
    END IF;
  END IF;

  UPDATE public.costing_checklist_items SET
    status = v_status,
    assignee_id = CASE WHEN p_clear_assignee THEN NULL ELSE COALESCE(p_assignee_id, assignee_id) END,
    reviewer_id = COALESCE(p_reviewer_id, reviewer_id),
    notes = COALESCE(p_notes, notes),
    waiver_reason = CASE WHEN v_status = 'waived' THEN btrim(p_waiver_reason) ELSE waiver_reason END,
    waived_by = CASE WHEN v_status = 'waived' THEN v_uid ELSE waived_by END,
    waived_at = CASE WHEN v_status = 'waived' THEN now() ELSE waived_at END,
    started_at = CASE WHEN v_status = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
    ready_at = CASE WHEN v_status = 'ready_for_review' THEN now() ELSE ready_at END,
    completed_by = CASE WHEN v_status = 'ready_for_review' THEN v_uid
                        WHEN v_status = 'completed' THEN COALESCE(completed_by, v_uid) ELSE completed_by END,
    completed_at = CASE WHEN v_status = 'completed' THEN now() ELSE completed_at END,
    reviewed_by = CASE WHEN v_status = 'completed' THEN v_uid ELSE reviewed_by END,
    reviewed_at = CASE WHEN v_status = 'completed' THEN now() ELSE reviewed_at END,
    row_version = row_version + 1
  WHERE id = v_item.id
  RETURNING * INTO v_item;

  RETURN v_item;
END $$;
REVOKE EXECUTE ON FUNCTION public.update_costing_checklist_item(uuid, integer, public.costing_checklist_item_status, uuid, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_costing_checklist_item(uuid, integer, public.costing_checklist_item_status, uuid, uuid, text, text, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Exception upsert (dedupe + reopen history) and resolution
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_costing_exception(
  p_company_id uuid, p_project_id uuid, p_period_month date,
  p_source text, p_exception_type text, p_severity public.costing_exception_severity,
  p_fingerprint text, p_title text, p_detail jsonb DEFAULT '{}'::jsonb,
  p_entity_table text DEFAULT NULL, p_entity_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_month date := date_trunc('month', p_period_month)::date;
        v_id uuid; v_status public.costing_exception_status;
BEGIN
  IF NOT public.is_company_member(p_company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;

  SELECT id, status INTO v_id, v_status FROM public.costing_exceptions
   WHERE company_id = p_company_id AND project_id = p_project_id
     AND period_month = v_month AND source = p_source AND fingerprint = p_fingerprint;

  IF v_id IS NULL THEN
    INSERT INTO public.costing_exceptions
      (company_id, project_id, period_month, source, exception_type, severity,
       entity_table, entity_id, fingerprint, title, detail)
    VALUES (p_company_id, p_project_id, v_month, p_source, p_exception_type, p_severity,
            p_entity_table, p_entity_id, p_fingerprint, p_title, COALESCE(p_detail, '{}'::jsonb))
    RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  UPDATE public.costing_exceptions SET
    severity = p_severity,
    title = p_title,
    detail = COALESCE(p_detail, '{}'::jsonb),
    exception_type = p_exception_type,
    last_seen_at = now(),
    -- A resolved exception that recurs reopens and keeps its history.
    status = CASE WHEN v_status = 'resolved' THEN 'open'::public.costing_exception_status ELSE status END,
    reopen_count = CASE WHEN v_status = 'resolved' THEN reopen_count + 1 ELSE reopen_count END,
    resolved_by = CASE WHEN v_status = 'resolved' THEN NULL ELSE resolved_by END,
    resolved_at = CASE WHEN v_status = 'resolved' THEN NULL ELSE resolved_at END,
    resolution_note = CASE WHEN v_status = 'resolved' THEN NULL ELSE resolution_note END,
    row_version = row_version + 1
  WHERE id = v_id;

  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.upsert_costing_exception(uuid, uuid, date, text, text, public.costing_exception_severity, text, text, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_costing_exception(uuid, uuid, date, text, text, public.costing_exception_severity, text, text, jsonb, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_costing_exception(
  p_id uuid, p_expected_version integer,
  p_status public.costing_exception_status,
  p_note text DEFAULT NULL, p_owner_id uuid DEFAULT NULL, p_due_date date DEFAULT NULL)
RETURNS public.costing_exceptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.costing_exceptions; v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_row FROM public.costing_exceptions WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'costing_exception_not_found'; END IF;
  IF NOT public.is_company_member(v_row.company_id) THEN
    RAISE EXCEPTION 'forbidden: not a member of this company';
  END IF;
  IF NOT (public.has_company_role('finance_admin'::public.app_role)
       OR public.has_company_role('company_admin'::public.app_role)
       OR public.has_company_role('project_admin'::public.app_role)
       OR v_uid = v_row.owner_id) THEN
    RAISE EXCEPTION 'forbidden: only the owner or a finance/project admin may update this exception';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_row.row_version THEN
    RAISE EXCEPTION 'costing_exception_version_conflict: expected % but found %',
      p_expected_version, v_row.row_version;
  END IF;

  IF p_status IN ('resolved','accepted_risk') AND COALESCE(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'costing_exception_note_required: a resolution note is required';
  END IF;
  IF p_status = 'accepted_risk' AND NOT (
       public.has_company_role('finance_admin'::public.app_role)
       OR public.has_company_role('company_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance_admin or company_admin required to accept risk';
  END IF;

  UPDATE public.costing_exceptions SET
    status = p_status,
    owner_id = COALESCE(p_owner_id, owner_id),
    due_date = COALESCE(p_due_date, due_date),
    resolution_note = CASE WHEN p_status IN ('resolved','accepted_risk') THEN btrim(p_note) ELSE resolution_note END,
    resolved_by = CASE WHEN p_status = 'resolved' THEN v_uid ELSE resolved_by END,
    resolved_at = CASE WHEN p_status = 'resolved' THEN now() ELSE resolved_at END,
    approved_by = CASE WHEN p_status = 'accepted_risk' THEN v_uid ELSE approved_by END,
    approved_at = CASE WHEN p_status = 'accepted_risk' THEN now() ELSE approved_at END,
    row_version = row_version + 1
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION public.resolve_costing_exception(uuid, integer, public.costing_exception_status, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_costing_exception(uuid, integer, public.costing_exception_status, text, uuid, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Transactional hard-close gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.costing_close_blockers(
  p_company_id uuid, p_project_id uuid, p_period_month date)
RETURNS TABLE (key text, count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH m AS (SELECT date_trunc('month', p_period_month)::date AS mth),
  policy AS (
    SELECT COALESCE(block_on_warnings, false) AS block_on_warnings
      FROM public.costing_settings WHERE company_id = p_company_id
    UNION ALL SELECT false LIMIT 1
  )
  SELECT 'incomplete_required_items'::text, COUNT(*)::int
    FROM public.costing_checklist_items i, m
   WHERE i.company_id = p_company_id AND i.project_id = p_project_id
     AND i.period_month = m.mth AND i.is_required
     AND i.status NOT IN ('completed','waived')
  HAVING COUNT(*) > 0
  UNION ALL
  SELECT 'missing_evidence'::text, COUNT(*)::int
    FROM public.costing_checklist_items i, m
   WHERE i.company_id = p_company_id AND i.project_id = p_project_id
     AND i.period_month = m.mth AND i.requires_evidence AND i.status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.costing_checklist_evidence e WHERE e.item_id = i.id)
  HAVING COUNT(*) > 0
  UNION ALL
  SELECT 'unresolved_blocker_exceptions'::text, COUNT(*)::int
    FROM public.costing_exceptions x, m
   WHERE x.company_id = p_company_id AND x.project_id = p_project_id
     AND x.period_month = m.mth AND x.severity = 'blocker'
     AND x.status IN ('open','in_progress')
  HAVING COUNT(*) > 0
  UNION ALL
  SELECT 'unresolved_warning_exceptions'::text, COUNT(*)::int
    FROM public.costing_exceptions x, m, policy p
   WHERE p.block_on_warnings AND x.company_id = p_company_id AND x.project_id = p_project_id
     AND x.period_month = m.mth AND x.severity = 'warning'
     AND x.status IN ('open','in_progress')
  HAVING COUNT(*) > 0;
$$;
REVOKE EXECUTE ON FUNCTION public.costing_close_blockers(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.costing_close_blockers(uuid, uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_costing_period(
  p_company_id uuid, p_project_id uuid, p_period_month date,
  p_target public.costing_period_state, p_reason text DEFAULT NULL,
  p_expected_version integer DEFAULT NULL)
RETURNS public.costing_periods
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_month date := date_trunc('month', p_period_month)::date;
        v_row public.costing_periods;
        v_blockers text;
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

  -- GC-07: the hard close re-evaluates every close artefact in this same
  -- transaction. UI readiness is advisory; this is authoritative.
  IF p_target = 'hard_closed' AND p_project_id IS NOT NULL THEN
    SELECT string_agg(b.key || '=' || b.count, ', ' ORDER BY b.key) INTO v_blockers
      FROM public.costing_close_blockers(p_company_id, p_project_id, v_month) b;
    IF COALESCE(v_blockers, '') <> '' THEN
      RAISE EXCEPTION 'costing_period_not_ready: %', v_blockers;
    END IF;
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

  -- Soft lock is the moment the close window opens: instantiate the checklist.
  IF p_target = 'soft_locked' AND p_project_id IS NOT NULL THEN
    PERFORM public.ensure_costing_checklist(p_company_id, p_project_id, v_month);
  END IF;

  RETURN v_row;
END $$;
REVOKE EXECUTE ON FUNCTION public.transition_costing_period(uuid, uuid, date, public.costing_period_state, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_costing_period(uuid, uuid, date, public.costing_period_state, text, integer) TO authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.transition_costing_period(uuid, uuid, date, public.costing_period_state, text, integer) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_costing_checklist(uuid, uuid, date) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.ensure_costing_checklist_template(uuid) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.costing_close_blockers(uuid, uuid, date) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_costing_checklist_item(uuid, integer, public.costing_checklist_item_status, uuid, uuid, text, text, boolean) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_costing_exception(uuid, uuid, date, text, text, public.costing_exception_severity, text, text, jsonb, text, uuid) TO sandbox_exec';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolve_costing_exception(uuid, integer, public.costing_exception_status, text, uuid, date) TO sandbox_exec';
  END IF;
END $$;