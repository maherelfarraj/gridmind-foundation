
-- =========================================================================
-- Migration 0004 — audit_logs + retention policies + write helper
-- Idempotent.
-- =========================================================================

-- 1. audit_logs (append-only) ---------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_logs_company_created_idx
  on public.audit_logs (company_id, created_at desc);
create index if not exists audit_logs_company_entity_idx
  on public.audit_logs (company_id, entity, entity_id);

-- 2. audit_log_retention_policies -----------------------------------------
create table if not exists public.audit_log_retention_policies (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  entity         text not null,
  retention_days int  not null default 2555 check (retention_days >= 90),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, entity)
);

drop trigger if exists trg_audit_retention_updated_at on public.audit_log_retention_policies;
create trigger trg_audit_retention_updated_at
  before update on public.audit_log_retention_policies
  for each row execute function public.update_updated_at_column();

-- 3. GRANTs ---------------------------------------------------------------
revoke all on public.audit_logs                    from anon, public;
revoke all on public.audit_log_retention_policies  from anon, public;

grant select, insert on public.audit_logs to authenticated;
-- Explicit belt-and-braces: audit rows are immutable from the app role.
revoke update, delete on public.audit_logs from authenticated;

grant select, insert, update, delete on public.audit_log_retention_policies to authenticated;

grant all on public.audit_logs                    to service_role;
grant all on public.audit_log_retention_policies  to service_role;

-- 4. write_audit_log helper (SECURITY DEFINER) ----------------------------
create or replace function public.write_audit_log(
  p_action    text,
  p_entity    text,
  p_entity_id uuid,
  p_metadata  jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_company uuid;
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'write_audit_log: no authenticated user'
      using errcode = '28000';
  end if;

  select company_id into v_company
  from public.profiles
  where id = v_actor;

  if v_company is null then
    raise exception 'write_audit_log: actor % has no profile', v_actor
      using errcode = 'P0001';
  end if;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_company, v_actor, p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.write_audit_log(text, text, uuid, jsonb) from public, anon;
grant  execute on function public.write_audit_log(text, text, uuid, jsonb) to authenticated, service_role;

-- 5. Enable RLS + policies ------------------------------------------------
alter table public.audit_logs                   enable row level security;
alter table public.audit_log_retention_policies enable row level security;

-- audit_logs
drop policy if exists audit_logs_select_members on public.audit_logs;
create policy audit_logs_select_members
  on public.audit_logs
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists audit_logs_insert_members on public.audit_logs;
create policy audit_logs_insert_members
  on public.audit_logs
  for insert
  to authenticated
  with check (
    public.is_company_member(company_id)
    and actor_id = auth.uid()
  );
-- No UPDATE / DELETE policies: privilege is revoked at grant level.

-- audit_log_retention_policies
drop policy if exists audit_retention_select_members on public.audit_log_retention_policies;
create policy audit_retention_select_members
  on public.audit_log_retention_policies
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists audit_retention_insert_admin on public.audit_log_retention_policies;
create policy audit_retention_insert_admin
  on public.audit_log_retention_policies
  for insert
  to authenticated
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists audit_retention_update_admin on public.audit_log_retention_policies;
create policy audit_retention_update_admin
  on public.audit_log_retention_policies
  for update
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists audit_retention_delete_admin on public.audit_log_retention_policies;
create policy audit_retention_delete_admin
  on public.audit_log_retention_policies
  for delete
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );
