-- P-125 — Webhook export framework: allowlist + raw signing secret store.

-- Per-company opt-in of which platform tables can be emitted as webhook events.
CREATE TABLE IF NOT EXISTS public.webhook_export_allowlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, table_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.webhook_export_allowlist TO authenticated;
GRANT ALL ON public.webhook_export_allowlist TO service_role;

CREATE INDEX IF NOT EXISTS webhook_export_allowlist_company_table_idx
  ON public.webhook_export_allowlist (company_id, table_name);

ALTER TABLE public.webhook_export_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhook_export_allowlist select company members" ON public.webhook_export_allowlist;
CREATE POLICY "webhook_export_allowlist select company members"
  ON public.webhook_export_allowlist FOR SELECT TO authenticated
  USING (is_company_member(company_id));

DROP POLICY IF EXISTS "webhook_export_allowlist insert company admins" ON public.webhook_export_allowlist;
CREATE POLICY "webhook_export_allowlist insert company admins"
  ON public.webhook_export_allowlist FOR INSERT TO authenticated
  WITH CHECK (is_company_admin(company_id));

DROP POLICY IF EXISTS "webhook_export_allowlist update company admins" ON public.webhook_export_allowlist;
CREATE POLICY "webhook_export_allowlist update company admins"
  ON public.webhook_export_allowlist FOR UPDATE TO authenticated
  USING (is_company_admin(company_id))
  WITH CHECK (is_company_admin(company_id));

DROP POLICY IF EXISTS "webhook_export_allowlist delete company admins" ON public.webhook_export_allowlist;
CREATE POLICY "webhook_export_allowlist delete company admins"
  ON public.webhook_export_allowlist FOR DELETE TO authenticated
  USING (is_company_admin(company_id));

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.webhook_export_allowlist
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Raw outbound signing secret. Sits beside webhook_endpoints — the endpoints
-- table only stores signing_secret_hash (for verification/display); the raw
-- secret needed to *sign* outbound deliveries lives here and is reachable
-- ONLY via service role (dispatcher).
CREATE TABLE IF NOT EXISTS public.webhook_endpoint_secrets (
  endpoint_id uuid PRIMARY KEY REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Grants: service_role only. Explicitly REVOKE from authenticated + anon in
-- case a default privilege ever slips through.
GRANT ALL ON public.webhook_endpoint_secrets TO service_role;
REVOKE ALL ON public.webhook_endpoint_secrets FROM authenticated;
REVOKE ALL ON public.webhook_endpoint_secrets FROM anon;
REVOKE ALL ON public.webhook_endpoint_secrets FROM PUBLIC;

CREATE INDEX IF NOT EXISTS webhook_endpoint_secrets_company_idx
  ON public.webhook_endpoint_secrets (company_id);

-- RLS enabled with NO policies for authenticated/anon → nothing reaches these
-- rows via PostgREST; service_role bypasses RLS by design.
ALTER TABLE public.webhook_endpoint_secrets ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.webhook_endpoint_secrets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();