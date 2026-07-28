-- P-248 Class 4+6: approval mirror, engine as sole writer.

-- 1. Pre-step: approval linkage columns -------------------------------------
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS approval_instance_id uuid
  REFERENCES public.approval_instances(id) ON DELETE SET NULL;

ALTER TABLE public.pay_applications
  ADD COLUMN IF NOT EXISTS approval_instance_id uuid
  REFERENCES public.approval_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS proposals_approval_instance_idx
  ON public.proposals(approval_instance_id);
CREATE INDEX IF NOT EXISTS pay_applications_approval_instance_idx
  ON public.pay_applications(approval_instance_id);

-- Backfill: latest instance for that entity, when one exists.
DO $$
DECLARE v_prop int; v_pa int;
BEGIN
  WITH latest AS (
    SELECT DISTINCT ON (ai.entity_id) ai.entity_id, ai.id
      FROM public.approval_instances ai
     WHERE ai.entity_type IN ('proposal_pricing', 'proposal')
     ORDER BY ai.entity_id, ai.requested_at DESC
  )
  UPDATE public.proposals p SET approval_instance_id = l.id
    FROM latest l WHERE l.entity_id = p.id AND p.approval_instance_id IS NULL;
  GET DIAGNOSTICS v_prop = ROW_COUNT;

  WITH latest AS (
    SELECT DISTINCT ON (ai.entity_id) ai.entity_id, ai.id
      FROM public.approval_instances ai
     WHERE ai.entity_type IN ('pay_application', 'pay_app')
     ORDER BY ai.entity_id, ai.requested_at DESC
  )
  UPDATE public.pay_applications p SET approval_instance_id = l.id
    FROM latest l WHERE l.entity_id = p.id AND p.approval_instance_id IS NULL;
  GET DIAGNOSTICS v_pa = ROW_COUNT;

  RAISE NOTICE 'P-248 backfill: proposals=% pay_applications=%', v_prop, v_pa;
END $$;

