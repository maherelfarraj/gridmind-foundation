revoke all on function public.estimates_before_insert() from anon, authenticated, public;
revoke all on function public.estimates_block_delete() from anon, authenticated, public;
revoke all on function public.next_estimate_number(uuid, text) from anon, authenticated, public;