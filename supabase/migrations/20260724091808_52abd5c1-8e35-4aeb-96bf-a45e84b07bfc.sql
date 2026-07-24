
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address text;

CREATE TABLE IF NOT EXISTS public.company_branding (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  logo_url text,
  primary_color text DEFAULT '#1e40af',
  accent_color text DEFAULT '#0d9488',
  footer_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_branding TO authenticated;
GRANT ALL ON public.company_branding TO service_role;

ALTER TABLE public.company_branding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members read branding" ON public.company_branding;
CREATE POLICY "members read branding" ON public.company_branding
  FOR SELECT TO authenticated USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "admins write branding" ON public.company_branding;
CREATE POLICY "admins write branding" ON public.company_branding
  FOR ALL TO authenticated
  USING (public.has_company_role('company_admin'))
  WITH CHECK (public.has_company_role('company_admin'));

DROP TRIGGER IF EXISTS trg_updated_at ON public.company_branding;
CREATE TRIGGER trg_updated_at BEFORE UPDATE ON public.company_branding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
