
-- 0006_invites.sql

create extension if not exists pgcrypto;
create extension if not exists citext;

-- 1. invite_status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'invite_status') then
    create type public.invite_status as enum ('pending','accepted','revoked','expired');
  end if;
end$$;

-- 2. invites table
create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email citext not null,
  role public.app_role not null,
  token_hash text not null unique,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  status public.invite_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists invites_one_pending_per_email
  on public.invites (company_id, email)
  where status = 'pending';

create index if not exists invites_company_id_idx on public.invites (company_id);
create index if not exists invites_email_status_idx on public.invites (email, status);

drop trigger if exists update_invites_updated_at on public.invites;
create trigger update_invites_updated_at
  before update on public.invites
  for each row execute function public.update_updated_at_column();

-- 3. GRANTs
revoke all on public.invites from anon, public;
grant select, insert, update, delete on public.invites to authenticated;
grant all on public.invites to service_role;

-- 4. RLS
alter table public.invites enable row level security;

drop policy if exists "invites_admin_select" on public.invites;
create policy "invites_admin_select" on public.invites
  for select to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "invites_self_select" on public.invites;
create policy "invites_self_select" on public.invites
  for select to authenticated
  using (
    status = 'pending'
    and expires_at > now()
    and email = ((auth.jwt() ->> 'email'))::citext
  );

drop policy if exists "invites_admin_insert" on public.invites;
create policy "invites_admin_insert" on public.invites
  for insert to authenticated
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "invites_admin_update" on public.invites;
create policy "invites_admin_update" on public.invites
  for update to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "invites_admin_delete" on public.invites;
create policy "invites_admin_delete" on public.invites
  for delete to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- 5. create_invite helper
create or replace function public.create_invite(
  p_company_id uuid,
  p_email citext,
  p_role public.app_role
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_token_text text;
  v_hash text;
  v_id uuid;
begin
  if v_actor is null then
    raise exception 'create_invite: no authenticated user' using errcode = '28000';
  end if;

  if not (
    public.is_company_admin(p_company_id)
    or public.has_role(v_actor, 'super_admin'::public.app_role)
  ) then
    raise exception 'create_invite: insufficient privilege for company %', p_company_id
      using errcode = '42501';
  end if;

  if p_role = 'super_admin'::public.app_role
     and not public.has_role(v_actor, 'super_admin'::public.app_role) then
    raise exception 'create_invite: only super_admin can grant super_admin'
      using errcode = '42501';
  end if;

  -- Expire stale pending invites so the partial unique index does not collide.
  update public.invites
     set status = 'expired', updated_at = now()
   where company_id = p_company_id
     and email = p_email
     and status = 'pending'
     and expires_at <= now();

  v_token_text := encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token_text, 'sha256'), 'hex');

  begin
    insert into public.invites (company_id, email, role, token_hash, invited_by)
    values (p_company_id, p_email, p_role, v_hash, v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'create_invite: a pending invite already exists for % in company %',
      p_email, p_company_id
      using errcode = '23505';
  end;

  perform public.write_audit_log(
    'invite.created',
    'invites',
    v_id,
    jsonb_build_object('email', p_email::text, 'role', p_role::text)
  );

  return v_token_text;
end;
$$;

revoke execute on function public.create_invite(uuid, citext, public.app_role) from public, anon;
grant execute on function public.create_invite(uuid, citext, public.app_role) to authenticated, service_role;

-- 6. redeem_invite helper
create or replace function public.redeem_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text := auth.jwt() ->> 'email';
  v_hash text;
  v_invite public.invites%rowtype;
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

  -- Upsert profile into the invite's company.
  insert into public.profiles (id, company_id, email)
  values (v_actor, v_invite.company_id, v_email)
  on conflict (id) do update
    set company_id = excluded.company_id,
        email = coalesce(excluded.email, public.profiles.email),
        updated_at = now();

  -- Grant the role.
  insert into public.user_roles (user_id, company_id, role)
  values (v_actor, v_invite.company_id, v_invite.role)
  on conflict (user_id, company_id, role) do nothing;

  -- Mark invite accepted.
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
      'role', v_invite.role::text
    )
  );

  return v_invite.company_id;
end;
$$;

revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated, service_role;
