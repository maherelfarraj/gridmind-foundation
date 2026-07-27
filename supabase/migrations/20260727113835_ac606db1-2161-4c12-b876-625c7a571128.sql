-- P-207 verification follow-up: enforce "no DELETE grants anywhere" and keep
-- gl_journal_entries strictly append-only at the grant level, not just via RLS.

revoke all on public.gl_counters from authenticated, anon;
grant all on public.gl_counters to service_role;

revoke all on public.gl_account_mappings from authenticated, anon;
grant select, insert, update on public.gl_account_mappings to authenticated;
grant all on public.gl_account_mappings to service_role;

revoke all on public.gl_export_runs from authenticated, anon;
grant select, insert, update on public.gl_export_runs to authenticated;
grant all on public.gl_export_runs to service_role;

revoke all on public.gl_journal_entries from authenticated, anon;
grant select, insert on public.gl_journal_entries to authenticated;
grant all on public.gl_journal_entries to service_role;