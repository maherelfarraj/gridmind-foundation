
-- 0054_portal_memberships.sql — P-114 portal core. Idempotent.

-- ============================================================================
-- 1. portal_memberships
-- ============================================================================
create table if not exists public.portal_memberships (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null,
  user_id uuid references public.profiles(id),
  email text not null,
  role public.app_role not null default 'client_viewer'
    check (role in ('client_viewer','investor_viewer','lender_viewer')),
  exposure jsonb not null default
    '{"milestones":true,"kpis":true,"photos":true,"documents":false,"financials":false,"tickets":true,"approvals":true}'::jsonb,
  status text not null default 'invited'
    check (status in ('invited','active','suspended','revoked')),
  invite_id uuid references public.invites(id),
  invited_by uuid references public.profiles(id),
  expires_at timestamptz,
  accepted_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, email)
);

do $$
begin
  if to_regclass('public.projects') is not null and not exists (
    select 1 from pg_constraint where conname = 'portal_memberships_project_fk'
  ) then
    alter table public.portal_memberships
      add constraint portal_memberships_project_fk
      foreign key (project_id) references public.projects(id);
  end if;
end $$;

-- ============================================================================
-- 2. portal_tickets
-- ============================================================================
create table if not exists public.portal_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null,
  membership_id uuid references public.portal_memberships(id),
  raised_by uuid references public.profiles(id),
  subject text not null,
  body text,
  category text not null default 'general',
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','resolved','closed')),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 3. portal_audit_events (new — guarded via to_regclass in RPCs)
-- ============================================================================
create table if not exists public.portal_audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null,
  membership_id uuid references public.portal_memberships(id),
  actor_id uuid,
  event text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists portal_audit_project_idx
  on public.portal_audit_events(company_id, project_id, created_at desc);
create index if not exists portal_audit_event_idx
  on public.portal_audit_events(event, created_at desc);

-- ============================================================================
-- 4. RLS + policies
-- ============================================================================
alter table public.portal_memberships enable row level security;
alter table public.portal_tickets     enable row level security;
alter table public.portal_audit_events enable row level security;

drop policy if exists memberships_select on public.portal_memberships;
create policy memberships_select on public.portal_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_company_member(company_id) and not public.is_external_viewer())
  );

drop policy if exists memberships_admin_write on public.portal_memberships;
create policy memberships_admin_write on public.portal_memberships for all to authenticated
  using (public.has_company_role('company_admin') or public.has_company_role('project_admin'))
  with check (public.has_company_role('company_admin') or public.has_company_role('project_admin'));

drop policy if exists tickets_select on public.portal_tickets;
create policy tickets_select on public.portal_tickets for select to authenticated
  using (
    raised_by = auth.uid()
    or (public.is_company_member(company_id) and not public.is_external_viewer())
  );

drop policy if exists tickets_insert on public.portal_tickets;
create policy tickets_insert on public.portal_tickets for insert to authenticated
  with check (
    raised_by = auth.uid()
    and public.is_company_member(company_id)
    and (
      not public.is_external_viewer()
      or exists (
        select 1 from public.portal_memberships m
        where m.company_id = portal_tickets.company_id
          and m.project_id = portal_tickets.project_id
          and m.user_id = auth.uid()
          and m.status = 'active'
          and (m.expires_at is null or m.expires_at > now())
      )
    )
  );

drop policy if exists tickets_update on public.portal_tickets;
create policy tickets_update on public.portal_tickets for update to authenticated
  using (
    public.has_company_role('company_admin')
    or public.has_company_role('project_admin')
    or public.has_company_role('om_admin')
  );

drop policy if exists audit_events_select on public.portal_audit_events;
create policy audit_events_select on public.portal_audit_events for select to authenticated
  using (
    public.is_company_member(company_id) and not public.is_external_viewer()
  );

-- audit_events writes only via SECURITY DEFINER RPCs (no INSERT policy for auth users).

-- ============================================================================
-- 5. Triggers / indexes / grants
-- ============================================================================
drop trigger if exists trg_memberships_updated on public.portal_memberships;
create trigger trg_memberships_updated before update on public.portal_memberships
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tickets_updated on public.portal_tickets;
create trigger trg_tickets_updated before update on public.portal_tickets
  for each row execute function public.set_updated_at();

