
-- 0038: change-order workflow — approve (budget) & incorporate (schedule)

CREATE OR REPLACE FUNCTION public.approve_change_order(
  p_co_id uuid,
  p_note  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_co            public.change_orders%ROWTYPE;
  v_line          jsonb;
  v_cost_code_id  uuid;
  v_amount        numeric(14,2);
  v_budget_id     uuid;
  v_touched       uuid[] := ARRAY[]::uuid[];
  v_sum           numeric(14,2) := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_co FROM public.change_orders WHERE id = p_co_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'change_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_co.company_id) THEN
    RAISE EXCEPTION 'forbidden_company' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_company_role('finance_admin'::app_role)
    OR public.has_company_role('company_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF v_co.status NOT IN ('submitted','under_review') THEN
    RAISE EXCEPTION 'invalid_status: %', v_co.status USING ERRCODE = 'P0001';
  END IF;

  -- Validate budget_impact sum matches amount (±$0.01)
  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(v_co.budget_impact, '[]'::jsonb))
  LOOP
    v_sum := v_sum + coalesce((v_line->>'amount')::numeric(14,2), 0);
  END LOOP;

  IF abs(v_sum - v_co.amount) > 0.01 THEN
    RAISE EXCEPTION 'budget_impact_unbalanced: sum=% amount=%', v_sum, v_co.amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Apply each impact line to the latest-version budget row for that cost code
  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(v_co.budget_impact, '[]'::jsonb))
  LOOP
    v_cost_code_id := (v_line->>'cost_code_id')::uuid;
    v_amount := (v_line->>'amount')::numeric(14,2);

    SELECT id INTO v_budget_id
    FROM public.budgets
    WHERE project_id = v_co.project_id
      AND cost_code_id = v_cost_code_id
    ORDER BY version DESC
    LIMIT 1
    FOR UPDATE;

    IF v_budget_id IS NULL THEN
      RAISE EXCEPTION 'budget_row_missing_for_cost_code: %', v_cost_code_id
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.budgets
       SET approved_changes = approved_changes + v_amount,
           updated_at = now()
     WHERE id = v_budget_id;

    v_touched := array_append(v_touched, v_budget_id);
  END LOOP;

  UPDATE public.change_orders
     SET status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         updated_at = now()
   WHERE id = p_co_id;

  RETURN jsonb_build_object(
    'co_id', p_co_id,
    'budgets_touched', to_jsonb(v_touched),
    'note', p_note
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_change_order(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_change_order(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.incorporate_change_order(
  p_co_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_co       public.change_orders%ROWTYPE;
  v_shifted  uuid[] := ARRAY[]::uuid[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_co FROM public.change_orders WHERE id = p_co_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'change_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_company_member(v_co.company_id) THEN
    RAISE EXCEPTION 'forbidden_company' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.has_company_role('finance_admin'::app_role)
    OR public.has_company_role('company_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF v_co.status <> 'approved' THEN
    RAISE EXCEPTION 'invalid_status: %', v_co.status USING ERRCODE = 'P0001';
  END IF;

  IF v_co.schedule_impact_days > 0 AND v_co.wbs_item_id IS NOT NULL THEN
    WITH shifted AS (
      UPDATE public.schedule_tasks
         SET start_date = start_date + v_co.schedule_impact_days,
             end_date   = end_date   + v_co.schedule_impact_days,
             updated_at = now()
       WHERE wbs_item_id = v_co.wbs_item_id
         AND status = 'not_started'
      RETURNING id
    )
    SELECT array_agg(id) INTO v_shifted FROM shifted;
  END IF;

  UPDATE public.change_orders
     SET status = 'incorporated',
         updated_at = now()
   WHERE id = p_co_id;

  RETURN jsonb_build_object(
    'co_id', p_co_id,
    'tasks_shifted', to_jsonb(coalesce(v_shifted, ARRAY[]::uuid[])),
    'days', v_co.schedule_impact_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.incorporate_change_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.incorporate_change_order(uuid) TO authenticated;
