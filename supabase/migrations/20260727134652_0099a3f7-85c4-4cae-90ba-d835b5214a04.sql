-- 0089_vendor_portal.sql — P-221 vendor portal foundation (idempotent)

-- 1) Role enum extension. Never referenced as an enum literal in this migration.
do $$
begin
  alter type public.app_role add value if not exists 'vendor_viewer';
exception when duplicate_object then null;
end $$;

-- 2) Widen external-viewer helper (text comparisons only).
create or replace function public.is_external_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text in ('client_viewer','investor_viewer','lender_viewer','vendor_viewer')
  );
$function$;

revoke all on function public.is_external_viewer() from public, anon;
grant execute on function public.is_external_viewer() to authenticated, service_role;

-- 3) Guarded enums
do $$ begin
  create type public.vendor_portal_status as enum ('invited','active','suspended','revoked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.vendor_portal_actor as enum ('vendor','internal','system');
exception when duplicate_object then null; end $$;

-- 4) vendor_portal_memberships
create table if not exists public.vendor_portal_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null,
  email text not null,
  user_id uuid references public.profiles(id) on delete set null,
  status public.vendor_portal_status not null default 'invited',
  exposure jsonb not null default
    '{"pos":true,"deliveries":true,"invoices":true,"documents":true,"scorecard":false}'::jsonb,
  invite_id uuid,
  invited_by uuid,
  expires_at timestamptz,
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if to_regclass('public.vendors') is not null
     and not exists (select 1 from pg_constraint where conname = 'vendor_portal_memberships_vendor_fk')
  then
    alter table public.vendor_portal_memberships
      add constraint vendor_portal_memberships_vendor_fk
      foreign key (vendor_id) references public.vendors(id) on delete cascade;
  end if;
  if to_regclass('public.invites') is not null
     and not exists (select 1 from pg_constraint where conname = 'vendor_portal_memberships_invite_fk')
  then
    alter table public.vendor_portal_memberships
      add constraint vendor_portal_memberships_invite_fk
      foreign key (invite_id) references public.invites(id) on delete set null;
  end if;
end $$;

create unique index if not exists vendor_portal_memberships_uk
  on public.vendor_portal_memberships (company_id, vendor_id, email);
create index if not exists vendor_portal_memberships_user_idx
  on public.vendor_portal_memberships (user_id);

grant select, insert, update, delete on public.vendor_portal_memberships to authenticated;
grant all on public.vendor_portal_memberships to service_role;
alter table public.vendor_portal_memberships enable row level security;

drop policy if exists vendor_portal_memberships_select on public.vendor_portal_memberships;
create policy vendor_portal_memberships_select on public.vendor_portal_memberships
  for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_company_member(company_id) and not public.is_external_viewer())
  );

drop policy if exists vendor_portal_memberships_write on public.vendor_portal_memberships;
create policy vendor_portal_memberships_write on public.vendor_portal_memberships
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  );

drop trigger if exists vendor_portal_memberships_touch on public.vendor_portal_memberships;
create trigger vendor_portal_memberships_touch
  before update on public.vendor_portal_memberships
  for each row execute function public.set_updated_at();

-- 5) vendor_portal_events (append-only, RPC-only writes)
create table if not exists public.vendor_portal_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_type public.vendor_portal_actor not null default 'vendor',
  actor_id uuid,
  membership_id uuid references public.vendor_portal_memberships(id) on delete set null,
  vendor_id uuid,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists vendor_portal_events_company_idx
  on public.vendor_portal_events (company_id, created_at desc);
create index if not exists vendor_portal_events_vendor_idx
  on public.vendor_portal_events (vendor_id, created_at desc);

revoke all on public.vendor_portal_events from authenticated, anon;
grant select on public.vendor_portal_events to authenticated;
grant all on public.vendor_portal_events to service_role;
alter table public.vendor_portal_events enable row level security;

drop policy if exists vendor_portal_events_select on public.vendor_portal_events;
create policy vendor_portal_events_select on public.vendor_portal_events
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('procurement_admin'::public.app_role)
         or public.has_company_role('company_admin'::public.app_role))
  );
-- No INSERT / UPDATE / DELETE policies: writes happen only via SECURITY DEFINER RPCs.

-- 6) Portal RPCs
create or replace function public.vendor_portal_assert_access(p_vendor_id uuid)
returns public.vendor_portal_memberships
language plpgsql
security definer
set search_path = public
as $function$
declare v_row public.vendor_portal_memberships;
begin
  select * into v_row
  from public.vendor_portal_memberships m
  where m.vendor_id = p_vendor_id
    and m.user_id = auth.uid()
    and m.status::text = 'active'
    and (m.expires_at is null or m.expires_at > now())
  limit 1;

  if v_row.id is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  update public.vendor_portal_memberships
     set last_seen_at = now()
   where id = v_row.id;

  return v_row;
end $function$;

create or replace function public.vendor_portal_get_pos(p_vendor_id uuid)
returns table (
  id uuid,
  po_number text,
  status text,
  currency_code text,
  issued_at timestamptz,
  required_by_date date,
  total_amount numeric,
  lines jsonb
)
language plpgsql
security definer
set search_path = public
as $function$
declare v_m public.vendor_portal_memberships;
begin
  v_m := public.vendor_portal_assert_access(p_vendor_id);

  if coalesce((v_m.exposure->>'pos')::boolean, false) is not true then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  return query
  select po.id,
         po.po_number,
         po.status::text,
         po.currency_code,
         po.issued_at,
         po.required_by_date,
         po.total_amount,
         coalesce(po.lines, '[]'::jsonb)
  from public.purchase_orders po
  where po.vendor_id = p_vendor_id
    and po.company_id = v_m.company_id
    and po.status::text in
      ('issued','partially_received','received','closed')
  order by po.issued_at desc nulls last, po.created_at desc;
end $function$;

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
    -- Internal path: caller must belong to the company being written to.
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

revoke all on function public.vendor_portal_assert_access(uuid) from public, anon;
revoke all on function public.vendor_portal_get_pos(uuid) from public, anon;
revoke all on function public.vendor_portal_write_event(uuid, text, jsonb, text, text, uuid) from public, anon;
grant execute on function public.vendor_portal_assert_access(uuid) to authenticated, service_role;
grant execute on function public.vendor_portal_get_pos(uuid) to authenticated, service_role;
grant execute on function public.vendor_portal_write_event(uuid, text, jsonb, text, text, uuid) to authenticated, service_role;