create index if not exists memberships_user_idx    on public.portal_memberships(user_id, status);
create index if not exists memberships_project_idx on public.portal_memberships(company_id, project_id);
create index if not exists memberships_email_idx   on public.portal_memberships(lower(email), status);
create index if not exists tickets_project_idx     on public.portal_tickets(company_id, project_id, status);

grant select on public.portal_memberships, public.portal_tickets, public.portal_audit_events to authenticated;
grant insert, update on public.portal_tickets to authenticated;
grant insert, update, delete on public.portal_memberships to authenticated;
grant all on public.portal_memberships, public.portal_tickets, public.portal_audit_events to service_role;

-- ============================================================================
-- 6. Helper — log portal audit if table exists
-- ============================================================================
create or replace function public._portal_log(
  p_company_id uuid,
  p_project_id uuid,
  p_membership_id uuid,
  p_actor_id uuid,
  p_event text,
  p_metadata jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.portal_audit_events') is not null then
    insert into public.portal_audit_events
      (company_id, project_id, membership_id, actor_id, event, metadata)
    values
      (p_company_id, p_project_id, p_membership_id, p_actor_id, p_event, coalesce(p_metadata,'{}'::jsonb));
  end if;
end $$;

-- ============================================================================
-- 7. portal_assert_access
-- ============================================================================
create or replace function public.portal_assert_access(p_project_id uuid)
returns public.portal_memberships
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_row public.portal_memberships;
begin
  if auth.uid() is null then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  select *
    into v_row
  from public.portal_memberships
  where user_id = auth.uid()
    and project_id = p_project_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if not found then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  -- Stamp last_seen_at asynchronously via separate volatile helper is unnecessary;
  -- we do it here even though function is marked stable — Postgres allows the write
  -- because SECURITY DEFINER. We swap to a volatile wrapper for clarity.
  return v_row;
end $$;

-- Volatile wrapper that also stamps last_seen_at (the "stable" body above cannot
-- run UPDATE; we replace with a volatile version).
create or replace function public.portal_assert_access(p_project_id uuid)
returns public.portal_memberships
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.portal_memberships;
begin
  if auth.uid() is null then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  select *
    into v_row
  from public.portal_memberships
  where user_id = auth.uid()
    and project_id = p_project_id
    and status = 'active'
    and (expires_at is null or expires_at > now())
  limit 1;

  if not found then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  update public.portal_memberships
     set last_seen_at = now()
   where id = v_row.id;

  return v_row;
end $$;

-- ============================================================================
-- 8. portal_get_feed
-- ============================================================================
create or replace function public.portal_get_feed(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m       public.portal_memberships;
  v_project jsonb := '{}'::jsonb;
  v_out     jsonb;
  v_exposure jsonb;
begin
  v_m := public.portal_assert_access(p_project_id);
  v_exposure := v_m.exposure;

  if to_regclass('public.projects') is not null then
    select to_jsonb(t) into v_project
    from (
      select p.id, p.name, p.code, p.phase, p.status
      from public.projects p
      where p.id = p_project_id
    ) t;
  end if;

  v_out := jsonb_build_object(
    'membership_id', v_m.id,
    'project', coalesce(v_project, '{}'::jsonb),
    'exposure', v_exposure,
    'as_of', now()
  );

  -- milestones (project_phase_gates)
  if coalesce(v_exposure->>'milestones','false') = 'true'
     and to_regclass('public.project_phase_gates') is not null then
    v_out := v_out || jsonb_build_object(
      'milestones',
      coalesce((
        select jsonb_agg(to_jsonb(t) order by t.planned_date nulls last)
        from (
          select g.id, g.phase, g.status, g.planned_date, g.actual_date, g.notes
          from public.project_phase_gates g
          where g.project_id = p_project_id
        ) t
      ), '[]'::jsonb)
    );
  end if;

  -- kpis (latest evm_snapshots row)
  if coalesce(v_exposure->>'kpis','false') = 'true'
     and to_regclass('public.evm_snapshots') is not null then
    v_out := v_out || jsonb_build_object(
      'kpis',
      coalesce((
        select to_jsonb(t) from (
          select e.as_of_date, e.spi, e.cpi, e.pv, e.ev, e.ac, e.eac, e.etc
          from public.evm_snapshots e
          where e.project_id = p_project_id
          order by e.as_of_date desc
          limit 1
        ) t
      ), '{}'::jsonb)
    );
  end if;

  -- photos (site_photos) — curated fields only
  if coalesce(v_exposure->>'photos','false') = 'true'
     and to_regclass('public.site_photos') is not null then
    v_out := v_out || jsonb_build_object(
      'photos',
      coalesce((
        select jsonb_agg(to_jsonb(t) order by t.taken_at desc nulls last)
        from (
          select sp.id, sp.storage_path, sp.caption, sp.taken_at, sp.discipline
          from public.site_photos sp
          where sp.project_id = p_project_id
          order by sp.taken_at desc nulls last
          limit 200
        ) t
      ), '[]'::jsonb)
    );
  end if;

  -- documents and financials are scaffolded false in exposure defaults; leave out until wired.

  -- feed_viewed audit
  perform public._portal_log(
    v_m.company_id, p_project_id, v_m.id, auth.uid(),
    'portal.feed_viewed', '{}'::jsonb
  );

  return v_out;
end $$;

-- ============================================================================
-- 9. portal_raise_ticket
-- ============================================================================
create or replace function public.portal_raise_ticket(
  p_project_id uuid,
  p_subject text,
  p_body text,
  p_category text,
  p_priority text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m public.portal_memberships;
  v_id uuid;
begin
  if p_subject is null or length(btrim(p_subject)) = 0 then
    raise exception 'subject_required' using errcode = '22023';
  end if;
  if coalesce(p_priority,'normal') not in ('low','normal','high','urgent') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;

  v_m := public.portal_assert_access(p_project_id);

  if coalesce(v_m.exposure->>'tickets','false') <> 'true' then
    raise exception 'portal_exposure_denied' using errcode = '42501';
  end if;

  insert into public.portal_tickets
    (company_id, project_id, membership_id, raised_by, subject, body, category, priority)
  values
    (v_m.company_id, p_project_id, v_m.id, auth.uid(),
     btrim(p_subject), nullif(btrim(coalesce(p_body,'')),''),
     coalesce(nullif(btrim(coalesce(p_category,'')),''),'general'),
     coalesce(p_priority,'normal'))
  returning id into v_id;

  perform public._portal_log(
    v_m.company_id, p_project_id, v_m.id, auth.uid(),
    'portal.ticket_raised',
    jsonb_build_object('ticket_id', v_id, 'priority', p_priority, 'category', p_category)
  );

  return v_id;
end $$;

-- ============================================================================
-- 10. portal_decide_approval
-- ============================================================================
create or replace function public.portal_decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_comment text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval public.approvals%rowtype;
  v_instance public.approval_instances%rowtype;
  v_project_id uuid;
  v_m public.portal_memberships;
begin
  if auth.uid() is null then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select * into v_approval from public.approvals where id = p_approval_id;
  if not found then
    raise exception 'approval_not_found' using errcode = 'P0002';
  end if;
  if v_approval.approver_id <> auth.uid() then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  select * into v_instance from public.approval_instances where id = v_approval.instance_id;
  if not found then
    raise exception 'approval_instance_missing' using errcode = 'P0002';
  end if;

  -- Resolve project id from instance metadata or entity link
  v_project_id := nullif(v_instance.metadata->>'project_id','')::uuid;
  if v_project_id is null and v_instance.entity_type = 'project' then
    v_project_id := v_instance.entity_id;
  end if;

  if v_project_id is null then
    raise exception 'portal_access_denied' using errcode = '42501';
  end if;

  v_m := public.portal_assert_access(v_project_id);

  perform public.decide_approval(p_approval_id, p_decision, p_comment);

  perform public._portal_log(
    v_m.company_id, v_project_id, v_m.id, auth.uid(),
    'portal.approval_decided',
    jsonb_build_object('approval_id', p_approval_id, 'decision', p_decision, 'via', 'portal')
  );
end $$;

-- ============================================================================
-- 11. Execute grants
-- ============================================================================
grant execute on function public.portal_assert_access(uuid)       to authenticated;
grant execute on function public.portal_get_feed(uuid)            to authenticated;
grant execute on function public.portal_raise_ticket(uuid,text,text,text,text) to authenticated;
grant execute on function public.portal_decide_approval(uuid,text,text)        to authenticated;
revoke execute on function public._portal_log(uuid,uuid,uuid,uuid,text,jsonb)  from public, anon, authenticated;
