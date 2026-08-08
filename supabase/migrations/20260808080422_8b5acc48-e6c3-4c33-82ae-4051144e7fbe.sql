-- GC-17b — least privilege hardening for governed risk & contingency drawdown.

REVOKE ALL ON public.risk_sim_runs FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.risk_contingency_events FROM authenticated, anon, PUBLIC;
REVOKE ALL ON public.risk_contingency_alerts FROM authenticated, anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE ON public.risk_sim_runs TO authenticated;
GRANT SELECT, INSERT ON public.risk_contingency_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.risk_contingency_alerts TO authenticated;

GRANT ALL ON public.risk_sim_runs TO service_role;
GRANT ALL ON public.risk_contingency_events TO service_role;
GRANT ALL ON public.risk_contingency_alerts TO service_role;

REVOKE ALL ON FUNCTION public.risk_sim_runs_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.risk_contingency_events_append_only() FROM PUBLIC, anon, authenticated;
