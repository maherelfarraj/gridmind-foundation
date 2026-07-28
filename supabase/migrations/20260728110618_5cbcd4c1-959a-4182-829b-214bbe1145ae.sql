-- 0097 — Receiving cycle deepening: GPS-stamped receipts + GRN-linked lot/serial capture.

ALTER TABLE public.goods_receipts
  ADD COLUMN IF NOT EXISTS receipt_lat numeric,
  ADD COLUMN IF NOT EXISTS receipt_lng numeric,
  ADD COLUMN IF NOT EXISTS receipt_accuracy_m numeric,
  ADD COLUMN IF NOT EXISTS receipt_geo_at timestamptz;

ALTER TABLE public.batch_serial_tracking
  ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES public.goods_receipts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS grn_line_no integer;

CREATE INDEX IF NOT EXISTS batch_serial_tracking_grn_idx
  ON public.batch_serial_tracking (grn_id);
