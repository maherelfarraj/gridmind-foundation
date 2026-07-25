-- 0053_project_export_locks.sql — idempotent
create table if not exists public.project_export_locks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null,
  export_type text not null check (export_type in
    ('proposal_pdf','proposal_pptx','weekly_client_report','om_report','turnover_pack','audit_pack','csv')),
  reason text not null default 'approval_pending',
  approval_instance_id uuid references public.approval_instances(id),
  locked_by uuid references public.profiles(id),
  locked_at timestamptz not null default now(),
  unlocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.projects') is not null and not exists (
    select 1 from pg_constraint where conname = 'export_locks_project_fk'
  ) then
    alter table public.project_export_locks
      add constraint export_locks_project_fk
      foreign key (project_id) references public.projects(id);
  end if;
end $$;

create unique index if not exists export_locks_one_active
  on public.project_export_locks(project_id, export_type) where unlocked_at is null;
create index if not exists export_locks_project_idx
  on public.project_export_locks(company_id, project_id);

grant select, insert, update on public.project_export_locks to authenticated;
grant all on public.project_export_locks to service_role;

alter table public.project_export_locks enable row level security;

drop policy if exists export_locks_select on public.project_export_locks;
create policy export_locks_select on public.project_export_locks for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists export_locks_insert on public.project_export_locks;
create policy export_locks_insert on public.project_export_locks for insert to authenticated
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('company_admin')
      or public.has_company_role('project_admin')
      or public.has_company_role('finance_admin')
    )
  );

drop policy if exists export_locks_update on public.project_export_locks;
create policy export_locks_update on public.project_export_locks for update to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('company_admin')
      or public.has_company_role('project_admin')
      or public.has_company_role('finance_admin')
    )
  );

drop trigger if exists trg_export_locks_updated on public.project_export_locks;
create trigger trg_export_locks_updated before update on public.project_export_locks
  for each row execute function public.set_updated_at();

create or replace function public.is_export_locked(p_project_id uuid, p_export_type text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then return true; end if;  -- fail closed
  return exists (
    select 1 from public.project_export_locks l
     where l.company_id = v_company
       and l.project_id = p_project_id
       and l.export_type = p_export_type
       and l.unlocked_at is null
  ) or exists (
    select 1 from public.approval_instances i
     join public.approval_rules r on r.id = i.rule_id and r.blocks_export
     where i.company_id = v_company
       and i.status in ('pending','in_progress')
       and (i.metadata->>'project_id')::uuid = p_project_id
  );
end $$;

create or replace function public.assert_export_unlocked(p_project_id uuid, p_export_type text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.is_export_locked(p_project_id, p_export_type) then
    raise exception 'export_locked:%', p_export_type;
  end if;
end $$;

create or replace function public.sync_export_locks(p_project_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  update public.project_export_locks l set unlocked_at = now()
    from public.approval_instances i
   where l.approval_instance_id = i.id
     and l.unlocked_at is null
     and l.project_id = p_project_id
     and i.status in ('approved','rejected','cancelled');
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function public.is_export_locked(uuid, text) to authenticated;
grant execute on function public.assert_export_unlocked(uuid, text) to authenticated;
grant execute on function public.sync_export_locks(uuid) to authenticated;