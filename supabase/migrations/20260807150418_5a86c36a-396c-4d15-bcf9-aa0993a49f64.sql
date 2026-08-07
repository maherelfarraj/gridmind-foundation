-- GC-11b — strip inherited default privileges on the scenario tables.

revoke all on public.portfolio_scenarios from anon, authenticated, public;
revoke all on public.portfolio_scenario_assumptions from anon, authenticated, public;
revoke all on public.portfolio_scenario_events from anon, authenticated, public;

grant select, insert, update, delete on public.portfolio_scenarios to authenticated;
grant select, insert, update, delete on public.portfolio_scenario_assumptions to authenticated;
grant select, insert on public.portfolio_scenario_events to authenticated;

grant all on public.portfolio_scenarios to service_role;
grant all on public.portfolio_scenario_assumptions to service_role;
grant all on public.portfolio_scenario_events to service_role;
