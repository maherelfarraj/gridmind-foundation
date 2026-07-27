revoke execute on function public.next_bond_number(uuid, text) from public, anon, authenticated;
revoke execute on function public.bond_instruments_before_insert() from public, anon, authenticated;
revoke execute on function public.bond_claims_before_insert() from public, anon, authenticated;