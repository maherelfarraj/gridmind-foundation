create or replace function public.has_role(p_user_id uuid, p_role public.app_role)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = p_user_id and role = p_role
  );
$$;

create or replace function public.has_company_role(p_role public.app_role)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = p_role
      and ur.company_id = coalesce(
        nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid,
        (select p.company_id from public.profiles p where p.id = auth.uid())
      )
  );
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.company_id = p_company_id
  );
$$;

create or replace function public.assert_can_grant_role(
  p_target_user_id uuid, p_company_id uuid, p_role public.app_role
) returns void language plpgsql security definer
set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_role = 'super_admin' and not public.has_role(auth.uid(), 'super_admin') then
    raise exception 'forbidden: only super_admin can grant super_admin';
  end if;
  if not (
    public.has_role(auth.uid(), 'super_admin')
    or exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.company_id = p_company_id
        and ur.role = 'company_admin'
    )
  ) then
    raise exception 'forbidden: actor is not company_admin of this company';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_target_user_id and p.company_id = p_company_id
  ) then
    raise exception 'forbidden: cross-company role grant blocked';
  end if;
end;
$$;

revoke all on function public.has_role(uuid, public.app_role) from anon;
revoke all on function public.has_company_role(public.app_role) from anon;
revoke all on function public.is_company_member(uuid) from anon;
revoke all on function public.assert_can_grant_role(uuid, uuid, public.app_role) from anon;

grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;
grant execute on function public.has_company_role(public.app_role) to authenticated, service_role;
grant execute on function public.is_company_member(uuid) to authenticated, service_role;
grant execute on function public.assert_can_grant_role(uuid, uuid, public.app_role) to authenticated, service_role;