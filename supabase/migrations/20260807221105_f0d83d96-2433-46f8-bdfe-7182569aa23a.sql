-- GC-16b — least-privilege grants for the contract & claims bundle.
-- RLS policies already scope every row to the caller's company; these grants
-- remove the blanket privileges the tables were created with.

REVOKE ALL ON public.contract_claims FROM anon, PUBLIC;
REVOKE ALL ON public.contract_claim_events FROM anon, PUBLIC;
REVOKE ALL ON public.contract_claim_valuations FROM anon, PUBLIC;
REVOKE ALL ON public.contract_deadlines FROM anon, PUBLIC;
REVOKE ALL ON public.contract_claim_snapshots FROM anon, PUBLIC;
REVOKE ALL ON public.contract_claim_snapshot_lines FROM anon, PUBLIC;
REVOKE ALL ON public.contract_claim_alerts FROM anon, PUBLIC;

REVOKE ALL ON public.contract_claims FROM authenticated;
REVOKE ALL ON public.contract_claim_events FROM authenticated;
REVOKE ALL ON public.contract_claim_valuations FROM authenticated;
REVOKE ALL ON public.contract_deadlines FROM authenticated;
REVOKE ALL ON public.contract_claim_snapshots FROM authenticated;
REVOKE ALL ON public.contract_claim_snapshot_lines FROM authenticated;
REVOKE ALL ON public.contract_claim_alerts FROM authenticated;

-- Claims: create / amend / withdraw a draft; policies gate status + role.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_claims TO authenticated;

-- Event log: append-only audit trail.
GRANT SELECT, INSERT ON public.contract_claim_events TO authenticated;

-- Valuations: append-only; a correction is a new valuation_no.
GRANT SELECT, INSERT ON public.contract_claim_valuations TO authenticated;

-- Deadlines: maintained in place, never deleted.
GRANT SELECT, INSERT, UPDATE ON public.contract_deadlines TO authenticated;

-- Snapshots: rebuildable while working; policies forbid touching approved ones.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_claim_snapshots TO authenticated;

-- Snapshot lines: immutable values; a rebuild clears and re-inserts them.
GRANT SELECT, INSERT, DELETE ON public.contract_claim_snapshot_lines TO authenticated;

-- Alerts: acknowledged / snoozed / escalated / resolved in place.
GRANT SELECT, INSERT, UPDATE ON public.contract_claim_alerts TO authenticated;

GRANT ALL ON public.contract_claims TO service_role;
GRANT ALL ON public.contract_claim_events TO service_role;
GRANT ALL ON public.contract_claim_valuations TO service_role;
GRANT ALL ON public.contract_deadlines TO service_role;
GRANT ALL ON public.contract_claim_snapshots TO service_role;
GRANT ALL ON public.contract_claim_snapshot_lines TO service_role;
GRANT ALL ON public.contract_claim_alerts TO service_role;