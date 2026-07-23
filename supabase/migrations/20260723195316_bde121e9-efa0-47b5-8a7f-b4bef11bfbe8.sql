-- has_role(user_id, role)
create or replace function public.has_role(user_id uuid, role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = has_role.user_id
      and ur.role    = has_role.role
  );
$$;

-- has_company_role(role) — resolves company from JWT app_metadata.company_id, falls back to profiles
create or replace function public.has_company_role(role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role    = has_company_role.role
      and ur.company_id = coalesce(
        nullif(((auth.jwt() -> 'app_metadata') ->> 'company_id'), '')::uuid,
        (select p.company_id from public.profiles p where p.id = auth.uid())
      )
  );
$$;

-- is_company_member(company_id)
create or replace function public.is_company_member(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid()
        and ur.company_id = is_company_member.company_id
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.company_id = is_company_member.company_id
    );
$$;

-- assert_can_grant_role(target_user_id, company_id, role) — validation only
create or replace function public.assert_can_grant_role(
  target_user_id uuid,
  company_id     uuid,
  role           public.app_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_company uuid;
begin
  select p.company_id into target_company
  from public.profiles p
  where p.id = assert_can_grant_role.target_user_id;

  if target_company is null then
    raise exception 'assert_can_grant_role: target user % has no profile', target_user_id
      using errcode = 'P0001';
  end if;

  if target_company <> assert_can_grant_role.company_id then
    raise exception 'assert_can_grant_role: cross-company grant blocked (target in %, requested %)',
      target_company, assert_can_grant_role.company_id
      using errcode = 'P0001';
  end if;

  if assert_can_grant_role.role = 'super_admin'::public.app_role
     and not public.has_role(auth.uid(), 'super_admin'::public.app_role) then
    raise exception 'assert_can_grant_role: only super_admin can grant super_admin'
      using errcode = 'P0001';
  end if;
end;
$$;

-- Privileges: read helpers + assert available to authenticated users and service role only
revoke execute on function public.has_role(uuid, public.app_role)                        from public, anon;
revoke execute on function public.has_company_role(public.app_role)                      from public, anon;
revoke execute on function public.is_company_member(uuid)                                from public, anon;
revoke execute on function public.assert_can_grant_role(uuid, uuid, public.app_role)     from public, anon;

grant  execute on function public.has_role(uuid, public.app_role)                        to authenticated, service_role;
grant  execute on function public.has_company_role(public.app_role)                      to authenticated, service_role;
grant  execute on function public.is_company_member(uuid)                                to authenticated, service_role;
grant  execute on function public.assert_can_grant_role(uuid, uuid, public.app_role)     to authenticated, service_role;