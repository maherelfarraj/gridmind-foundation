CREATE TYPE public.cost_accrual_status AS ENUM ('draft', 'approved', 'reversed');

CREATE TABLE public.cost_forecast_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_code_id uuid NOT NULL REFERENCES public.cost_codes(id) ON DELETE CASCADE,
  period date NOT NULL,
  etc_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (etc_amount >= 0),
  currency_code text NOT NULL DEFAULT 'USD',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_forecast_period_month CHECK (date_trunc('month', period)::date = period),
  CONSTRAINT cost_forecast_unique UNIQUE (project_id, cost_code_id, period)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_forecast_periods TO authenticated;
GRANT ALL ON public.cost_forecast_periods TO service_role;
ALTER TABLE public.cost_forecast_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY cfp_select ON public.cost_forecast_periods FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY cfp_write ON public.cost_forecast_periods FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::public.app_role) OR public.has_company_role('project_admin'::public.app_role) OR public.has_company_role('company_admin'::public.app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::public.app_role) OR public.has_company_role('project_admin'::public.app_role) OR public.has_company_role('company_admin'::public.app_role)));

CREATE INDEX cost_forecast_project_period_idx ON public.cost_forecast_periods (project_id, period);
CREATE INDEX cost_forecast_company_idx ON public.cost_forecast_periods (company_id);

CREATE TABLE public.cost_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_code_id uuid NOT NULL REFERENCES public.cost_codes(id) ON DELETE CASCADE,
  period date NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency_code text NOT NULL DEFAULT 'USD',
  status public.cost_accrual_status NOT NULL DEFAULT 'draft',
  description text,
  approved_by uuid,
  approved_at timestamptz,
  reversed_by uuid,
  reversed_at timestamptz,
  reversal_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_accrual_period_month CHECK (date_trunc('month', period)::date = period)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_accruals TO authenticated;
GRANT ALL ON public.cost_accruals TO service_role;
ALTER TABLE public.cost_accruals ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_select ON public.cost_accruals FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY ca_write ON public.cost_accruals FOR ALL TO authenticated
  USING (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::public.app_role) OR public.has_company_role('project_admin'::public.app_role) OR public.has_company_role('company_admin'::public.app_role)))
  WITH CHECK (public.is_company_member(company_id) AND (public.has_company_role('finance_admin'::public.app_role) OR public.has_company_role('project_admin'::public.app_role) OR public.has_company_role('company_admin'::public.app_role)));

CREATE INDEX cost_accruals_project_period_idx ON public.cost_accruals (project_id, period);
CREATE INDEX cost_accruals_company_idx ON public.cost_accruals (company_id);
CREATE INDEX cost_accruals_status_idx ON public.cost_accruals (project_id, status);

CREATE TRIGGER cost_forecast_periods_updated_at BEFORE UPDATE ON public.cost_forecast_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER cost_accruals_updated_at BEFORE UPDATE ON public.cost_accruals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();