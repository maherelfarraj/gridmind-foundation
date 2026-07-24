-- P-057: BOM v1 tables
CREATE TABLE public.bom_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','released','superseded')),
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX bom_snapshots_project_version_idx
  ON public.bom_snapshots(project_id, version DESC);
CREATE INDEX bom_snapshots_company_idx
  ON public.bom_snapshots(company_id);

CREATE TABLE public.bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.bom_snapshots(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('modules','inverters','bos','cables','structures','transformers','other')),
  item text NOT NULL,
  spec text,
  unit text NOT NULL DEFAULT 'ea',
  qty numeric NOT NULL DEFAULT 0,
  buffer_pct numeric NOT NULL DEFAULT 0,
  qty_buffered numeric NOT NULL DEFAULT 0,
  unit_cost numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bom_lines_snapshot_idx ON public.bom_lines(snapshot_id);
CREATE INDEX bom_lines_company_idx ON public.bom_lines(company_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bom_snapshots TO authenticated;
GRANT ALL ON public.bom_snapshots TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bom_lines TO authenticated;
GRANT ALL ON public.bom_lines TO service_role;

ALTER TABLE public.bom_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_lines ENABLE ROW LEVEL SECURITY;

-- bom_snapshots policies
CREATE POLICY "bom_snapshots_select_members"
  ON public.bom_snapshots FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY "bom_snapshots_insert_engineering"
  ON public.bom_snapshots FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'engineer')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "bom_snapshots_update_engineering"
  ON public.bom_snapshots FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'engineer')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  )
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "bom_snapshots_delete_admins"
  ON public.bom_snapshots FOR DELETE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

-- bom_lines policies (mirror parent snapshot access)
CREATE POLICY "bom_lines_select_members"
  ON public.bom_lines FOR SELECT TO authenticated
  USING (public.is_company_member(company_id));

CREATE POLICY "bom_lines_insert_engineering"
  ON public.bom_lines FOR INSERT TO authenticated
  WITH CHECK (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'engineer')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "bom_lines_update_engineering"
  ON public.bom_lines FOR UPDATE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'engineer')
      OR public.has_role(auth.uid(), 'project_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  )
  WITH CHECK (public.is_company_member(company_id));

CREATE POLICY "bom_lines_delete_admins"
  ON public.bom_lines FOR DELETE TO authenticated
  USING (
    public.is_company_member(company_id)
    AND (
      public.has_role(auth.uid(), 'engineering_admin')
      OR public.has_role(auth.uid(), 'company_admin')
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE TRIGGER bom_snapshots_set_updated_at
  BEFORE UPDATE ON public.bom_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER bom_lines_set_updated_at
  BEFORE UPDATE ON public.bom_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();