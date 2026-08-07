-- GC-12b — EVM legacy/current privilege hardening. Idempotent.

-- 1) Legacy evm_snapshots: strip inherited anon/PUBLIC + over-broad authenticated grants.
REVOKE ALL ON TABLE public.evm_snapshots FROM PUBLIC;
REVOKE ALL ON TABLE public.evm_snapshots FROM anon;
REVOKE ALL ON TABLE public.evm_snapshots FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.evm_snapshots TO authenticated;
GRANT ALL ON TABLE public.evm_snapshots TO service_role;

-- 2) Append-only immutability for snapshots and the EVM event log.
CREATE OR REPLACE FUNCTION public.evm_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  raise exception 'evm_append_only' using errcode = '42501';
end;
$$;

REVOKE ALL ON FUNCTION public.evm_append_only_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evm_append_only_guard() FROM anon;

DROP TRIGGER IF EXISTS trg_evm_snapshots_append_only ON public.evm_snapshots;
CREATE TRIGGER trg_evm_snapshots_append_only
  BEFORE UPDATE OR DELETE ON public.evm_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.evm_append_only_guard();

DROP TRIGGER IF EXISTS trg_evm_events_append_only ON public.evm_events;
CREATE TRIGGER trg_evm_events_append_only
  BEFORE UPDATE OR DELETE ON public.evm_events
  FOR EACH ROW EXECUTE FUNCTION public.evm_append_only_guard();

-- 3) Explicit least-privilege grants across the current EVM surface.
REVOKE ALL ON TABLE public.evm_settings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_mapping_versions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_mappings FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_reports FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_report_lines FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_progress_overrides FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_exceptions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.evm_events FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_mapping_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_mappings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_reports TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.evm_report_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evm_progress_overrides TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.evm_exceptions TO authenticated;
GRANT SELECT, INSERT ON public.evm_events TO authenticated;

GRANT ALL ON public.evm_settings TO service_role;
GRANT ALL ON public.evm_mapping_versions TO service_role;
GRANT ALL ON public.evm_mappings TO service_role;
GRANT ALL ON public.evm_reports TO service_role;
GRANT ALL ON public.evm_report_lines TO service_role;
GRANT ALL ON public.evm_progress_overrides TO service_role;
GRANT ALL ON public.evm_exceptions TO service_role;
GRANT ALL ON public.evm_events TO service_role;

-- 4) FX provenance table: drop TRUNCATE/REFERENCES/TRIGGER from ordinary users.
REVOKE ALL ON TABLE public.fx_rates FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.fx_rates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fx_rates TO authenticated;
GRANT ALL ON public.fx_rates TO service_role;

-- 5) EVM routines: no PUBLIC/anon execute, pinned search_path.
REVOKE ALL ON FUNCTION public.evm_reports_guard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.evm_mapping_versions_guard() FROM PUBLIC, anon;
ALTER FUNCTION public.evm_reports_guard() SET search_path = public;
ALTER FUNCTION public.evm_mapping_versions_guard() SET search_path = public;