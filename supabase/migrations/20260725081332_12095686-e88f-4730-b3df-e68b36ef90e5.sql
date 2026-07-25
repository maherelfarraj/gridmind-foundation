
-- 0038 (project finance): ppa_terms, lcoe_scenarios, lender_dd_items, bank_facilities

DO $$ BEGIN
  CREATE TYPE public.facility_type AS ENUM ('term_loan','revolver','construction_loan','letter_of_credit','bond','equity');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.dd_item_status AS ENUM ('not_started','in_progress','submitted','accepted','waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- ppa_terms
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ppa_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  counterparty text,
  contract_id uuid REFERENCES public.contracts(id),
  term_years int NOT NULL,
  tariff numeric(12,6) NOT NULL,
  currency_code text NOT NULL REFERENCES public.currencies(code),
  escalation_pct numeric(6,3) NOT NULL DEFAULT 0,
  capacity_mw numeric(12,3),
  annual_energy_mwh numeric(14,2),
  availability_target_pct numeric(5,2),
  liquidated_damages jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ppa_terms TO authenticated;
GRANT ALL ON public.ppa_terms TO service_role;

ALTER TABLE public.ppa_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppa_select ON public.ppa_terms;
CREATE POLICY ppa_select ON public.ppa_terms
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS ppa_write ON public.ppa_terms;
CREATE POLICY ppa_write ON public.ppa_terms
  FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)));

DROP TRIGGER IF EXISTS ppa_terms_set_updated_at ON public.ppa_terms;
CREATE TRIGGER ppa_terms_set_updated_at
  BEFORE UPDATE ON public.ppa_terms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS ppa_project_idx ON public.ppa_terms(project_id);

-- ---------------------------------------------------------------------------
-- lcoe_scenarios
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lcoe_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  capex numeric(16,2) NOT NULL,
  opex_annual numeric(14,2) NOT NULL,
  discount_rate_pct numeric(6,3) NOT NULL,
  annual_energy_mwh numeric(14,2) NOT NULL,
  degradation_pct numeric(6,3) NOT NULL DEFAULT 0.5,
  project_life_years int NOT NULL DEFAULT 25,
  currency_code text NOT NULL REFERENCES public.currencies(code),
  lcoe numeric(12,6),
  assumptions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.lcoe_scenarios TO authenticated;
GRANT ALL ON public.lcoe_scenarios TO service_role;

ALTER TABLE public.lcoe_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lcoe_select ON public.lcoe_scenarios;
CREATE POLICY lcoe_select ON public.lcoe_scenarios
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS lcoe_write ON public.lcoe_scenarios;
CREATE POLICY lcoe_write ON public.lcoe_scenarios
  FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)));

DROP TRIGGER IF EXISTS lcoe_scenarios_set_updated_at ON public.lcoe_scenarios;
CREATE TRIGGER lcoe_scenarios_set_updated_at
  BEFORE UPDATE ON public.lcoe_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS lcoe_project_idx ON public.lcoe_scenarios(project_id);

-- ---------------------------------------------------------------------------
-- lender_dd_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lender_dd_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  category text NOT NULL,
  title text NOT NULL,
  description text,
  status public.dd_item_status NOT NULL DEFAULT 'not_started',
  due_date date,
  owner_id uuid REFERENCES public.profiles(id),
  document_path text,
  response_note text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.lender_dd_items TO authenticated;
GRANT ALL ON public.lender_dd_items TO service_role;

ALTER TABLE public.lender_dd_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dd_select ON public.lender_dd_items;
CREATE POLICY dd_select ON public.lender_dd_items
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS dd_write ON public.lender_dd_items;
CREATE POLICY dd_write ON public.lender_dd_items
  FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('legal_admin'::app_role) OR public.has_company_role('company_admin'::app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('legal_admin'::app_role) OR public.has_company_role('company_admin'::app_role)));

DROP TRIGGER IF EXISTS lender_dd_items_set_updated_at ON public.lender_dd_items;
CREATE TRIGGER lender_dd_items_set_updated_at
  BEFORE UPDATE ON public.lender_dd_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS dd_project_idx ON public.lender_dd_items(project_id, category, status);

-- ---------------------------------------------------------------------------
-- bank_facilities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bank_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  lender_name text NOT NULL,
  facility_type public.facility_type NOT NULL,
  commitment_amount numeric(16,2) NOT NULL,
  drawn_amount numeric(16,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL REFERENCES public.currencies(code),
  interest_rate_pct numeric(6,3),
  margin_pct numeric(6,3),
  maturity_date date,
  covenants jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_facilities_drawn_le_commitment CHECK (drawn_amount <= commitment_amount)
);

GRANT SELECT, INSERT, UPDATE ON public.bank_facilities TO authenticated;
GRANT ALL ON public.bank_facilities TO service_role;

ALTER TABLE public.bank_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bf_select ON public.bank_facilities;
CREATE POLICY bf_select ON public.bank_facilities
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS bf_write ON public.bank_facilities;
CREATE POLICY bf_write ON public.bank_facilities
  FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::app_role) OR public.has_company_role('company_admin'::app_role)));

DROP TRIGGER IF EXISTS bank_facilities_set_updated_at ON public.bank_facilities;
CREATE TRIGGER bank_facilities_set_updated_at
  BEFORE UPDATE ON public.bank_facilities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS bf_company_idx ON public.bank_facilities(company_id, project_id, status);
