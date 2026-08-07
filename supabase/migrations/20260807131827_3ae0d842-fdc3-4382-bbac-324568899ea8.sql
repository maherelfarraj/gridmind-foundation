-- GC-10c — alert history is append-only for app users.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.portfolio_alert_events FROM authenticated;
GRANT SELECT, INSERT ON public.portfolio_alert_events TO authenticated;
REVOKE DELETE, TRUNCATE ON public.portfolio_alerts FROM authenticated;