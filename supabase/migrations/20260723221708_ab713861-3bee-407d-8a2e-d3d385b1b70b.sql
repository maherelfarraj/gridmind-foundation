create or replace function public.create_invite(
  p_company_id uuid, p_email text, p_role public.app_role
) returns text language plpgsql security definer
set search_path = public as $$
declare v_token text;
begin
  if not (public.is_company_admin(p_company_id) or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'forbidden: only company_admin can invite';
  end if;
  if p_role = 'super_admin' and not public.has_role(auth.uid(),'super_admin') then
    raise exception 'forbidden: cannot invite super_admin';
  end if;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.invites (company_id, email, role, token_hash, invited_by)
  values (p_company_id, lower(p_email), p_role,
          encode(sha256(v_token::bytea), 'hex'), auth.uid());
  perform public.write_audit_log('invite.created','invites', null,
    jsonb_build_object('email', lower(p_email), 'role', p_role::text));
  return v_token;
end;
$$;
revoke all on function public.create_invite(uuid, text, public.app_role) from anon;
grant execute on function public.create_invite(uuid, text, public.app_role) to authenticated;