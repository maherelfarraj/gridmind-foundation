-- GC-16d — governed calendar policy administration + versioned observed holiday sets.

-- ---------------------------------------------------------------- holiday sets
CREATE TABLE IF NOT EXISTS public.calendar_holiday_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  jurisdiction text NOT NULL,
  year integer NOT NULL,
  version text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  source_reference text,
  notes text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_holiday_sets_calendar_chk
    CHECK (calendar_id IN ('iso-std','mena-jo','mena-gulf','mena-eg')),
  CONSTRAINT calendar_holiday_sets_status_chk
    CHECK (status IN ('draft','approved','superseded')),
  CONSTRAINT calendar_holiday_sets_year_chk CHECK (year BETWEEN 2000 AND 2200),
  CONSTRAINT calendar_holiday_sets_version_chk CHECK (length(version) BETWEEN 1 AND 32),
  UNIQUE (company_id, calendar_id, year, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_holiday_sets TO authenticated;
GRANT ALL ON public.calendar_holiday_sets TO service_role;
ALTER TABLE public.calendar_holiday_sets ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS calendar_holiday_sets_lookup_idx
  ON public.calendar_holiday_sets (company_id, calendar_id, year, status);

CREATE TABLE IF NOT EXISTS public.calendar_holiday_dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id uuid NOT NULL REFERENCES public.calendar_holiday_sets(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  observed_date date NOT NULL,
  label_en text NOT NULL,
  label_ar text NOT NULL,
  kind text NOT NULL DEFAULT 'public_holiday',
  source_reference text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_holiday_dates_kind_chk
    CHECK (kind IN ('public_holiday','exceptional_closure')),
  UNIQUE (set_id, observed_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_holiday_dates TO authenticated;
GRANT ALL ON public.calendar_holiday_dates TO service_role;
ALTER TABLE public.calendar_holiday_dates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS calendar_holiday_dates_set_idx
  ON public.calendar_holiday_dates (set_id, observed_date);

-- ------------------------------------------------------- policy change queue
CREATE TABLE IF NOT EXISTS public.calendar_policy_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  scope text NOT NULL,
  contract_id uuid REFERENCES public.contracts(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  from_calendar_id text,
  from_timezone text,
  to_calendar_id text NOT NULL,
  to_timezone text NOT NULL,
  material boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL,
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text,
  applied_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_policy_changes_scope_chk CHECK (scope IN ('company','contract')),
  CONSTRAINT calendar_policy_changes_status_chk
    CHECK (status IN ('pending','approved','rejected','applied')),
  CONSTRAINT calendar_policy_changes_target_chk
    CHECK ((scope = 'company' AND contract_id IS NULL) OR (scope = 'contract' AND contract_id IS NOT NULL)),
  CONSTRAINT calendar_policy_changes_to_calendar_chk
    CHECK (to_calendar_id IN ('iso-std','mena-jo','mena-gulf','mena-eg')),
  UNIQUE (company_id, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_policy_changes TO authenticated;
GRANT ALL ON public.calendar_policy_changes TO service_role;
ALTER TABLE public.calendar_policy_changes ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS calendar_policy_changes_queue_idx
  ON public.calendar_policy_changes (company_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS calendar_policy_changes_contract_idx
  ON public.calendar_policy_changes (contract_id, status);

-- --------------------------------------------------- deadline set provenance
ALTER TABLE public.contract_deadlines
  ADD COLUMN IF NOT EXISTS holiday_set_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS calendar_frozen boolean NOT NULL DEFAULT false;

ALTER TABLE public.costing_settings
  ADD COLUMN IF NOT EXISTS holiday_sets_enforced boolean NOT NULL DEFAULT false;

-- --------------------------------------------------------------- immutability
CREATE OR REPLACE FUNCTION public.calendar_holiday_sets_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'holiday_set_immutable: only draft holiday sets can be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'approved' AND NEW.status = 'approved'
     AND (NEW.calendar_id, NEW.year, NEW.version, NEW.jurisdiction)
         IS DISTINCT FROM (OLD.calendar_id, OLD.year, OLD.version, OLD.jurisdiction) THEN
    RAISE EXCEPTION 'holiday_set_immutable: approved holiday sets cannot be edited';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'holiday_set_immutable: superseded holiday sets cannot be reopened';
  END IF;
  IF NEW.status = 'approved' AND OLD.status = 'draft' AND NEW.approved_by IS NOT NULL
     AND NEW.approved_by = OLD.created_by THEN
    RAISE EXCEPTION 'holiday_set_segregation: the requester cannot approve their own holiday set';
  END IF;
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_holiday_sets_guard_trg ON public.calendar_holiday_sets;
CREATE TRIGGER calendar_holiday_sets_guard_trg
  BEFORE UPDATE OR DELETE ON public.calendar_holiday_sets
  FOR EACH ROW EXECUTE FUNCTION public.calendar_holiday_sets_guard();

CREATE OR REPLACE FUNCTION public.calendar_holiday_dates_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.calendar_holiday_sets
   WHERE id = COALESCE(NEW.set_id, OLD.set_id);
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'holiday_set_immutable: dates can only change while the set is draft';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS calendar_holiday_dates_guard_trg ON public.calendar_holiday_dates;
CREATE TRIGGER calendar_holiday_dates_guard_trg
  BEFORE INSERT OR UPDATE OR DELETE ON public.calendar_holiday_dates
  FOR EACH ROW EXECUTE FUNCTION public.calendar_holiday_dates_guard();

CREATE OR REPLACE FUNCTION public.calendar_policy_changes_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IN ('rejected','applied') THEN
    RAISE EXCEPTION 'policy_change_final: decided policy changes are immutable';
  END IF;
  IF NEW.status IN ('approved','applied') AND OLD.status = 'pending'
     AND NEW.material AND NEW.decided_by IS NOT NULL
     AND NEW.decided_by = OLD.requested_by THEN
    RAISE EXCEPTION 'policy_change_segregation: the requester cannot approve their own material policy change';
  END IF;
  NEW.updated_at := now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS calendar_policy_changes_guard_trg ON public.calendar_policy_changes;
CREATE TRIGGER calendar_policy_changes_guard_trg
  BEFORE UPDATE ON public.calendar_policy_changes
  FOR EACH ROW EXECUTE FUNCTION public.calendar_policy_changes_guard();

-- ------------------------------------------------------------------ policies
DROP POLICY IF EXISTS calendar_holiday_sets_select ON public.calendar_holiday_sets;
CREATE POLICY calendar_holiday_sets_select ON public.calendar_holiday_sets FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS calendar_holiday_sets_write ON public.calendar_holiday_sets;
CREATE POLICY calendar_holiday_sets_write ON public.calendar_holiday_sets FOR ALL TO authenticated
  USING (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')))
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')));

DROP POLICY IF EXISTS calendar_holiday_dates_select ON public.calendar_holiday_dates;
CREATE POLICY calendar_holiday_dates_select ON public.calendar_holiday_dates FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS calendar_holiday_dates_write ON public.calendar_holiday_dates;
CREATE POLICY calendar_holiday_dates_write ON public.calendar_holiday_dates FOR ALL TO authenticated
  USING (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')))
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')));

DROP POLICY IF EXISTS calendar_policy_changes_select ON public.calendar_policy_changes;
CREATE POLICY calendar_policy_changes_select ON public.calendar_policy_changes FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
DROP POLICY IF EXISTS calendar_policy_changes_insert ON public.calendar_policy_changes;
CREATE POLICY calendar_policy_changes_insert ON public.calendar_policy_changes FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id) AND status = 'pending'
    AND (public.has_company_role('finance_admin') OR public.has_company_role('project_admin')
         OR public.has_company_role('company_admin')));
DROP POLICY IF EXISTS calendar_policy_changes_update ON public.calendar_policy_changes;
CREATE POLICY calendar_policy_changes_update ON public.calendar_policy_changes FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id) AND status = 'pending'
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')))
  WITH CHECK (public.is_company_member(company_id)
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin')));

COMMENT ON TABLE public.calendar_holiday_sets IS
  'GC-16d versioned observed-holiday sets per governed calendar/jurisdiction/year. Only approved versions feed deadline calculation.';
COMMENT ON TABLE public.calendar_policy_changes IS
  'GC-16d governed calendar/timezone policy change requests with approval, impact preview and audit provenance.';
COMMENT ON COLUMN public.contract_deadlines.holiday_set_versions IS
  'GC-16d immutable record of the approved holiday-set versions applied when this due date was computed.';