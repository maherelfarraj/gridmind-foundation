-- 1) create_invite gains optional vendor linkage; vendor_viewer invites REQUIRE it.
drop function if exists public.create_invite(uuid, text, app_role);

create or replace function public.create_invite(
  p_company_id uuid,
  p_email text,
  p_role app_role,
  p_vendor_id uuid default null
)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_token text;
  v_invite_id uuid;
  v_email text := lower(p_email);
begin
  if not (public.is_company_admin(p_company_id) or public.has_role(auth.uid(),'super_admin')) then
    raise exception 'forbidden: only company_admin can invite';
  end if;
  if p_role = 'super_admin' and not public.has_role(auth.uid(),'super_admin') then
    raise exception 'forbidden: cannot invite super_admin';
  end if;

  if p_role = 'vendor_viewer' then
    if p_vendor_id is null then
      raise exception 'create_invite: vendor_viewer invites require a vendor (use the vendor portal invite flow)'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.vendors v
      where v.id = p_vendor_id and v.company_id = p_company_id
    ) then
      raise exception 'create_invite: vendor not found in this company' using errcode = 'P0002';
    end if;
  elsif p_vendor_id is not null then
    raise exception 'create_invite: vendor linkage is only valid for vendor_viewer invites'
      using errcode = '22023';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.invites (company_id, email, role, token_hash, invited_by)
  values (p_company_id, v_email, p_role,
          encode(digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_invite_id;

  if p_role = 'vendor_viewer' then
    insert into public.vendor_portal_memberships
      (company_id, vendor_id, email, status, invite_id, invited_by, expires_at)
    values (p_company_id, p_vendor_id, v_email, 'invited', v_invite_id, auth.uid(), now() + interval '7 days')
    on conflict (company_id, vendor_id, email) do update
      set invite_id = excluded.invite_id,
          invited_by = excluded.invited_by,
          expires_at = excluded.expires_at,
          status = case when public.vendor_portal_memberships.status = 'active'
                        then public.vendor_portal_memberships.status
                        else 'invited'::vendor_portal_status end,
          updated_at = now();
  end if;

  perform public.write_audit_log('invite.created','invites', v_invite_id,
    jsonb_build_object('email', v_email, 'role', p_role::text,
                       'company_id', p_company_id, 'vendor_id', p_vendor_id));
  return v_token;
end;
$function$;

revoke all on function public.create_invite(uuid, text, app_role, uuid) from public, anon;
grant execute on function public.create_invite(uuid, text, app_role, uuid) to authenticated, service_role;

-- 2) redeem_invite activates the vendor portal membership.
create or replace function public.redeem_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_actor uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_hash text;
  v_invite public.invites%rowtype;
  v_membership_id uuid;
begin
  if v_actor is null then
    raise exception 'redeem_invite: no authenticated user' using errcode = '28000';
  end if;

  if p_token is null or length(p_token) = 0 then
    raise exception 'redeem_invite: missing token' using errcode = '22023';
  end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_invite
  from public.invites
  where token_hash = v_hash
  for update;

  if not found then
    raise exception 'redeem_invite: invalid invite' using errcode = 'P0002';
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'redeem_invite: invite is not pending (status=%)', v_invite.status
      using errcode = 'P0001';
  end if;

  if v_invite.expires_at <= now() then
    update public.invites
       set status = 'expired', updated_at = now()
     where id = v_invite.id;
    raise exception 'redeem_invite: invite expired' using errcode = 'P0001';
  end if;

  if v_email is null or lower(v_email) <> lower(v_invite.email::text) then
    raise exception 'redeem_invite: invite is not for this account'
      using errcode = '42501';
  end if;

  insert into public.profiles (id, company_id, email)
  values (v_actor, v_invite.company_id, v_email)
  on conflict (id) do update
    set company_id = excluded.company_id,
        email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();

  insert into public.user_roles (user_id, company_id, role)
  values (v_actor, v_invite.company_id, v_invite.role)
  on conflict (user_id, company_id, role) do nothing;

  -- Vendor contacts MUST end up with an active portal membership.
  if v_invite.role = 'vendor_viewer' then
    update public.vendor_portal_memberships m
       set user_id = v_actor,
           status = 'active',
           accepted_at = coalesce(m.accepted_at, now()),
           updated_at = now()
     where m.company_id = v_invite.company_id
       and lower(m.email) = lower(v_invite.email::text)
       and (m.invite_id = v_invite.id or m.invite_id is null or m.user_id is null or m.user_id = v_actor)
    returning m.id into v_membership_id;

    if v_membership_id is null then
      raise exception 'redeem_invite: vendor invite has no vendor portal membership — re-issue it from the vendor portal invite flow'
        using errcode = 'P0001';
    end if;
  end if;

  update public.invites
     set status = 'accepted',
         accepted_at = now(),
         accepted_by = v_actor,
         updated_at = now()
   where id = v_invite.id;

  perform public.write_audit_log(
    'invite.accepted',
    'invites',
    v_invite.id,
    jsonb_build_object(
      'company_id', v_invite.company_id,
      'role', v_invite.role::text,
      'vendor_portal_membership_id', v_membership_id
    )
  );

  return v_invite.company_id;
end;
$function$;

revoke all on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated, service_role;