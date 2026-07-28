-- P-249 Classes 2, 3, 7 — derived status: drawings, SLD, timesheets/leave.

-- ===========================================================================
-- CLASS 2 — drawing_register.current_status / locked are derived.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.drawing_register_derived_lock(
  p_drawing_id uuid, p_project_id uuid, p_status public.drawing_status)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_status IN ('IFC'::public.drawing_status, 'as_built'::public.drawing_status)
      OR EXISTS (
           SELECT 1
             FROM public.ifc_releases i,
                  LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(i.revision_snapshot) = 'array'
                         THEN i.revision_snapshot ELSE '[]'::jsonb END) e
            WHERE i.project_id = p_project_id
              AND i.status = 'released'
              AND (e->>'drawing_id')::uuid = p_drawing_id
         );
$$;

CREATE OR REPLACE FUNCTION public.drawing_register_derive_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status public.drawing_status;
  v_locked boolean;
  v_marked boolean := COALESCE(current_setting('gridmind.derived_status', true), 'off') = 'on';
BEGIN
  SELECT r.status INTO v_status
    FROM public.drawing_revisions r
   WHERE r.id = NEW.current_revision_id;

  IF v_status IS NULL THEN
    v_status := COALESCE(
      CASE WHEN TG_OP = 'UPDATE' THEN OLD.current_status ELSE NEW.current_status END,
      'draft'::public.drawing_status);
  END IF;

  v_locked := public.drawing_register_derived_lock(NEW.id, NEW.project_id, v_status);

  IF TG_OP = 'UPDATE' AND NOT v_marked THEN
    IF (NEW.current_status IS DISTINCT FROM OLD.current_status
        AND NEW.current_status IS DISTINCT FROM v_status)
    OR (NEW.locked IS DISTINCT FROM OLD.locked
        AND NEW.locked IS DISTINCT FROM v_locked) THEN
      RAISE EXCEPTION 'drawing_status_is_derived'
        USING ERRCODE = '42501',
              HINT = 'current_status/locked derive from the current revision and released IFC packages.';
    END IF;
  END IF;

  NEW.current_status := v_status;
  NEW.locked := v_locked;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS drawing_register_derive_status_trg ON public.drawing_register;
CREATE TRIGGER drawing_register_derive_status_trg
  BEFORE INSERT OR UPDATE ON public.drawing_register
  FOR EACH ROW EXECUTE FUNCTION public.drawing_register_derive_status();

