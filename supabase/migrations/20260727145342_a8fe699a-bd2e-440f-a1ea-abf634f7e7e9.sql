revoke all on function public.timesheets_before_insert() from anon, authenticated, public;
revoke all on function public.leave_requests_before_insert() from anon, authenticated, public;
revoke all on function public.timesheets_guard_locked() from anon, authenticated, public;
revoke all on function public.next_timesheet_number(uuid, text) from anon, authenticated, public;