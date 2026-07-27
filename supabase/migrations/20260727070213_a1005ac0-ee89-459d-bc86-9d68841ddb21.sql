-- P-195 — allow "portal" as an AR reminder channel (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ar_reminder_channel' AND e.enumlabel = 'portal'
  ) THEN
    ALTER TYPE public.ar_reminder_channel ADD VALUE 'portal';
  END IF;
END
$$;