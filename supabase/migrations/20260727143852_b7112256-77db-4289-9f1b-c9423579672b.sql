create or replace function public.vendor_portal_write_event(
  p_vendor_id uuid,
  p_event text,
  p_metadata jsonb default '{}'::jsonb,
  p_ip text default null,
  p_user_agent text default null,
  p_company_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_m public.vendor_portal_memberships;
  v_company uuid;
  v_actor public.vendor_portal_actor;
  v_membership uuid;
  v_id uuid;
begin
  select * into v_m
  from public.vendor_portal_memberships m
  where m.vendor_id = p_vendor_id
    and m.user_id = auth.uid()
    and m.status::text = 'active'
    and (m.expires_at is null or m.expires_at > now())
  limit 1;

  if v_m.id is not null then
    -- Vendor path
    v_actor := 'vendor';
    v_company := v_m.company_id;
    v_membership := v_m.id;
  else
    -- Internal path: caller must be a non-external member of the company.
    if public.is_external_viewer() then
      raise exception 'vendor_portal_access_denied' using errcode = '42501';
    end if;
    v_company := coalesce(
      p_company_id,
      (select m2.company_id from public.vendor_portal_memberships m2
        where m2.vendor_id = p_vendor_id limit 1)
    );
    if v_company is null or not public.is_company_member(v_company) then
      raise exception 'vendor_portal_access_denied' using errcode = '42501';
    end if;
    v_actor := 'internal';
    v_membership := null;
  end if;

  insert into public.vendor_portal_events
    (company_id, actor_type, actor_id, membership_id, vendor_id, event, metadata, ip, user_agent)
  values
    (v_company, v_actor, auth.uid(), v_membership, p_vendor_id, p_event,
     coalesce(p_metadata, '{}'::jsonb), p_ip, p_user_agent)
  returning id into v_id;

  return v_id;
end $function$;

revoke all on function public.vendor_portal_write_event(uuid, text, jsonb, text, text, uuid) from public, anon;
grant execute on function public.vendor_portal_write_event(uuid, text, jsonb, text, text, uuid) to authenticated, service_role;