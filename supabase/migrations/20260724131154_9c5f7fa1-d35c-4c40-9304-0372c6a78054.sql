
-- ============================================================
-- 0016_crm_core.sql — Canonical CRM domain (P-041)
-- Idempotent: safe to re-run.
-- ============================================================

-- 0. Reset any prior CRM tables from 0015_crm_core (all empty).
DROP TABLE IF EXISTS public.tender_events CASCADE;
DROP TABLE IF EXISTS public.contacts CASCADE;
DROP TABLE IF EXISTS public.opportunities CASCADE;
DROP TABLE IF EXISTS public.project_intake CASCADE;
DROP TABLE IF EXISTS public.leads CASCADE;
DROP TYPE IF EXISTS public.lead_status;
DROP TYPE IF EXISTS public.lead_source;
DROP TYPE IF EXISTS public.opportunity_stage;
DROP TYPE IF EXISTS public.contact_type;
DROP TYPE IF EXISTS public.tender_event_type;
DROP TYPE IF EXISTS public.project_intake_status;
DROP TYPE IF EXISTS public.project_intake_source;

-- 1. Enums (guarded).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='lead_source') THEN
    CREATE TYPE public.lead_source AS ENUM
      ('referral','inbound','outbound','event','partner','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='lead_status') THEN
    CREATE TYPE public.lead_status AS ENUM
      ('new','working','qualified','unqualified','converted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='opportunity_stage') THEN
    CREATE TYPE public.opportunity_stage AS ENUM
      ('prospecting','qualification','proposal','negotiation','won','lost');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='tender_event_type') THEN
    CREATE TYPE public.tender_event_type AS ENUM
      ('pre_bid_meeting','site_visit','qa_deadline','submission_deadline',
       'bid_opening','clarification','award_announcement','other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='project_intake_status') THEN
    CREATE TYPE public.project_intake_status AS ENUM
      ('new','in_review','accepted','rejected','converted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='project_intake_source') THEN
    CREATE TYPE public.project_intake_source AS ENUM
      ('manual','opportunity','api','other');
  END IF;
END $$;

-- =====================================================================
-- 2. leads
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  account_name text,
  email citext,
  phone text,
  source public.lead_source NOT NULL DEFAULT 'inbound',
  status public.lead_status NOT NULL DEFAULT 'new',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_company_status_idx ON public.leads(company_id, status);
CREATE INDEX IF NOT EXISTS leads_owner_idx ON public.leads(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_select_member" ON public.leads;
CREATE POLICY "leads_select_member" ON public.leads FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "leads_insert_sales_or_admin" ON public.leads;
CREATE POLICY "leads_insert_sales_or_admin" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "leads_update_sales_or_admin" ON public.leads;
CREATE POLICY "leads_update_sales_or_admin" ON public.leads FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "leads_delete_admin" ON public.leads;
CREATE POLICY "leads_delete_admin" ON public.leads FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 3. project_intake  (created before opportunities so we can wire the
--    converted_intake_id FK; source_opportunity_id FK is added after
--    opportunities exists)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.project_intake (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  archetype public.project_archetype,
  capacity_mw numeric,
  site_location text,
  offtaker text,
  target_cod date,
  status public.project_intake_status NOT NULL DEFAULT 'new',
  source public.project_intake_source NOT NULL DEFAULT 'manual',
  source_opportunity_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_intake_company_status_idx ON public.project_intake(company_id, status);
CREATE INDEX IF NOT EXISTS project_intake_source_opp_idx ON public.project_intake(source_opportunity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_intake TO authenticated;
GRANT ALL ON public.project_intake TO service_role;
ALTER TABLE public.project_intake ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_intake_select_member" ON public.project_intake;
CREATE POLICY "project_intake_select_member" ON public.project_intake FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "project_intake_insert_writers" ON public.project_intake;
CREATE POLICY "project_intake_insert_writers" ON public.project_intake FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'project_admin'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "project_intake_update_writers" ON public.project_intake;
CREATE POLICY "project_intake_update_writers" ON public.project_intake FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'project_admin'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'project_admin'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "project_intake_delete_admin" ON public.project_intake;
CREATE POLICY "project_intake_delete_admin" ON public.project_intake FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

DROP TRIGGER IF EXISTS project_intake_set_updated_at ON public.project_intake;
CREATE TRIGGER project_intake_set_updated_at BEFORE UPDATE ON public.project_intake
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 4. opportunities
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  name text NOT NULL,
  account_name text,
  archetype public.project_archetype,
  capacity_mw numeric,
  stage public.opportunity_stage NOT NULL DEFAULT 'prospecting',
  estimated_value numeric(18,2),
  currency_code text NOT NULL DEFAULT 'USD',
  probability int CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  expected_decision_date date,
  competitor text,
  loss_reason text,
  converted_intake_id uuid REFERENCES public.project_intake(id) ON DELETE SET NULL,
  won_at timestamptz,
  lost_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opportunities_company_stage_idx ON public.opportunities(company_id, stage);
CREATE INDEX IF NOT EXISTS opportunities_owner_idx ON public.opportunities(owner_id);
CREATE INDEX IF NOT EXISTS opportunities_lead_idx ON public.opportunities(lead_id);
CREATE INDEX IF NOT EXISTS opportunities_converted_intake_idx ON public.opportunities(converted_intake_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;
ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "opportunities_select_member" ON public.opportunities;
CREATE POLICY "opportunities_select_member" ON public.opportunities FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "opportunities_insert_sales_or_admin" ON public.opportunities;
CREATE POLICY "opportunities_insert_sales_or_admin" ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "opportunities_update_sales_or_admin" ON public.opportunities;
CREATE POLICY "opportunities_update_sales_or_admin" ON public.opportunities FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "opportunities_delete_admin" ON public.opportunities;
CREATE POLICY "opportunities_delete_admin" ON public.opportunities FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

DROP TRIGGER IF EXISTS opportunities_set_updated_at ON public.opportunities;
CREATE TRIGGER opportunities_set_updated_at BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Deferred FK: project_intake.source_opportunity_id -> opportunities.id
ALTER TABLE public.project_intake
  DROP CONSTRAINT IF EXISTS project_intake_source_opportunity_id_fkey;
ALTER TABLE public.project_intake
  ADD CONSTRAINT project_intake_source_opportunity_id_fkey
  FOREIGN KEY (source_opportunity_id)
  REFERENCES public.opportunities(id) ON DELETE SET NULL;

-- =====================================================================
-- 5. contacts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  title text,
  email citext,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contacts_parent_required CHECK (lead_id IS NOT NULL OR opportunity_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS contacts_opportunity_idx ON public.contacts(opportunity_id);
CREATE INDEX IF NOT EXISTS contacts_lead_idx ON public.contacts(lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_select_member" ON public.contacts;
CREATE POLICY "contacts_select_member" ON public.contacts FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "contacts_insert_sales_or_admin" ON public.contacts;
CREATE POLICY "contacts_insert_sales_or_admin" ON public.contacts FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "contacts_update_sales_or_admin" ON public.contacts;
CREATE POLICY "contacts_update_sales_or_admin" ON public.contacts FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "contacts_delete_admin" ON public.contacts;
CREATE POLICY "contacts_delete_admin" ON public.contacts FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

DROP TRIGGER IF EXISTS contacts_set_updated_at ON public.contacts;
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 6. tender_events
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.tender_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  event_type public.tender_event_type NOT NULL,
  title text NOT NULL,
  event_at timestamptz NOT NULL,
  location text,
  notes text,
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tender_events_opp_at_idx ON public.tender_events(opportunity_id, event_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tender_events TO authenticated;
GRANT ALL ON public.tender_events TO service_role;
ALTER TABLE public.tender_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tender_events_select_member" ON public.tender_events;
CREATE POLICY "tender_events_select_member" ON public.tender_events FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "tender_events_insert_sales_or_admin" ON public.tender_events;
CREATE POLICY "tender_events_insert_sales_or_admin" ON public.tender_events FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "tender_events_update_sales_or_admin" ON public.tender_events;
CREATE POLICY "tender_events_update_sales_or_admin" ON public.tender_events FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (public.has_role(auth.uid(),'sales'::app_role)
      OR public.has_role(auth.uid(),'company_admin'::app_role))
  );

DROP POLICY IF EXISTS "tender_events_delete_admin" ON public.tender_events;
CREATE POLICY "tender_events_delete_admin" ON public.tender_events FOR DELETE TO authenticated
  USING (public.is_company_admin(company_id));

DROP TRIGGER IF EXISTS tender_events_set_updated_at ON public.tender_events;
CREATE TRIGGER tender_events_set_updated_at BEFORE UPDATE ON public.tender_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
