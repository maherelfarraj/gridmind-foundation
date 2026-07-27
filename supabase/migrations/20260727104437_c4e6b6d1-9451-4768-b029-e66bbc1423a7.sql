ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS notifications_bond_fingerprint_idx
  ON public.notifications ((metadata->>'bond_fingerprint'))
  WHERE metadata ? 'bond_fingerprint';

CREATE INDEX IF NOT EXISTS bond_instruments_expiry_idx
  ON public.bond_instruments (company_id, expiry_date)
  WHERE status IN ('active','expiring_soon');