-- P-246 Class 1: rfq_bids.status single-write-path

ALTER TABLE public.rfq_bids
  ADD COLUMN IF NOT EXISTS pre_award_status public.rfq_bid_status;

-- Trigger that owns the award-state write on rfq_bids.
CREATE OR REPLACE FUNCTION public.rfq_bids_sync_award_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bid_id    uuid;
  v_remaining int;
BEGIN
  v_bid_id := COALESCE(NEW.rfq_bid_id, OLD.rfq_bid_id);

  PERFORM set_config('gridmind.award_sync', 'on', true);

  IF TG_OP = 'INSERT' THEN
    UPDATE public.rfq_bids
       SET pre_award_status = COALESCE(pre_award_status, status),
           status = 'awarded'::public.rfq_bid_status,
           updated_at = now()
     WHERE id = v_bid_id
       AND status <> 'awarded'::public.rfq_bid_status;
  ELSE
    SELECT count(*) INTO v_remaining
      FROM public.rfq_line_awards
     WHERE rfq_bid_id = v_bid_id;

    IF v_remaining = 0 THEN
      UPDATE public.rfq_bids
         SET status = COALESCE(pre_award_status, 'submitted'::public.rfq_bid_status),
             pre_award_status = NULL,
             updated_at = now()
       WHERE id = v_bid_id
         AND status = 'awarded'::public.rfq_bid_status;
    END IF;
  END IF;

  PERFORM set_config('gridmind.award_sync', 'off', true);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.rfq_bids_sync_award_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rfq_line_awards_sync_bid_status ON public.rfq_line_awards;
CREATE TRIGGER rfq_line_awards_sync_bid_status
AFTER INSERT OR DELETE ON public.rfq_line_awards
FOR EACH ROW EXECUTE FUNCTION public.rfq_bids_sync_award_status();

-- Guard: no manual writes into/out of the awarded state.
CREATE OR REPLACE FUNCTION public.rfq_bids_guard_award_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND ('awarded'::public.rfq_bid_status IN (NEW.status, OLD.status))
     AND COALESCE(current_setting('gridmind.award_sync', true), 'off') <> 'on'
  THEN
    RAISE EXCEPTION 'award_status_is_derived'
      USING ERRCODE = '42501',
            HINT = 'rfq_bids.status awarded state is maintained by rfq_line_awards triggers.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rfq_bids_guard_award_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rfq_bids_guard_award_status ON public.rfq_bids;
CREATE TRIGGER rfq_bids_guard_award_status
BEFORE UPDATE ON public.rfq_bids
FOR EACH ROW EXECUTE FUNCTION public.rfq_bids_guard_award_status();

-- Unaward RPC keeps audit/lock logic; status write moves to the trigger.
CREATE OR REPLACE FUNCTION public.rfq_unaward_line(p_award_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_award     public.rfq_line_awards%ROWTYPE;
  v_bid_id    uuid;
  v_remaining int;
  v_po_count  int;
  v_uid       uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_award FROM public.rfq_line_awards WHERE id = p_award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'award_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_award.company_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.is_company_admin(v_award.company_id)
    OR public.has_company_role(v_award.company_id, 'procurement_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_po_count
  FROM public.purchase_orders
  WHERE rfq_id = v_award.rfq_id;
  IF v_po_count > 0 THEN
    RAISE EXCEPTION 'award_locked' USING ERRCODE = '55006';
  END IF;

  v_bid_id := v_award.rfq_bid_id;

  DELETE FROM public.rfq_line_awards WHERE id = p_award_id;

  SELECT count(*) INTO v_remaining
  FROM public.rfq_line_awards
  WHERE rfq_bid_id = v_bid_id;

  RETURN jsonb_build_object(
    'award_id', p_award_id,
    'rfq_id', v_award.rfq_id,
    'line_no', v_award.line_no,
    'bid_id', v_bid_id,
    'bid_reverted', (v_remaining = 0)
  );
END;
$$;