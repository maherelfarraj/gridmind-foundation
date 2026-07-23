-- Reconcile public.currencies and public.fx_rates to canonical 0007

-- 1. Remove triggers that reference columns being dropped
DROP TRIGGER IF EXISTS update_currencies_updated_at ON public.currencies;
DROP TRIGGER IF EXISTS update_fx_rates_updated_at ON public.fx_rates;

-- 2. Remove columns not in the canonical form
ALTER TABLE public.currencies DROP COLUMN IF EXISTS is_active;
ALTER TABLE public.currencies DROP COLUMN IF EXISTS updated_at;
ALTER TABLE public.fx_rates DROP COLUMN IF EXISTS updated_at;

-- 3. Remove the base_code <> quote_code check so the USD→USD identity rate can exist
ALTER TABLE public.fx_rates DROP CONSTRAINT IF EXISTS fx_rates_base_ne_quote;

-- 4. Recreate index with the canonical name
DROP INDEX IF EXISTS public.fx_rates_latest_idx;
CREATE INDEX IF NOT EXISTS fx_rates_pair_date_idx
  ON public.fx_rates(base_code, quote_code, as_of DESC);

-- 5. Update currency symbols to canonical values
UPDATE public.currencies
  SET symbol = CASE code
    WHEN 'MAD' THEN 'MAD'
    WHEN 'JOD' THEN 'JOD'
    WHEN 'AED' THEN 'AED'
    ELSE symbol
  END
WHERE code IN ('MAD', 'JOD', 'AED');

-- 6. Insert the USD→USD identity rate
INSERT INTO public.fx_rates (base_code, quote_code, rate, as_of, source)
VALUES ('USD', 'USD', 1.0, current_date, 'seed')
ON CONFLICT (base_code, quote_code, as_of) DO NOTHING;

-- 7. Reset grants and apply canonical policy set
REVOKE ALL ON public.currencies, public.fx_rates FROM public;
REVOKE ALL ON public.currencies, public.fx_rates FROM anon;

GRANT SELECT ON public.currencies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;
GRANT ALL ON public.currencies TO service_role;
GRANT ALL ON public.fx_rates TO service_role;

-- 8. Policies
DROP POLICY IF EXISTS currencies_all_read ON public.currencies;
DROP POLICY IF EXISTS currencies_super_admin_write ON public.currencies;
DROP POLICY IF EXISTS currencies_read ON public.currencies;
DROP POLICY IF EXISTS currencies_write ON public.currencies;

CREATE POLICY currencies_read ON public.currencies
  FOR SELECT TO authenticated USING (true);

CREATE POLICY currencies_write ON public.currencies
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS fx_rates_all_read ON public.fx_rates;
DROP POLICY IF EXISTS fx_rates_super_admin_write ON public.fx_rates;
DROP POLICY IF EXISTS fx_rates_read ON public.fx_rates;
DROP POLICY IF EXISTS fx_rates_write ON public.fx_rates;

CREATE POLICY fx_rates_read ON public.fx_rates
  FOR SELECT TO authenticated USING (true);

CREATE POLICY fx_rates_write ON public.fx_rates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));