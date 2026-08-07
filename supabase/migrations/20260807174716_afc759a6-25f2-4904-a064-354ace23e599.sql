-- GC-13b — cash flow least privilege, append-only events, liquidity alert families.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'cashflow_settings','cashflow_snapshots','cashflow_snapshot_lines',
    'cashflow_exceptions','cashflow_adjustments','funding_facilities','funding_allocations'
  ] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM authenticated, anon, PUBLIC', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

REVOKE ALL ON public.cashflow_events FROM authenticated, anon, PUBLIC;
GRANT SELECT, INSERT ON public.cashflow_events TO authenticated;
GRANT ALL ON public.cashflow_events TO service_role;

REVOKE ALL ON FUNCTION public.cashflow_snapshots_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cashflow_adjustments_guard() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cashflow_events_append_only() FROM PUBLIC, anon, authenticated, service_role;

ALTER TYPE public.portfolio_alert_rule_type ADD VALUE IF NOT EXISTS 'liquidity_shortfall';
ALTER TYPE public.portfolio_alert_rule_type ADD VALUE IF NOT EXISTS 'funding_headroom';
ALTER TYPE public.portfolio_alert_rule_type ADD VALUE IF NOT EXISTS 'covenant_breach';