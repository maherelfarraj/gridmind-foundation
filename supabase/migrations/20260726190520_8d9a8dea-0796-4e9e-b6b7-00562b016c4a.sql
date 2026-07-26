-- P-171: SCADA asset hierarchy + tag dictionary (additive only)

-- 1) Asset hierarchy (additive columns on existing scada_assets)
ALTER TABLE public.scada_assets
  ADD COLUMN IF NOT EXISTS parent_asset_id uuid REFERENCES public.scada_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hierarchy_path text;

CREATE INDEX IF NOT EXISTS scada_assets_parent_idx ON public.scada_assets(parent_asset_id);

CREATE OR REPLACE FUNCTION public.scada_assets_hierarchy_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ancestor uuid;
  depth int := 0;
  parts text[] := ARRAY[]::text[];
  cur uuid;
  cur_key text;
BEGIN
  IF NEW.parent_asset_id IS NOT NULL THEN
    IF NEW.parent_asset_id = NEW.id THEN
      RAISE EXCEPTION 'scada_asset_parent_self';
    END IF;
    ancestor := NEW.parent_asset_id;
    WHILE ancestor IS NOT NULL LOOP
      depth := depth + 1;
      IF depth > 12 THEN
        RAISE EXCEPTION 'scada_asset_hierarchy_too_deep';
      END IF;
      IF ancestor = NEW.id THEN
        RAISE EXCEPTION 'scada_asset_hierarchy_cycle';
      END IF;
      SELECT parent_asset_id INTO ancestor FROM public.scada_assets WHERE id = ancestor;
    END LOOP;
  END IF;

  -- materialise readable path
  parts := ARRAY[NEW.asset_key];
  cur := NEW.parent_asset_id;
  depth := 0;
  WHILE cur IS NOT NULL AND depth < 12 LOOP
    SELECT asset_key, parent_asset_id INTO cur_key, cur FROM public.scada_assets WHERE id = cur;
    EXIT WHEN cur_key IS NULL;
    parts := array_prepend(cur_key, parts);
    depth := depth + 1;
  END LOOP;
  NEW.hierarchy_path := array_to_string(parts, '/');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scada_assets_hierarchy_guard ON public.scada_assets;
CREATE TRIGGER scada_assets_hierarchy_guard
  BEFORE INSERT OR UPDATE OF parent_asset_id, asset_key ON public.scada_assets
  FOR EACH ROW EXECUTE FUNCTION public.scada_assets_hierarchy_guard();

-- 2) Tag dictionary
CREATE TABLE IF NOT EXISTS public.scada_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scada_asset_id uuid REFERENCES public.scada_assets(id) ON DELETE CASCADE,
  tag_key text NOT NULL,
  name text NOT NULL,
  description text,
  metric text,
  unit text NOT NULL DEFAULT '',
  data_type text NOT NULL DEFAULT 'analog',
  scale_factor numeric NOT NULL DEFAULT 1,
  scale_offset numeric NOT NULL DEFAULT 0,
  deadband numeric NOT NULL DEFAULT 0,
  sample_interval_s integer NOT NULL DEFAULT 60,
  source_system text NOT NULL DEFAULT 'manual',
  source_address text,
  min_value numeric,
  max_value numeric,
  warn_low numeric,
  warn_high numeric,
  alarm_low numeric,
  alarm_high numeric,
  stale_after_s integer NOT NULL DEFAULT 900,
  frozen_after_samples integer NOT NULL DEFAULT 10,
  quality_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scada_tags_project_tag_key UNIQUE (project_id, tag_key),
  CONSTRAINT scada_tags_data_type_chk CHECK (data_type IN ('analog','digital','counter','string','enum')),
  CONSTRAINT scada_tags_source_chk CHECK (source_system IN ('manual','mqtt','opcua','modbus','historian_csv','api')),
  CONSTRAINT scada_tags_sample_chk CHECK (sample_interval_s > 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scada_tags TO authenticated;
GRANT ALL ON public.scada_tags TO service_role;

ALTER TABLE public.scada_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scada_tags_select" ON public.scada_tags
  FOR SELECT TO authenticated
  USING (is_company_member(company_id) AND NOT is_external_viewer());

CREATE POLICY "scada_tags_write" ON public.scada_tags
  FOR ALL TO authenticated
  USING (
    is_company_member(company_id) AND (
      has_company_role('om_admin'::app_role)
      OR has_company_role('scada_admin'::app_role)
      OR has_company_role('company_admin'::app_role)
    )
  )
  WITH CHECK (
    is_company_member(company_id) AND (
      has_company_role('om_admin'::app_role)
      OR has_company_role('scada_admin'::app_role)
      OR has_company_role('company_admin'::app_role)
    )
  );

CREATE TRIGGER scada_tags_set_updated_at
  BEFORE UPDATE ON public.scada_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS scada_tags_project_idx ON public.scada_tags(project_id, is_active);
CREATE INDEX IF NOT EXISTS scada_tags_asset_idx ON public.scada_tags(scada_asset_id);