revoke execute on function public.finance_base_currency(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.payments_before_insert() from public, anon, authenticated;
grant execute on function public.finance_base_currency(uuid, uuid) to service_role;