-- Revision state change → re-derive the register row.
CREATE OR REPLACE FUNCTION public.drawing_revisions_sync_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('gridmind.derived_status', 'on', true);
  UPDATE public.drawing_register d
     SET current_revision_id = CASE
           WHEN NEW.status IN ('IFD'::public.drawing_status,
                               'IFC'::public.drawing_status,
                               'as_built'::public.drawing_status)
           THEN NEW.id ELSE d.current_revision_id END,
         updated_at = now()
   WHERE d.id = NEW.drawing_id;
  PERFORM set_config('gridmind.derived_status', 'off', true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS drawing_revisions_sync_register_trg ON public.drawing_revisions;
CREATE TRIGGER drawing_revisions_sync_register_trg
  AFTER INSERT OR UPDATE OF status ON public.drawing_revisions
  FOR EACH ROW EXECUTE FUNCTION public.drawing_revisions_sync_register();

-- IFC release → released: re-derive every drawing in the package snapshot.
CREATE OR REPLACE FUNCTION public.ifc_releases_sync_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  PERFORM set_config('gridmind.derived_status', 'on', true);
  UPDATE public.drawing_register d
     SET updated_at = now()
   WHERE d.project_id = NEW.project_id
     AND d.id IN (
       SELECT (e->>'drawing_id')::uuid
         FROM jsonb_array_elements(
                CASE WHEN jsonb_typeof(NEW.revision_snapshot) = 'array'
                     THEN NEW.revision_snapshot ELSE '[]'::jsonb END) e
        WHERE (e->>'drawing_id') IS NOT NULL);
  PERFORM set_config('gridmind.derived_status', 'off', true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS ifc_releases_sync_register_trg ON public.ifc_releases;
CREATE TRIGGER ifc_releases_sync_register_trg
  AFTER UPDATE OF status ON public.ifc_releases
  FOR EACH ROW EXECUTE FUNCTION public.ifc_releases_sync_register();

-- Backfill: bring every register row onto the derived model.
DO $$
DECLARE v_n int;
BEGIN
  PERFORM set_config('gridmind.derived_status', 'on', true);
  UPDATE public.drawing_register SET updated_at = updated_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('gridmind.derived_status', 'off', true);
  RAISE NOTICE 'P-249 drawing_register re-derived: %', v_n;
END $$;

-- ===========================================================================
-- CLASS 3 — sld_drawings.status / locked mirror the governed path.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sld_drawings_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.sld_status', true), 'off') = 'on'
     OR COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.locked IS DISTINCT FROM OLD.locked THEN
    RAISE EXCEPTION 'sld_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'SLD status/lock are written by the review + approval path (sld_apply_status).';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS sld_drawings_guard_status_trg ON public.sld_drawings;
CREATE TRIGGER sld_drawings_guard_status_trg
  BEFORE UPDATE ON public.sld_drawings
  FOR EACH ROW EXECUTE FUNCTION public.sld_drawings_guard_status();

-- The single governed writer. SECURITY INVOKER: RLS still decides who may write.
CREATE OR REPLACE FUNCTION public.sld_apply_status(
  p_drawing_id uuid,
  p_status text,
  p_register_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_locked boolean;
  v_reg    uuid;
  v_status public.sld_status := p_status::public.sld_status;
BEGIN
  SELECT COALESCE(p_register_id, s.drawing_register_id) INTO v_reg
    FROM public.sld_drawings s WHERE s.id = p_drawing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sld_drawing_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_locked := v_status IN ('ifc'::public.sld_status,
                           'as_built'::public.sld_status,
                           'superseded'::public.sld_status)
              OR COALESCE((SELECT d.locked FROM public.drawing_register d WHERE d.id = v_reg), false);

  PERFORM set_config('gridmind.sld_status', 'on', true);
  UPDATE public.sld_drawings
     SET status = v_status,
         locked = v_locked,
         drawing_register_id = COALESCE(p_register_id, drawing_register_id),
         updated_at = now()
   WHERE id = p_drawing_id;
  PERFORM set_config('gridmind.sld_status', 'off', true);

  RETURN jsonb_build_object('status', v_status, 'locked', v_locked);
END; $$;

GRANT EXECUTE ON FUNCTION public.sld_apply_status(uuid, text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.sld_apply_status(uuid, text, uuid) FROM anon;

-- Register lock changes propagate to the SLD rows that point at it.
CREATE OR REPLACE FUNCTION public.drawing_register_sync_sld()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.locked IS NOT DISTINCT FROM OLD.locked THEN RETURN NULL; END IF;
  PERFORM set_config('gridmind.sld_status', 'on', true);
  UPDATE public.sld_drawings s
     SET locked = NEW.locked, updated_at = now()
   WHERE s.drawing_register_id = NEW.id
     AND s.locked IS DISTINCT FROM NEW.locked;
  PERFORM set_config('gridmind.sld_status', 'off', true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS drawing_register_sync_sld_trg ON public.drawing_register;
CREATE TRIGGER drawing_register_sync_sld_trg
  AFTER UPDATE OF locked ON public.drawing_register
  FOR EACH ROW EXECUTE FUNCTION public.drawing_register_sync_sld();

-- ===========================================================================
-- CLASS 7 — timesheets + leave_requests.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.timesheets_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inst text;
BEGIN
  IF COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;

  -- Manual lifecycle transitions that stay open to the server functions.
  IF (OLD.status = 'draft'      AND NEW.status = 'submitted')
  OR (OLD.status = 'submitted'  AND NEW.status = 'draft')
  OR (OLD.status = 'rejected'   AND NEW.status = 'draft' AND NEW.approval_instance_id IS NULL)
  OR (OLD.status = 'in_review'  AND NEW.status = 'draft' AND NEW.approval_instance_id IS NULL)
  THEN
    RETURN NEW;
  END IF;

  -- submitted → in_review only when a live instance backs it.
  IF OLD.status IN ('draft', 'submitted') AND NEW.status = 'in_review'
     AND NEW.approval_instance_id IS NOT NULL THEN
    SELECT ai.status INTO v_inst FROM public.approval_instances ai
     WHERE ai.id = NEW.approval_instance_id;
    IF v_inst IN ('pending', 'in_progress') THEN RETURN NEW; END IF;
  END IF;

  RAISE EXCEPTION 'timesheet_status_is_derived'
    USING ERRCODE = '42501',
          HINT = 'Approved/rejected timesheet state is written by the approval engine.';
END; $$;

DROP TRIGGER IF EXISTS timesheets_guard_status_trg ON public.timesheets;
CREATE TRIGGER timesheets_guard_status_trg
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.timesheets_guard_status();

-- Instance decision → timesheet mirror (engine-marked).
CREATE OR REPLACE FUNCTION public.approval_instances_sync_timesheet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_target public.timesheet_status;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  v_target := CASE NEW.status
                WHEN 'approved' THEN 'approved'::public.timesheet_status
                WHEN 'rejected' THEN 'rejected'::public.timesheet_status
                WHEN 'pending' THEN 'in_review'::public.timesheet_status
                WHEN 'in_progress' THEN 'in_review'::public.timesheet_status
                ELSE NULL END;
  IF v_target IS NULL THEN RETURN NULL; END IF;

  PERFORM set_config('gridmind.approval_settle', 'on', true);
  UPDATE public.timesheets t
     SET status = v_target, updated_at = now()
   WHERE t.approval_instance_id = NEW.id
     AND t.status IS DISTINCT FROM v_target;
  PERFORM set_config('gridmind.approval_settle', 'off', true);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS approval_instances_sync_timesheet_trg ON public.approval_instances;
CREATE TRIGGER approval_instances_sync_timesheet_trg
  AFTER UPDATE OF status ON public.approval_instances
  FOR EACH ROW EXECUTE FUNCTION public.approval_instances_sync_timesheet();

-- Leave: decisions only through the guarded routine.
CREATE OR REPLACE FUNCTION public.leave_requests_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.leave_decide', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IN ('approved'::public.leave_request_status,
                    'rejected'::public.leave_request_status)
     OR OLD.status IN ('approved'::public.leave_request_status,
                       'rejected'::public.leave_request_status)
     AND NEW.status <> 'cancelled'::public.leave_request_status
  THEN
    RAISE EXCEPTION 'leave_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'Leave decisions are written by leave_decide().';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS leave_requests_guard_status_trg ON public.leave_requests;
CREATE TRIGGER leave_requests_guard_status_trg
  BEFORE UPDATE ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.leave_requests_guard_status();

CREATE OR REPLACE FUNCTION public.leave_decide(
  p_leave_id uuid,
  p_decision text,
  p_comment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_row public.leave_requests%ROWTYPE;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('gridmind.leave_decide', 'on', true);
  UPDATE public.leave_requests
     SET status = p_decision::public.leave_request_status,
         approver_id = auth.uid(),
         decided_at = now(),
         decision_comment = NULLIF(btrim(COALESCE(p_comment, '')), ''),
         updated_at = now()
   WHERE id = p_leave_id
     AND status = 'pending'::public.leave_request_status
  RETURNING * INTO v_row;
  PERFORM set_config('gridmind.leave_decide', 'off', true);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('decided', false, 'reason', 'not_pending');
  END IF;
  RETURN jsonb_build_object('decided', true, 'leave', to_jsonb(v_row));
END; $$;

GRANT EXECUTE ON FUNCTION public.leave_decide(uuid, text, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.leave_decide(uuid, text, text) FROM anon;

-- Backfill: decided leave rows that never recorded a decision timestamp.
UPDATE public.leave_requests
   SET decided_at = COALESCE(decided_at, updated_at)
 WHERE status IN ('approved'::public.leave_request_status,
                  'rejected'::public.leave_request_status)
   AND decided_at IS NULL;

-- ===========================================================================
-- Settler: SLD drawings + timesheets join the approval mirror.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.settle_derived_entity(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst    public.approval_instances%ROWTYPE;
  v_applied boolean := false;
  v_approved boolean;
BEGIN
  SELECT * INTO v_inst FROM public.approval_instances WHERE id = p_instance_id;
  IF NOT FOUND OR v_inst.status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'not_decided');
  END IF;
  v_approved := (v_inst.status = 'approved');

  IF v_inst.entity_type = 'sld_drawing' THEN
    PERFORM set_config('gridmind.approval_settle', 'on', true);
    UPDATE public.sld_drawings
       SET status = CASE WHEN v_approved THEN 'approved'::public.sld_status
                         ELSE 'draft'::public.sld_status END,
           updated_at = now()
     WHERE id = v_inst.entity_id
       AND status = 'under_review'::public.sld_status;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    PERFORM set_config('gridmind.approval_settle', 'off', true);
  ELSIF v_inst.entity_type IN ('timesheet', 'timesheet_week') THEN
    PERFORM set_config('gridmind.approval_settle', 'on', true);
    UPDATE public.timesheets
       SET status = CASE WHEN v_approved THEN 'approved'::public.timesheet_status
                         ELSE 'rejected'::public.timesheet_status END,
           approval_instance_id = COALESCE(approval_instance_id, v_inst.id),
           updated_at = now()
     WHERE id = v_inst.entity_id
       AND status IN ('submitted'::public.timesheet_status,
                      'in_review'::public.timesheet_status);
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    PERFORM set_config('gridmind.approval_settle', 'off', true);
  ELSE
    RETURN jsonb_build_object('settled', false, 'reason', 'entity_not_mirrored',
                              'entity_type', v_inst.entity_type);
  END IF;

  RETURN jsonb_build_object('settled', v_applied, 'entity_type', v_inst.entity_type,
                            'entity_id', v_inst.entity_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.settle_derived_entity(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_derived_entity(uuid) FROM anon;
