-- FX-01 — automatic exchange-rate feed integration

-- 1) fx_rates: provider attribution + source-aware uniqueness
ALTER TABLE public.fx_rates
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_observed_on date,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.fx_rates
  DROP CONSTRAINT IF EXISTS fx_rates_pair_asof_unique;

ALTER TABLE public.fx_rates
  ADD CONSTRAINT fx_rates_pair_asof_source_unique
  UNIQUE (base_code, quote_code, as_of, source);

ALTER TABLE public.fx_rates
  ADD COLUMN IF NOT EXISTS source_priority integer
  GENERATED ALWAYS AS (CASE WHEN source = 'manual' THEN 0 ELSE 1 END) STORED;

CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx
  ON public.fx_rates (base_code, quote_code, as_of DESC, source_priority ASC);

GRANT SELECT ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;

DROP POLICY IF EXISTS fx_rates_manual_write ON public.fx_rates;
CREATE POLICY fx_rates_manual_write ON public.fx_rates
  FOR ALL TO authenticated
  USING (
    source = 'manual'
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin'))
  )
  WITH CHECK (
    source = 'manual'
    AND (public.has_company_role('finance_admin') OR public.has_company_role('company_admin'))
  );

GRANT INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;

-- 2) provider settings (global singleton)
CREATE TABLE IF NOT EXISTS public.fx_provider_settings (
  id boolean PRIMARY KEY DEFAULT true,
  provider text NOT NULL DEFAULT 'frankfurter',
  enabled boolean NOT NULL DEFAULT true,
  base_currency text NOT NULL DEFAULT 'USD' REFERENCES public.currencies(code),
  treasury_currencies text[] NOT NULL DEFAULT '{}'::text[],
  schedule_time text NOT NULL DEFAULT '17:30',
  schedule_timezone text NOT NULL DEFAULT 'Asia/Amman',
  staleness_business_days integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_provider_settings_singleton CHECK (id),
  CONSTRAINT fx_provider_settings_staleness_check CHECK (staleness_business_days BETWEEN 1 AND 30)
);

GRANT SELECT, INSERT, UPDATE ON public.fx_provider_settings TO authenticated;
GRANT ALL ON public.fx_provider_settings TO service_role;
ALTER TABLE public.fx_provider_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_provider_settings_read ON public.fx_provider_settings;
CREATE POLICY fx_provider_settings_read ON public.fx_provider_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS fx_provider_settings_write ON public.fx_provider_settings;
CREATE POLICY fx_provider_settings_write ON public.fx_provider_settings
  FOR ALL TO authenticated
  USING (public.has_company_role('finance_admin') OR public.has_company_role('company_admin'))
  WITH CHECK (public.has_company_role('finance_admin') OR public.has_company_role('company_admin'));

INSERT INTO public.fx_provider_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 3) import run log
CREATE TABLE IF NOT EXISTS public.fx_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('scheduled', 'manual')),
  status text NOT NULL CHECK (status IN ('running', 'success', 'failed', 'skipped')),
  observation_date date,
  requested_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  missing_codes text[] NOT NULL DEFAULT '{}'::text[],
  error_summary text,
  duration_ms integer,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fx_import_runs_started_idx ON public.fx_import_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS fx_import_runs_status_idx ON public.fx_import_runs (status, started_at DESC);

GRANT SELECT ON public.fx_import_runs TO authenticated;
GRANT ALL ON public.fx_import_runs TO service_role;
ALTER TABLE public.fx_import_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fx_import_runs_read ON public.fx_import_runs;
CREATE POLICY fx_import_runs_read ON public.fx_import_runs
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_fx_provider_settings_updated_at
  BEFORE UPDATE ON public.fx_provider_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fx_import_runs_updated_at
  BEFORE UPDATE ON public.fx_import_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_fx_rates_updated_at
  BEFORE UPDATE ON public.fx_rates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();