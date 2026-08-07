-- GC-10b — Portfolio finance alerts: least-privilege grants.
REVOKE ALL ON public.portfolio_alerts FROM anon, PUBLIC;
REVOKE ALL ON public.portfolio_alert_configs FROM anon, PUBLIC;
REVOKE ALL ON public.portfolio_alert_events FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE ON public.portfolio_alerts TO authenticated;
GRANT ALL ON public.portfolio_alerts TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portfolio_alert_configs TO authenticated;
GRANT ALL ON public.portfolio_alert_configs TO service_role;

-- Lifecycle history is append-only: no UPDATE, no DELETE for app users.
GRANT SELECT, INSERT ON public.portfolio_alert_events TO authenticated;
GRANT ALL ON public.portfolio_alert_events TO service_role;