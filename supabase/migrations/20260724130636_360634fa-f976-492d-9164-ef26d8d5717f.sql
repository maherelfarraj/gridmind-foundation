
-- Enums
CREATE TYPE public.lead_status AS ENUM ('new','qualifying','qualified','disqualified','converted');
CREATE TYPE public.lead_source AS ENUM ('inbound','outbound','referral','tender_portal','event','partner','other');
CREATE TYPE public.opportunity_stage AS ENUM ('prospect','qualified','proposal','negotiation','won','lost');
CREATE TYPE public.contact_type AS ENUM ('client','partner','consultant','epc_peer','authority','other');
CREATE TYPE public.tender_event_type AS ENUM ('rfi','rfp','rfq','tender','prequal','site_visit','q_and_a','submission','award');

-- ============ leads ============
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  organization text,
  email citext,
  phone text,
  country text,
  region text,
  source public.lead_source NOT NULL DEFAULT 'inbound',
  status public.lead_status NOT NULL DEFAULT 'new',
  estimated_capacity_mw numeric,
  archetype text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_company_status_idx ON public.leads(company_id, status);
CREATE INDEX leads_company_owner_idx ON public.leads(company_id, owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select_member" ON public.leads FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY "leads_insert_member" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "leads_update_member" ON public.leads FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "leads_delete_admin" ON public.leads FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ opportunities ============
CREATE TABLE public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  name text NOT NULL,
  client_name text,
  archetype text,
  stage public.opportunity_stage NOT NULL DEFAULT 'prospect',
  value_amount numeric,
  value_currency text NOT NULL DEFAULT 'USD',
  probability int CHECK (probability IS NULL OR (probability BETWEEN 0 AND 100)),
  expected_close_date date,
  actual_close_date date,
  competitor text,
  loss_reason text,
  converted_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opportunities_company_stage_idx ON public.opportunities(company_id, stage);
CREATE INDEX opportunities_company_owner_idx ON public.opportunities(company_id, owner_id);
CREATE INDEX opportunities_company_close_idx ON public.opportunities(company_id, expected_close_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunities_select_member" ON public.opportunities FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY "opportunities_insert_member" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "opportunities_update_member" ON public.opportunities FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "opportunities_delete_admin" ON public.opportunities FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

CREATE TRIGGER opportunities_set_updated_at BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ contacts ============
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  type public.contact_type NOT NULL DEFAULT 'client',
  first_name text,
  last_name text,
  title text,
  email citext,
  phone text,
  organization text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);
CREATE INDEX contacts_company_opp_idx ON public.contacts(company_id, opportunity_id);
CREATE INDEX contacts_company_lead_idx ON public.contacts(company_id, lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contacts_select_member" ON public.contacts FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY "contacts_insert_member" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "contacts_update_member" ON public.contacts FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "contacts_delete_admin" ON public.contacts FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ tender_events ============
CREATE TABLE public.tender_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  type public.tender_event_type NOT NULL,
  event_date date NOT NULL,
  title text NOT NULL,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tender_events_opp_date_idx ON public.tender_events(opportunity_id, event_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tender_events TO authenticated;
GRANT ALL ON public.tender_events TO service_role;
ALTER TABLE public.tender_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tender_events_select_member" ON public.tender_events FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));
CREATE POLICY "tender_events_insert_member" ON public.tender_events FOR INSERT TO authenticated
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "tender_events_update_member" ON public.tender_events FOR UPDATE TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));
CREATE POLICY "tender_events_delete_admin" ON public.tender_events FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

CREATE TRIGGER tender_events_set_updated_at BEFORE UPDATE ON public.tender_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
