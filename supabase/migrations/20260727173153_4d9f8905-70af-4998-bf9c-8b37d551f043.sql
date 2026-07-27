-- Transactional unaward: delete award row + revert bid status atomically.
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

  IF v_remaining = 0 THEN
    UPDATE public.rfq_bids
       SET status = 'submitted'::rfq_bid_status,
           updated_at = now()
     WHERE id = v_bid_id
       AND status = 'awarded'::rfq_bid_status;
  END IF;

  RETURN jsonb_build_object(
    'award_id', p_award_id,
    'rfq_id', v_award.rfq_id,
    'line_no', v_award.line_no,
    'bid_id', v_bid_id,
    'bid_reverted', (v_remaining = 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rfq_unaward_line(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rfq_unaward_line(uuid) TO authenticated;

-- One-time orphan repair: bids marked awarded with no surviving award row.
UPDATE public.rfq_bids b
   SET status = 'submitted'::rfq_bid_status,
       updated_at = now()
 WHERE b.status = 'awarded'::rfq_bid_status
   AND NOT EXISTS (
     SELECT 1 FROM public.rfq_line_awards a WHERE a.rfq_bid_id = b.id
   );