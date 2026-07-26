revoke all on public.scada_events from anon;
revoke update, delete, truncate on public.scada_events from authenticated;
grant select, insert on public.scada_events to authenticated;