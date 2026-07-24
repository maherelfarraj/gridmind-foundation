
CREATE TABLE public.rfis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  rfi_number TEXT NOT NULL,
  subject TEXT NOT NULL,
  question TEXT NOT NULL,
  discipline public.drawing_discipline NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','answered','closed','void')),
  raised_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  routed_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  drawing_id UUID REFERENCES public.drawing_register(id) ON DELETE SET NULL,
  due_date DATE,
  answer TEXT,
  answered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  answered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  cost_impact BOOLEAN NOT NULL DEFAULT false,
  schedule_impact BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, rfi_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rfis TO authenticated;
GRANT ALL ON public.rfis TO service_role;

ALTER TABLE public.rfis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rfis_select_members" ON public.rfis
  FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY "rfis_insert_members" ON public.rfis
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND raised_by = auth.uid()
    AND created_by = auth.uid()
  );

CREATE POLICY "rfis_update_routed_or_admin" ON public.rfis
  FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      routed_to = auth.uid()
      OR raised_by = auth.uid()
      OR public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  )
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      routed_to = auth.uid()
      OR raised_by = auth.uid()
      OR public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "rfis_delete_admin" ON public.rfis
  FOR DELETE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE INDEX rfis_project_status_idx ON public.rfis (project_id, status);
CREATE INDEX rfis_routed_status_idx ON public.rfis (routed_to, status);
CREATE INDEX rfis_company_created_idx ON public.rfis (company_id, created_at DESC);

CREATE TRIGGER rfis_set_updated_at
  BEFORE UPDATE ON public.rfis
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
