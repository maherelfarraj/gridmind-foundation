ALTER TABLE public.project_sld_config
  ADD COLUMN IF NOT EXISTS bus_config text DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS metering_points jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS protection_scheme text,
  ADD COLUMN IF NOT EXISTS notes text;