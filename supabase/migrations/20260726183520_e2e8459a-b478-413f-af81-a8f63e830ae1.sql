revoke all on public.ea_protection_devices from authenticated;
revoke all on public.ea_relay_settings from authenticated;
revoke all on public.ea_grid_code_templates from authenticated;
revoke all on public.ea_grid_code_responses from authenticated;
revoke all on public.ea_protection_devices from anon;
revoke all on public.ea_relay_settings from anon;
revoke all on public.ea_grid_code_templates from anon;
revoke all on public.ea_grid_code_responses from anon;

grant select, insert, update on public.ea_protection_devices to authenticated;
grant select, insert on public.ea_relay_settings to authenticated;
grant select, insert, update on public.ea_grid_code_templates to authenticated;
grant select, insert, update on public.ea_grid_code_responses to authenticated;
grant all on public.ea_protection_devices to service_role;
grant all on public.ea_relay_settings to service_role;
grant all on public.ea_grid_code_templates to service_role;
grant all on public.ea_grid_code_responses to service_role;