-- 2. The settler: single engine-marked writer -------------------------------
CREATE OR REPLACE FUNCTION public.settle_approval_entity(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst    public.approval_instances%ROWTYPE;
  v_uid     uuid;
  v_now     timestamptz := now();
  v_comment text;
  v_action  text;
  v_applied boolean := false;
  v_approved boolean;
BEGIN
  SELECT * INTO v_inst FROM public.approval_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'instance_not_found');
  END IF;
  IF v_inst.status NOT IN ('approved', 'rejected') THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'not_decided',
                              'status', v_inst.status);
  END IF;

  v_approved := (v_inst.status = 'approved');
  v_uid := coalesce(auth.uid(), v_inst.decided_by);

  SELECT a.comment INTO v_comment
    FROM public.approvals a
   WHERE a.instance_id = v_inst.id AND a.decided_at IS NOT NULL
   ORDER BY a.decided_at DESC
   LIMIT 1;

  PERFORM set_config('gridmind.approval_settle', 'on', true);

  IF v_inst.entity_type = 'estimate' THEN
    IF v_approved THEN
      UPDATE public.estimates
         SET status = 'approved'::public.estimate_status,
             approved_at = coalesce(approved_at, v_inst.decided_at, v_now),
             approved_by = coalesce(approved_by, v_uid),
             rejection_comment = NULL,
             updated_at = v_now
       WHERE id = v_inst.entity_id
         AND status NOT IN ('approved'::public.estimate_status,
                            'priced'::public.estimate_status,
                            'superseded'::public.estimate_status);
    ELSE
      UPDATE public.estimates
         SET status = 'draft'::public.estimate_status,
             rejection_comment = v_comment,
             updated_at = v_now
       WHERE id = v_inst.entity_id
         AND status = 'in_review'::public.estimate_status;
    END IF;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    v_action := CASE WHEN v_approved THEN 'estimate.approved' ELSE 'estimate.rejected' END;

  ELSIF v_inst.entity_type = 'esg_report' THEN
    IF v_approved THEN
      UPDATE public.esg_reports
         SET status = 'approved',
             approved_at = coalesce(approved_at, v_inst.decided_at, v_now),
             approved_by = coalesce(approved_by, v_uid),
             rejection_comment = NULL,
             updated_at = v_now
       WHERE id = v_inst.entity_id AND status = 'draft';
    ELSE
      UPDATE public.esg_reports
         SET status = 'draft',
             rejection_comment = v_comment,
             updated_at = v_now
       WHERE id = v_inst.entity_id AND status <> 'published';
    END IF;
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    v_action := CASE WHEN v_approved THEN 'esg.report_approved' ELSE 'esg.report_rejected' END;

  ELSIF v_inst.entity_type IN ('proposal_pricing', 'proposal') THEN
    UPDATE public.proposals
       SET status = CASE WHEN v_approved
                         THEN 'approved'::public.proposal_status
                         ELSE 'rejected'::public.proposal_status END,
           pricing_lock = CASE WHEN v_approved THEN jsonb_build_object(
                                 'status', 'approved',
                                 'approved_by', v_uid,
                                 'approved_at', v_now,
                                 'margin_pct', coalesce(margin_pct, 0),
                                 'contingency_pct', coalesce(contingency_pct, 0),
                                 'fx_rate_snapshot', fx_rate_snapshot)
                               ELSE jsonb_build_object(
                                 'status', 'rejected',
                                 'rejected_by', v_uid,
                                 'rejected_at', v_now,
                                 'comment', v_comment) END,
           approval_instance_id = v_inst.id,
           updated_at = v_now
     WHERE id = v_inst.entity_id
       AND status IN ('draft'::public.proposal_status,
                      'in_review'::public.proposal_status);
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    v_action := CASE WHEN v_approved
                     THEN 'proposal.pricing_approved' ELSE 'proposal.pricing_rejected' END;

  ELSIF v_inst.entity_type IN ('pay_application', 'pay_app') THEN
    UPDATE public.pay_applications
       SET status = CASE WHEN v_approved
                         THEN 'approved'::public.pay_app_status
                         ELSE 'rejected'::public.pay_app_status END,
           approved_by = v_uid,
           approved_at = coalesce(v_inst.decided_at, v_now),
           reject_note = CASE WHEN v_approved THEN reject_note ELSE v_comment END,
           approval_instance_id = v_inst.id,
           updated_at = v_now
     WHERE id = v_inst.entity_id
       AND status IN ('draft'::public.pay_app_status,
                      'submitted'::public.pay_app_status,
                      'certified'::public.pay_app_status);
    GET DIAGNOSTICS v_applied = ROW_COUNT;
    v_action := CASE WHEN v_approved THEN 'pay_app.approve' ELSE 'pay_app.reject' END;

  ELSE
    PERFORM set_config('gridmind.approval_settle', 'off', true);
    RETURN jsonb_build_object('settled', false, 'reason', 'entity_not_mirrored',
                              'entity_type', v_inst.entity_type);
  END IF;

  PERFORM set_config('gridmind.approval_settle', 'off', true);

  IF v_applied THEN
    BEGIN
      INSERT INTO public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
      VALUES (v_inst.company_id, v_uid, v_action, v_inst.entity_type, v_inst.entity_id,
              jsonb_build_object('via', 'approval_engine',
                                 'instance_id', v_inst.id,
                                 'comment', v_comment));
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object('settled', v_applied,
                            'entity_type', v_inst.entity_type,
                            'entity_id', v_inst.entity_id,
                            'instance_status', v_inst.status);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_approval_entity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_approval_entity(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.settle_approval_entity_for(p_approval_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_instance uuid;
BEGIN
  SELECT instance_id INTO v_instance FROM public.approvals WHERE id = p_approval_id;
  IF v_instance IS NULL THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'approval_not_found');
  END IF;
  RETURN public.settle_approval_entity(v_instance);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_approval_entity_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_approval_entity_for(uuid) TO authenticated;

-- 3. Manual (chainless) decision paths, engine-marked ------------------------
CREATE OR REPLACE FUNCTION public.pay_app_decide(
  p_id uuid, p_decision text, p_comment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pa  public.pay_applications%ROWTYPE;
  v_uid uuid := auth.uid();
  v_ok  boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000'; END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pa FROM public.pay_applications WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.is_company_admin(v_pa.company_id)
          OR public.has_company_role(v_pa.company_id, 'finance_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_ok := (p_decision = 'approve');
  IF v_ok AND v_pa.status <> 'certified'::public.pay_app_status THEN
    RAISE EXCEPTION 'not_certified' USING ERRCODE = '22023';
  END IF;
  IF NOT v_ok AND v_pa.status NOT IN ('draft'::public.pay_app_status,
                                      'submitted'::public.pay_app_status,
                                      'certified'::public.pay_app_status) THEN
    RAISE EXCEPTION 'not_rejectable' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('gridmind.approval_settle', 'on', true);
  UPDATE public.pay_applications
     SET status = CASE WHEN v_ok THEN 'approved'::public.pay_app_status
                       ELSE 'rejected'::public.pay_app_status END,
         approved_by = v_uid,
         approved_at = now(),
         reject_note = CASE WHEN v_ok THEN reject_note ELSE p_comment END,
         updated_at = now()
   WHERE id = p_id;
  PERFORM set_config('gridmind.approval_settle', 'off', true);

  RETURN jsonb_build_object('id', p_id,
                            'status', CASE WHEN v_ok THEN 'approved' ELSE 'rejected' END);
END;
$$;

REVOKE ALL ON FUNCTION public.pay_app_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_app_decide(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.proposal_pricing_decide(
  p_proposal_id uuid, p_decision text, p_comment text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p        public.proposals%ROWTYPE;
  v_uid      uuid := auth.uid();
  v_ok       boolean;
  v_instance uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000'; END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'invalid_decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_p FROM public.proposals WHERE id = p_proposal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (public.is_company_admin(v_p.company_id)
          OR public.has_company_role(v_p.company_id, 'finance_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_ok := (p_decision = 'approve');

  SELECT id INTO v_instance
    FROM public.approval_instances
   WHERE entity_type IN ('proposal_pricing', 'proposal')
     AND entity_id = p_proposal_id
     AND status IN ('pending', 'in_progress')
   ORDER BY requested_at DESC
   LIMIT 1;

  IF v_instance IS NOT NULL THEN
    UPDATE public.approval_instances
       SET status = CASE WHEN v_ok THEN 'approved' ELSE 'rejected' END,
           decided_by = v_uid, decided_at = now(), completed_at = now()
     WHERE id = v_instance;
    UPDATE public.approvals
       SET status = CASE WHEN v_ok THEN 'approved' ELSE 'rejected' END,
           decision = CASE WHEN v_ok THEN 'approved' ELSE 'rejected' END,
           comment = coalesce(p_comment, comment),
           decided_at = now()
     WHERE instance_id = v_instance AND status = 'pending';
    RETURN public.settle_approval_entity(v_instance)
           || jsonb_build_object('instance_id', v_instance);
  END IF;

  PERFORM set_config('gridmind.approval_settle', 'on', true);
  UPDATE public.proposals
     SET status = CASE WHEN v_ok THEN 'approved'::public.proposal_status
                       ELSE 'rejected'::public.proposal_status END,
         pricing_lock = CASE WHEN v_ok THEN jsonb_build_object(
                               'status', 'approved', 'approved_by', v_uid,
                               'approved_at', now(),
                               'margin_pct', coalesce(margin_pct, 0),
                               'contingency_pct', coalesce(contingency_pct, 0),
                               'fx_rate_snapshot', fx_rate_snapshot)
                             ELSE jsonb_build_object(
                               'status', 'rejected', 'rejected_by', v_uid,
                               'rejected_at', now(), 'comment', p_comment) END,
         updated_at = now()
   WHERE id = p_proposal_id;
  PERFORM set_config('gridmind.approval_settle', 'off', true);

  RETURN jsonb_build_object('settled', true, 'entity_id', p_proposal_id,
                            'instance_id', NULL,
                            'instance_status', CASE WHEN v_ok THEN 'approved' ELSE 'rejected' END);
END;
$$;

REVOKE ALL ON FUNCTION public.proposal_pricing_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proposal_pricing_decide(uuid, text, text) TO authenticated;

-- 4. Guard triggers: approval-decided states are engine-owned ----------------
CREATE OR REPLACE FUNCTION public.estimates_guard_approval_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'approved'::public.estimate_status
       OR (OLD.status = 'approved'::public.estimate_status
           AND NEW.status IN ('draft'::public.estimate_status,
                              'in_review'::public.estimate_status)))
  THEN
    RAISE EXCEPTION 'estimate_approval_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'Approved state is written by the approval engine.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.estimates_guard_approval_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS estimates_guard_approval_status ON public.estimates;
CREATE TRIGGER estimates_guard_approval_status
BEFORE UPDATE ON public.estimates
FOR EACH ROW EXECUTE FUNCTION public.estimates_guard_approval_status();

CREATE OR REPLACE FUNCTION public.esg_reports_guard_approval_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status = 'approved' OR (OLD.status = 'approved' AND NEW.status = 'draft'))
  THEN
    RAISE EXCEPTION 'esg_report_approval_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'Approved state is written by the approval engine.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.esg_reports_guard_approval_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS esg_reports_guard_approval_status ON public.esg_reports;
CREATE TRIGGER esg_reports_guard_approval_status
BEFORE UPDATE ON public.esg_reports
FOR EACH ROW EXECUTE FUNCTION public.esg_reports_guard_approval_status();

CREATE OR REPLACE FUNCTION public.proposals_guard_approval_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status IN ('approved'::public.proposal_status,
                         'rejected'::public.proposal_status)
       OR (OLD.status IN ('approved'::public.proposal_status,
                          'rejected'::public.proposal_status)
           AND NEW.status IN ('draft'::public.proposal_status,
                              'in_review'::public.proposal_status)))
  THEN
    RAISE EXCEPTION 'proposal_approval_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'Pricing-approval state is written by the approval engine.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.proposals_guard_approval_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS proposals_guard_approval_status ON public.proposals;
CREATE TRIGGER proposals_guard_approval_status
BEFORE UPDATE ON public.proposals
FOR EACH ROW EXECUTE FUNCTION public.proposals_guard_approval_status();

CREATE OR REPLACE FUNCTION public.pay_applications_guard_approval_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(current_setting('gridmind.approval_settle', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status IN ('approved'::public.pay_app_status,
                         'rejected'::public.pay_app_status)
       OR (OLD.status IN ('approved'::public.pay_app_status,
                          'rejected'::public.pay_app_status)
           AND NEW.status IN ('draft'::public.pay_app_status,
                              'submitted'::public.pay_app_status,
                              'certified'::public.pay_app_status)))
  THEN
    RAISE EXCEPTION 'pay_app_approval_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'Approved/rejected state is written by the approval engine.';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.pay_applications_guard_approval_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS pay_applications_guard_approval_status ON public.pay_applications;
CREATE TRIGGER pay_applications_guard_approval_status
BEFORE UPDATE ON public.pay_applications
FOR EACH ROW EXECUTE FUNCTION public.pay_applications_guard_approval_status();

-- 5. Converge existing decided instances onto their entities -----------------
DO $$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM public.approval_instances
            WHERE status IN ('approved', 'rejected')
              AND entity_type IN ('estimate', 'esg_report', 'proposal_pricing',
                                  'proposal', 'pay_application', 'pay_app')
  LOOP
    PERFORM public.settle_approval_entity(r.id);
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE 'P-248 converge: % decided instance(s) settled', v_n;
END $$;