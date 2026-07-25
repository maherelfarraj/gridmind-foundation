alter table public.api_keys
  add column if not exists allowed_ips text[] not null default '{}',
  add column if not exists hmac_secret text;

drop function if exists public.verify_api_key(text);

create or replace function public.verify_api_key(p_raw_key text)
returns table(
  key_id uuid,
  company_id uuid,
  scopes text[],
  allowed_ips text[],
  hmac_secret text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_raw_key is null or length(p_raw_key) = 0 then
    return;
  end if;

  v_hash := encode(digest(p_raw_key, 'sha256'), 'hex');

  return query
  update public.api_keys ak
     set last_used_at = now()
   where ak.key_hash = v_hash
     and ak.revoked_at is null
     and (ak.expires_at is null or ak.expires_at > now())
  returning ak.id, ak.company_id, ak.scopes, ak.allowed_ips, ak.hmac_secret;
end;
$$;

revoke all on function public.verify_api_key(text) from public;
grant execute on function public.verify_api_key(text) to anon;
grant execute on function public.verify_api_key(text) to authenticated;
grant execute on function public.verify_api_key(text) to service_role;