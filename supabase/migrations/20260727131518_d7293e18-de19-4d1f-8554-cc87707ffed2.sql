-- P-217: emission factor validity windows + ESG report register.

ALTER TABLE public.esg_emission_factors
  ADD COLUMN IF NOT EXISTS factor_code text,
  ADD COLUMN IF NOT EXISTS valid_from date NOT NULL DEFAULT DATE '1900-01-01',
  ADD COLUMN IF NOT EXISTS valid_to date,
  ADD COLUMN IF NOT EXISTS scope text;

UPDATE public.esg_emission_factors
SET factor_code = COALESCE(factor_code, upper(category::text) || '-' || left(replace(id::text, '-', ''), 6))
WHERE factor_code IS NULL;

UPDATE public.esg_emission_factors
SET scope = CASE
  WHEN category IN ('fuel_diesel', 'fuel_petrol', 'fuel_lpg') THEN 'scope_1'
  WHEN category = 'electricity_grid' THEN 'scope_2'
  ELSE 'scope_3'
END
WHERE scope IS NULL;

ALTER TABLE public.esg_emission_factors
  ALTER COLUMN factor_code SET NOT NULL,
  ALTER COLUMN scope SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'esg_emission_factors_scope_matches_category'
  ) THEN
    ALTER TABLE public.esg_emission_factors
      ADD CONSTRAINT esg_emission_factors_scope_matches_category CHECK (
        scope = CASE
          WHEN category IN ('fuel_diesel', 'fuel_petrol', 'fuel_lpg') THEN 'scope_1'
          WHEN category = 'electricity_grid' THEN 'scope_2'
          ELSE 'scope_3'
        END
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'esg_emission_factors_valid_window'
  ) THEN
    ALTER TABLE public.esg_emission_factors
      ADD CONSTRAINT esg_emission_factors_valid_window CHECK (valid_to IS NULL OR valid_to > valid_from);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS esg_emission_factors_lookup_idx
  ON public.esg_emission_factors (category, valid_from DESC);

CREATE TABLE IF NOT EXISTS public.esg_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published')),
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  methodology_note text,
  generated_by uuid,
  generated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT esg_reports_period_order CHECK (period_to >= period_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS esg_reports_period_uq
  ON public.esg_reports (company_id, project_id, period_from, period_to);

GRANT SELECT, INSERT, UPDATE ON public.esg_reports TO authenticated;
GRANT ALL ON public.esg_reports TO service_role;

ALTER TABLE public.esg_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esg_reports_select" ON public.esg_reports;
CREATE POLICY "esg_reports_select" ON public.esg_reports
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "esg_reports_insert" ON public.esg_reports;
CREATE POLICY "esg_reports_insert" ON public.esg_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('hse_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

DROP POLICY IF EXISTS "esg_reports_update" ON public.esg_reports;
CREATE POLICY "esg_reports_update" ON public.esg_reports
  FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('hse_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      public.has_company_role('hse_admin'::app_role)
      OR public.has_company_role('company_admin'::app_role)
    )
  );

DROP TRIGGER IF EXISTS esg_reports_set_updated_at ON public.esg_reports;
CREATE TRIGGER esg_reports_set_updated_at
  BEFORE UPDATE ON public.esg_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();