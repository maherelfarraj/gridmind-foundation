-- GC-16c — governed deadline calendar provenance.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS deadline_calendar_id text,
  ADD COLUMN IF NOT EXISTS deadline_timezone text;

ALTER TABLE public.costing_settings
  ADD COLUMN IF NOT EXISTS deadline_calendar_id text,
  ADD COLUMN IF NOT EXISTS deadline_timezone text;

ALTER TABLE public.contract_deadlines
  ADD COLUMN IF NOT EXISTS calendar_id text,
  ADD COLUMN IF NOT EXISTS calendar_version text,
  ADD COLUMN IF NOT EXISTS calendar_source text;

-- No historical rows exist; enforce provenance strictly from here on.
UPDATE public.contract_deadlines
   SET calendar_id = COALESCE(calendar_id, 'iso-std'),
       calendar_version = COALESCE(calendar_version, '2026.1'),
       calendar_source = COALESCE(calendar_source, 'system_default')
 WHERE calendar_id IS NULL OR calendar_version IS NULL OR calendar_source IS NULL;

ALTER TABLE public.contract_deadlines
  ALTER COLUMN calendar_id SET NOT NULL,
  ALTER COLUMN calendar_version SET NOT NULL,
  ALTER COLUMN calendar_source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_deadlines_calendar_id_chk') THEN
    ALTER TABLE public.contract_deadlines
      ADD CONSTRAINT contract_deadlines_calendar_id_chk
      CHECK (calendar_id IN ('iso-std','mena-jo','mena-gulf','mena-eg'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_deadlines_calendar_source_chk') THEN
    ALTER TABLE public.contract_deadlines
      ADD CONSTRAINT contract_deadlines_calendar_source_chk
      CHECK (calendar_source IN ('request','contract_policy','company_policy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_deadlines_calendar_version_chk') THEN
    ALTER TABLE public.contract_deadlines
      ADD CONSTRAINT contract_deadlines_calendar_version_chk
      CHECK (length(calendar_version) BETWEEN 1 AND 32);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_deadline_calendar_id_chk') THEN
    ALTER TABLE public.contracts
      ADD CONSTRAINT contracts_deadline_calendar_id_chk
      CHECK (deadline_calendar_id IS NULL OR deadline_calendar_id IN ('iso-std','mena-jo','mena-gulf','mena-eg'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'costing_settings_deadline_calendar_id_chk') THEN
    ALTER TABLE public.costing_settings
      ADD CONSTRAINT costing_settings_deadline_calendar_id_chk
      CHECK (deadline_calendar_id IS NULL OR deadline_calendar_id IN ('iso-std','mena-jo','mena-gulf','mena-eg'));
  END IF;
END
$$;

COMMENT ON COLUMN public.contract_deadlines.calendar_id IS 'GC-16c governed work calendar applied when the due date was computed.';
COMMENT ON COLUMN public.contract_deadlines.calendar_version IS 'GC-16c version of the governed calendar applied; preserves historical calculations.';
COMMENT ON COLUMN public.contract_deadlines.calendar_source IS 'GC-16c provenance of the calendar choice: request, contract_policy or company_policy.';