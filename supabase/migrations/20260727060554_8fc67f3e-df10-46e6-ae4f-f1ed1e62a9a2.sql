revoke all on function public.submit_change_request(uuid) from public, anon;
revoke all on function public.transition_change_request(uuid, text, jsonb) from public, anon;
revoke all on function public.assign_cr_number() from public, anon, authenticated;
revoke all on function public.audit_cr_status() from public, anon, authenticated;
revoke all on function public.guard_cr_status() from public, anon, authenticated;
grant execute on function public.submit_change_request(uuid) to authenticated;
grant execute on function public.transition_change_request(uuid, text, jsonb) to authenticated;