-- GC-02 — CBS drill-down tagging + multi-currency snapshots (additive, forward-only)

-- 1. Cost-code tagging on commitment/actual documents ------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL;
ALTER TABLE public.subcontracts
  ADD COLUMN IF NOT EXISTS cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL;
ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS cost_code_id uuid REFERENCES public.cost_codes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_orders_cost_code ON public.purchase_orders(project_id, cost_code_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_cost_code ON public.subcontracts(project_id, cost_code_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_cost_code ON public.change_orders(project_id, cost_code_id);
CREATE INDEX IF NOT EXISTS idx_invoices_cost_code ON public.invoices(project_id, cost_code_id);
CREATE INDEX IF NOT EXISTS idx_cost_codes_parent ON public.cost_codes(project_id, parent_id);

-- 2. FX snapshot columns on forecast periods --------------------------------
ALTER TABLE public.cost_forecast_periods
  ADD COLUMN IF NOT EXISTS base_currency_code text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(20,10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fx_rate_date date,
  ADD COLUMN IF NOT EXISTS fx_source text NOT NULL DEFAULT 'parity',
  ADD COLUMN IF NOT EXISTS fx_override_reason text,
  ADD COLUMN IF NOT EXISTS fx_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fx_locked_by uuid,
  ADD COLUMN IF NOT EXISTS etc_amount_base numeric(20,4);

UPDATE public.cost_forecast_periods
   SET base_currency_code = COALESCE(base_currency_code, currency_code),
       etc_amount_base    = COALESCE(etc_amount_base, etc_amount),
       fx_rate_date       = COALESCE(fx_rate_date, period)
 WHERE base_currency_code IS NULL OR etc_amount_base IS NULL OR fx_rate_date IS NULL;

ALTER TABLE public.cost_forecast_periods
  ALTER COLUMN base_currency_code SET NOT NULL,
  ALTER COLUMN etc_amount_base SET NOT NULL,
  ALTER COLUMN etc_amount_base SET DEFAULT 0;

ALTER TABLE public.cost_forecast_periods
  DROP CONSTRAINT IF EXISTS cost_forecast_periods_fx_rate_positive;
ALTER TABLE public.cost_forecast_periods
  ADD CONSTRAINT cost_forecast_periods_fx_rate_positive CHECK (fx_rate > 0);
ALTER TABLE public.cost_forecast_periods
  DROP CONSTRAINT IF EXISTS cost_forecast_periods_fx_source_valid;
ALTER TABLE public.cost_forecast_periods
  ADD CONSTRAINT cost_forecast_periods_fx_source_valid
  CHECK (fx_source IN ('parity', 'table', 'manual'));

-- 3. FX snapshot columns on accruals ----------------------------------------
ALTER TABLE public.cost_accruals
  ADD COLUMN IF NOT EXISTS base_currency_code text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(20,10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS fx_rate_date date,
  ADD COLUMN IF NOT EXISTS fx_source text NOT NULL DEFAULT 'parity',
  ADD COLUMN IF NOT EXISTS fx_override_reason text,
  ADD COLUMN IF NOT EXISTS fx_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS fx_locked_by uuid,
  ADD COLUMN IF NOT EXISTS amount_base numeric(20,4);

UPDATE public.cost_accruals
   SET base_currency_code = COALESCE(base_currency_code, currency_code),
       amount_base        = COALESCE(amount_base, amount),
       fx_rate_date       = COALESCE(fx_rate_date, period)
 WHERE base_currency_code IS NULL OR amount_base IS NULL OR fx_rate_date IS NULL;

ALTER TABLE public.cost_accruals
  ALTER COLUMN base_currency_code SET NOT NULL,
  ALTER COLUMN amount_base SET NOT NULL,
  ALTER COLUMN amount_base SET DEFAULT 0;

ALTER TABLE public.cost_accruals
  DROP CONSTRAINT IF EXISTS cost_accruals_fx_rate_positive;
ALTER TABLE public.cost_accruals
  ADD CONSTRAINT cost_accruals_fx_rate_positive CHECK (fx_rate > 0);
ALTER TABLE public.cost_accruals
  DROP CONSTRAINT IF EXISTS cost_accruals_fx_source_valid;
ALTER TABLE public.cost_accruals
  ADD CONSTRAINT cost_accruals_fx_source_valid
  CHECK (fx_source IN ('parity', 'table', 'manual'));