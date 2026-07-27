CREATE TYPE public.ops_alert_status AS ENUM ('open', 'acknowledged', 'dismissed');
CREATE TYPE public.ops_alert_severity AS ENUM ('info', 'warning', 'critical');
CREATE TYPE public.ops_incident_severity AS ENUM ('sev1', 'sev2', 'sev3', 'sev4');
CREATE TYPE public.ops_incident_status AS ENUM ('open', 'acknowledged', 'mitigated', 'resolved');
CREATE TYPE public.ops_feedback_status AS ENUM ('open', 'triaged', 'in_progress', 'resolved', 'closed');
CREATE TYPE public.ops_feedback_category AS ENUM ('bug', 'ux', 'performance', 'security', 'feature', 'other');
CREATE TYPE public.slo_status AS ENUM ('ok', 'warn', 'breach');

CREATE TABLE public.ops_alert_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    rule_type text NOT NULL,
    threshold jsonb NOT NULL DEFAULT '{}'::jsonb,
    enabled boolean NOT NULL DEFAULT true,
    notify_role public.app_role NOT NULL DEFAULT 'super_admin'::public.app_role,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    rule_id uuid REFERENCES public.ops_alert_rules(id) ON DELETE SET NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    alert_date date NOT NULL DEFAULT CURRENT_DATE,
    severity public.ops_alert_severity NOT NULL DEFAULT 'warning',
    message text NOT NULL,
    status public.ops_alert_status NOT NULL DEFAULT 'open',
    acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    acknowledged_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_incidents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    severity public.ops_incident_severity NOT NULL DEFAULT 'sev4',
    title text NOT NULL,
    description text,
    status public.ops_incident_status NOT NULL DEFAULT 'open',
    started_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    category public.ops_feedback_category NOT NULL DEFAULT 'other',
    severity public.ops_alert_severity NOT NULL DEFAULT 'warning',
    title text NOT NULL,
    description text,
    screenshot_url text,
    status public.ops_feedback_status NOT NULL DEFAULT 'open',
    assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.ops_slo_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
    slo_name text NOT NULL,
    slo_target jsonb NOT NULL DEFAULT '{}'::jsonb,
    measurement_window text NOT NULL,
    observed_value numeric,
    status public.slo_status NOT NULL DEFAULT 'ok',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_alert_rules TO authenticated;
GRANT ALL ON public.ops_alert_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_alerts TO authenticated;
GRANT ALL ON public.ops_alerts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_incidents TO authenticated;
GRANT ALL ON public.ops_incidents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_feedback TO authenticated;
GRANT ALL ON public.ops_feedback TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_slo_snapshots TO authenticated;
GRANT ALL ON public.ops_slo_snapshots TO service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

ALTER TABLE public.ops_alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_slo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_ops_admin_for_company(_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (_company_id IS NOT NULL AND public.is_company_admin(_company_id))
  )
$$;

CREATE POLICY "Ops rules visible to super-admins and company admins"
  ON public.ops_alert_rules
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "Ops rules manageable by super-admins and company admins"
  ON public.ops_alert_rules
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "Ops alerts visible to super-admins and company members"
  ON public.ops_alerts
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_company_member(company_id))
  );

CREATE POLICY "Ops alerts manageable by super-admins and company admins"
  ON public.ops_alerts
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "Ops incidents visible to super-admins and company members"
  ON public.ops_incidents
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_company_member(company_id))
  );

CREATE POLICY "Ops incidents manageable by super-admins and company admins"
  ON public.ops_incidents
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "Feedback visible to creator and super-admins/company admins"
  ON public.ops_feedback
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "Feedback manageable by super-admins and company admins"
  ON public.ops_feedback
  FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_ops_admin_for_company(company_id))
  );

CREATE POLICY "SLO snapshots visible to super-admins and company members"
  ON public.ops_slo_snapshots
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (company_id IS NOT NULL AND public.is_company_member(company_id))
  );

CREATE POLICY "SLO snapshots manageable by super-admins"
  ON public.ops_slo_snapshots
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.set_ops_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ops_alert_rules_updated_at
  BEFORE UPDATE ON public.ops_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_updated_at();
CREATE TRIGGER ops_alerts_updated_at
  BEFORE UPDATE ON public.ops_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_updated_at();
CREATE TRIGGER ops_incidents_updated_at
  BEFORE UPDATE ON public.ops_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_updated_at();
CREATE TRIGGER ops_feedback_updated_at
  BEFORE UPDATE ON public.ops_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_ops_updated_at();