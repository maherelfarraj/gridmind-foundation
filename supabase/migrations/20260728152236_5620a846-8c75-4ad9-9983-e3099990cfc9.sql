-- P-247 Class 5/C7: invoices.paid_amount + status derived from payments.

CREATE OR REPLACE FUNCTION public.recompute_invoice_payment_state(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv    public.invoices%ROWTYPE;
  v_total  numeric(14,2);
  v_paid   numeric(14,2);
  v_last   timestamptz;
  v_status public.invoice_status;
  v_paid_at timestamptz;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT coalesce(sum(p.amount), 0), max(p.created_at)
    INTO v_paid, v_last
    FROM public.payments p
   WHERE p.invoice_id = p_invoice_id
     AND p.record_status <> 'voided'::public.payment_record_status;

  v_total := v_inv.amount + coalesce(v_inv.tax_amount, 0);

  IF v_paid > v_total + 0.005 THEN
    RAISE EXCEPTION 'overpayment_blocked'
      USING ERRCODE = '23514',
            HINT = 'Sum of payments exceeds invoice total.';
  END IF;

  v_status  := v_inv.status;
  v_paid_at := v_inv.paid_at;

  IF v_inv.status NOT IN ('draft'::public.invoice_status,
                          'cancelled'::public.invoice_status,
                          'disputed'::public.invoice_status) THEN
    IF v_paid <= 0.005 THEN
      IF v_inv.status IN ('paid'::public.invoice_status,
                          'partially_paid'::public.invoice_status) THEN
        v_status := 'sent'::public.invoice_status;
      END IF;
      v_paid_at := NULL;
    ELSIF v_paid + 0.005 >= v_total THEN
      v_status  := 'paid'::public.invoice_status;
      v_paid_at := coalesce(v_inv.paid_at, v_last, now());
    ELSE
      v_status  := 'partially_paid'::public.invoice_status;
      v_paid_at := NULL;
    END IF;
  END IF;

  PERFORM set_config('gridmind.payment_sync', 'on', true);
  UPDATE public.invoices
     SET paid_amount     = v_paid,
         last_payment_at = v_last,
         status          = v_status,
         paid_at         = v_paid_at,
         updated_at      = now()
   WHERE id = p_invoice_id
     AND (paid_amount IS DISTINCT FROM v_paid
       OR last_payment_at IS DISTINCT FROM v_last
       OR status IS DISTINCT FROM v_status
       OR paid_at IS DISTINCT FROM v_paid_at);
  PERFORM set_config('gridmind.payment_sync', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_invoice_payment_state(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.payments_sync_invoice_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.recompute_invoice_payment_state(OLD.invoice_id);
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_payment_state(OLD.invoice_id);
  ELSE
    PERFORM public.recompute_invoice_payment_state(NEW.invoice_id);
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.payments_sync_invoice_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_sync_invoice_state ON public.payments;
CREATE TRIGGER payments_sync_invoice_state
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.payments_sync_invoice_state();

-- Guard: derived columns are trigger-owned.
CREATE OR REPLACE FUNCTION public.invoices_guard_payment_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_derived constant public.invoice_status[] :=
    ARRAY['paid'::public.invoice_status, 'partially_paid'::public.invoice_status];
BEGIN
  IF COALESCE(current_setting('gridmind.payment_sync', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.last_payment_at IS DISTINCT FROM OLD.last_payment_at
     OR (NEW.status IS DISTINCT FROM OLD.status
         AND (NEW.status = ANY(v_derived) OR OLD.status = ANY(v_derived)))
  THEN
    RAISE EXCEPTION 'invoice_payment_state_is_derived'
      USING ERRCODE = '42501',
            HINT = 'paid_amount / paid_at / paid status are maintained from the payments ledger.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.invoices_guard_payment_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS invoices_guard_payment_state ON public.invoices;
CREATE TRIGGER invoices_guard_payment_state
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoices_guard_payment_state();

-- Manual "mark paid" now settles through the ledger (single write path).
CREATE OR REPLACE FUNCTION public.invoice_settle_manual(p_invoice_id uuid, p_paid_at date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv     public.invoices%ROWTYPE;
  v_uid     uuid := auth.uid();
  v_balance numeric(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.is_company_member(v_inv.company_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_company_admin(v_inv.company_id)
          OR public.has_company_role(v_inv.company_id, 'finance_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_balance := (v_inv.amount + coalesce(v_inv.tax_amount, 0)) - coalesce(v_inv.paid_amount, 0);

  IF v_balance > 0.005 THEN
    INSERT INTO public.payments (
      company_id, invoice_id, project_id, direction, amount, currency_code,
      payment_date, method, notes, received_by, created_by
    ) VALUES (
      v_inv.company_id, v_inv.id, v_inv.project_id, v_inv.direction, v_balance,
      v_inv.currency_code, coalesce(p_paid_at, CURRENT_DATE), 'bank_transfer',
      'Settlement recorded via mark-paid', v_uid, v_uid
    );
  END IF;

  PERFORM public.recompute_invoice_payment_state(p_invoice_id);
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'invoice_id', p_invoice_id,
    'status', v_inv.status::text,
    'paid_amount', v_inv.paid_amount,
    'settled', (v_balance > 0.005)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoice_settle_manual(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoice_settle_manual(uuid, date) TO authenticated;

-- Backfill: recompute every invoice from the ledger, all tenants.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.invoices LOOP
    BEGIN
      PERFORM public.recompute_invoice_payment_state(r.id);
    EXCEPTION WHEN sqlstate '23514' THEN
      RAISE NOTICE 'overpaid invoice skipped: %', r.id;
    END;
  END LOOP;
END $$;