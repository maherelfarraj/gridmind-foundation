DO $$ BEGIN
  CREATE TYPE public.esg_factor_category AS ENUM (
    'fuel_diesel','fuel_petrol','fuel_lpg',
    'electricity_grid','electricity_generator',
    'transport_road','transport_air','transport_sea',
    'materials_concrete','materials_steel','materials_cable',
    'waste_general','waste_hazardous','waste_recyclable',
    'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.esg_emission_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  category public.esg_factor_category NOT NULL,
  unit text NOT NULL,
  kg_co2e_per_unit numeric(18,6) NOT NULL CHECK (kg_co2e_per_unit >= 0),
  factor_source text NOT NULL DEFAULT 'GridMind default',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS esg_emission_factors_global_uk
  ON public.esg_emission_factors (category) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS esg_emission_factors_company_uk
  ON public.esg_emission_factors (company_id, category) WHERE company_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esg_emission_factors TO authenticated;
GRANT ALL ON public.esg_emission_factors TO service_role;
ALTER TABLE public.esg_emission_factors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esg_factors_select ON public.esg_emission_factors;
CREATE POLICY esg_factors_select ON public.esg_emission_factors
  FOR SELECT TO authenticated
  USING (company_id IS NULL OR public.is_company_member(company_id));

DROP POLICY IF EXISTS esg_factors_write ON public.esg_emission_factors;
CREATE POLICY esg_factors_write ON public.esg_emission_factors
  FOR ALL TO authenticated
  USING (
    company_id IS NOT NULL AND public.is_company_member(company_id)
    AND (public.has_company_role('hse_admin') OR public.has_company_role('company_admin'))
  )
  WITH CHECK (
    company_id IS NOT NULL AND public.is_company_member(company_id)
    AND (public.has_company_role('hse_admin') OR public.has_company_role('company_admin'))
  );

CREATE TABLE IF NOT EXISTS public.esg_counters (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  next_activity_seq integer NOT NULL DEFAULT 1
);
REVOKE ALL ON public.esg_counters FROM authenticated, anon;
GRANT ALL ON public.esg_counters TO service_role;
ALTER TABLE public.esg_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.esg_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  act_number text NOT NULL,
  period_month date NOT NULL,
  category public.esg_factor_category NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','equipment_fuel','waste','import')),
  source_id uuid,
  evidence_path text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, act_number)
);

CREATE INDEX IF NOT EXISTS esg_activities_project_month_idx
  ON public.esg_activities (project_id, period_month);
CREATE UNIQUE INDEX IF NOT EXISTS esg_activities_fingerprint_uk
  ON public.esg_activities (company_id, (metadata->>'fingerprint'))
  WHERE metadata->>'fingerprint' IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esg_activities TO authenticated;
GRANT ALL ON public.esg_activities TO service_role;
ALTER TABLE public.esg_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS esg_activities_select ON public.esg_activities;
CREATE POLICY esg_activities_select ON public.esg_activities
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS esg_activities_write ON public.esg_activities;
CREATE POLICY esg_activities_write ON public.esg_activities
  FOR ALL TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_company_role('hse_admin') OR public.has_company_role('company_admin'))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_company_role('hse_admin') OR public.has_company_role('company_admin'))
  );

CREATE OR REPLACE FUNCTION public.esg_activities_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq integer;
BEGIN
  NEW.period_month := date_trunc('month', NEW.period_month)::date;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.esg_counters (company_id, next_activity_seq)
    VALUES (NEW.company_id, 1)
    ON CONFLICT (company_id) DO UPDATE SET next_activity_seq = public.esg_counters.next_activity_seq + 1
    RETURNING next_activity_seq INTO v_seq;
    NEW.act_number := 'ACT-' || lpad(v_seq::text, 4, '0');
  ELSE
    NEW.act_number := OLD.act_number;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS esg_activities_before_write ON public.esg_activities;
CREATE TRIGGER esg_activities_before_write
  BEFORE INSERT OR UPDATE ON public.esg_activities
  FOR EACH ROW EXECUTE FUNCTION public.esg_activities_before_write();

DROP TRIGGER IF EXISTS esg_emission_factors_touch ON public.esg_emission_factors;
CREATE TRIGGER esg_emission_factors_touch
  BEFORE UPDATE ON public.esg_emission_factors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.esg_emission_factors (company_id, category, unit, kg_co2e_per_unit, factor_source)
VALUES
  (NULL,'fuel_diesel','L',2.68,'DEFRA 2024'),
  (NULL,'fuel_petrol','L',2.31,'DEFRA 2024'),
  (NULL,'fuel_lpg','L',1.56,'DEFRA 2024'),
  (NULL,'electricity_grid','kWh',0.45,'IEA grid average'),
  (NULL,'electricity_generator','kWh',0.72,'DEFRA 2024'),
  (NULL,'transport_road','km',0.17,'DEFRA 2024'),
  (NULL,'transport_air','km',0.25,'DEFRA 2024'),
  (NULL,'transport_sea','km',0.02,'DEFRA 2024'),
  (NULL,'materials_concrete','t',120.0,'ICE v3'),
  (NULL,'materials_steel','t',1850.0,'ICE v3'),
  (NULL,'materials_cable','t',3200.0,'ICE v3'),
  (NULL,'waste_general','kg',0.45,'DEFRA 2024'),
  (NULL,'waste_hazardous','kg',1.20,'DEFRA 2024'),
  (NULL,'waste_recyclable','kg',0.02,'DEFRA 2024'),
  (NULL,'other','unit',0,'Manual')
ON CONFLICT DO NOTHING;