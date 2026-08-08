-- GC-16e — least privilege for GC-16d governed calendar tables.
REVOKE ALL ON public.calendar_holiday_sets FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.calendar_holiday_dates FROM anon, authenticated, PUBLIC;
REVOKE ALL ON public.calendar_policy_changes FROM anon, authenticated, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_holiday_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_holiday_dates TO authenticated;
-- Policy change history is append-and-decide only: never deletable by an app caller.
GRANT SELECT, INSERT, UPDATE ON public.calendar_policy_changes TO authenticated;

GRANT ALL ON public.calendar_holiday_sets TO service_role;
GRANT ALL ON public.calendar_holiday_dates TO service_role;
GRANT ALL ON public.calendar_policy_changes TO service_role;