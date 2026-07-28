-- 0106_document_retention_and_dossiers.sql — P-267 Batch 35:
-- retention classes made actionable + turnover dossier registration.

-- ------------------------------------------------------- retention columns
alter table public.document_register
  add column if not exists retention_starts_at timestamptz not null default now(),
  add column if not exists retention_expires_at timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists disposed_at timestamptz,
  add column if not exists disposal_reason text;

create index if not exists document_register_retention_idx
  on public.document_register (company_id, retention_class, retention_expires_at);

-- Window per class. Permanent never expires; contract_term rides the project's
-- target COD (null while the project has no COD — never disposal-eligible then).
create or replace function public.document_retention_expiry(
  p_class public.document_retention_class,
  p_starts_at timestamptz,
  p_project_id uuid
) returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_cod date;
begin
  if p_class = 'permanent' then
    return null;
  elsif p_class = 'seven_years' then
    return p_starts_at + interval '7 years';
  elsif p_class = 'three_years' then
    return p_starts_at + interval '3 years';
  elsif p_class = 'transient' then
    return p_starts_at + interval '90 days';
  elsif p_class = 'contract_term' then
    if p_project_id is null then return null; end if;
    select target_cod into v_cod from public.projects where id = p_project_id;
    if v_cod is null then return null; end if;
    -- contract term = defects-liability tail of one year past COD
    return (v_cod::timestamptz) + interval '1 year';
  end if;
  return null;
end $$;

revoke all on function public.document_retention_expiry(
  public.document_retention_class, timestamptz, uuid) from public, anon;
grant execute on function public.document_retention_expiry(
  public.document_retention_class, timestamptz, uuid) to authenticated, service_role;

create or replace function public.document_register_retention_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.retention_starts_at is null then
    new.retention_starts_at := coalesce(new.created_at, now());
  end if;
  new.retention_expires_at := public.document_retention_expiry(
    new.retention_class, new.retention_starts_at, new.project_id);
  return new;
end $$;

drop trigger if exists document_register_retention_trg on public.document_register;
create trigger document_register_retention_trg
  before insert or update of retention_class, retention_starts_at, project_id
  on public.document_register
  for each row execute function public.document_register_retention_sync();

-- Backfill existing rows through the same path.
update public.document_register
   set retention_starts_at = coalesce(retention_starts_at, created_at);

-- ------------------------------------------------------- retention reporting
create or replace function public.document_retention_summary(p_project_id uuid default null)
returns table (
  retention_class text,
  total bigint,
  active bigint,
  superseded bigint,
  obsolete bigint,
  expiring_90d bigint,
  disposal_eligible bigint,
  on_hold bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  if public.is_external_viewer() then
    raise exception 'not_authorized';
  end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'not_authorized'; end if;

  return query
  select d.retention_class::text,
         count(*)::bigint,
         count(*) filter (where d.status in ('draft','issued'))::bigint,
         count(*) filter (where d.status = 'superseded')::bigint,
         count(*) filter (where d.status = 'obsolete')::bigint,
         count(*) filter (
           where d.disposed_at is null
             and d.retention_expires_at is not null
             and d.retention_expires_at > now()
             and d.retention_expires_at <= now() + interval '90 days')::bigint,
         count(*) filter (
           where d.disposed_at is null
             and not d.legal_hold
             and d.retention_expires_at is not null
             and d.retention_expires_at <= now())::bigint,
         count(*) filter (where d.legal_hold)::bigint
    from public.document_register d
   where d.company_id = v_company
     and (p_project_id is null or d.project_id = p_project_id)
   group by d.retention_class
   order by d.retention_class::text;
end $$;

revoke all on function public.document_retention_summary(uuid) from public, anon;
grant execute on function public.document_retention_summary(uuid) to authenticated, service_role;

create or replace function public.document_disposal_queue(
  p_within_days integer default 90,
  p_project_id uuid default null
)
returns table (
  id uuid,
  doc_number text,
  title text,
  doc_type text,
  status text,
  retention_class text,
  retention_expires_at timestamptz,
  legal_hold boolean,
  eligible boolean,
  project_id uuid,
  project_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  if public.is_external_viewer() then
    raise exception 'not_authorized';
  end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'not_authorized'; end if;

  return query
  select d.id, d.doc_number, d.title, d.doc_type, d.status::text,
         d.retention_class::text, d.retention_expires_at, d.legal_hold,
         (d.retention_expires_at <= now() and not d.legal_hold) as eligible,
         d.project_id, p.name
    from public.document_register d
    left join public.projects p on p.id = d.project_id
   where d.company_id = v_company
     and d.disposed_at is null
     and d.retention_expires_at is not null
     and d.retention_expires_at <= now() + make_interval(days => greatest(p_within_days, 0))
     and (p_project_id is null or d.project_id = p_project_id)
   order by d.retention_expires_at;
end $$;

revoke all on function public.document_disposal_queue(integer, uuid) from public, anon;
grant execute on function public.document_disposal_queue(integer, uuid) to authenticated, service_role;

-- ----------------------------------------- audit retention respects classes
-- The sweep never removes audit history for permanent documents or for
-- documents still inside their retention window / under legal hold.
create or replace function public.enforce_audit_log_retention()
returns table (company_id uuid, entity text, deleted_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  financial_entities constant text[] := array[
    'invoices','debit_notes','pay_applications',
    'change_orders','cash_flows','budgets'
  ];
  financial_fallback_days constant integer := 2555;
  min_days constant integer := 90;
begin
  return query
  with pol as (
    select
      p.company_id,
      p.entity,
      greatest(p.retention_days, min_days) as retention_days
    from public.audit_log_retention_policies p
    union all
    select
      a.company_id,
      a.entity,
      financial_fallback_days as retention_days
    from (
      select distinct al.company_id, al.entity
      from public.audit_logs al
      where al.entity = any(financial_entities)
    ) a
    where not exists (
      select 1
      from public.audit_log_retention_policies p2
      where p2.company_id = a.company_id
        and p2.entity = a.entity
    )
  ),
  del as (
    delete from public.audit_logs a
    using pol
    where a.company_id = pol.company_id
      and a.entity = pol.entity
      and a.created_at < now() - make_interval(days => pol.retention_days)
      -- document-register history obeys the document's retention class
      and not exists (
        select 1
        from public.document_register d
        where a.entity in ('document_register','controlled_copies','transmittals')
          and d.id = a.entity_id
          and (
            d.retention_class = 'permanent'
            or d.legal_hold
            or d.retention_expires_at is null
            or d.retention_expires_at > now()
          )
      )
    returning a.company_id, a.entity
  )
  select d.company_id, d.entity, count(*)::bigint
  from del d
  group by d.company_id, d.entity;
end $$;

-- --------------------------------------------------------- turnover dossiers
create table if not exists public.turnover_dossiers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  document_id uuid references public.document_register(id) on delete set null,
  dossier_number text,
  complete boolean not null default false,
  gap_count integer not null default 0,
  gaps jsonb not null default '[]'::jsonb,
  chapters jsonb not null default '[]'::jsonb,
  storage_path text,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.turnover_dossiers to authenticated;
grant all on public.turnover_dossiers to service_role;

alter table public.turnover_dossiers enable row level security;

create policy "turnover_dossiers_select_members"
  on public.turnover_dossiers for select to authenticated
  using (
    company_id = (select company_id from public.profiles where id = auth.uid())
    and not public.is_external_viewer()
  );

create policy "turnover_dossiers_insert_admins"
  on public.turnover_dossiers for insert to authenticated
  with check (
    company_id = (select company_id from public.profiles where id = auth.uid())
    and not public.is_external_viewer()
    and (
      public.has_role(auth.uid(), 'company_admin')
      or public.has_role(auth.uid(), 'project_admin')
      or public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'construction_admin')
    )
  );

create policy "turnover_dossiers_update_admins"
  on public.turnover_dossiers for update to authenticated
  using (
    company_id = (select company_id from public.profiles where id = auth.uid())
    and not public.is_external_viewer()
    and (
      public.has_role(auth.uid(), 'company_admin')
      or public.has_role(auth.uid(), 'project_admin')
      or public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'construction_admin')
    )
  )
  with check (
    company_id = (select company_id from public.profiles where id = auth.uid())
    and not public.is_external_viewer()
  );

drop trigger if exists turnover_dossiers_updated_at on public.turnover_dossiers;
create trigger turnover_dossiers_updated_at
  before update on public.turnover_dossiers
  for each row execute function public.set_updated_at();

-- Registers a generated dossier as a permanent controlled document.
create or replace function public.register_turnover_dossier(
  p_project_id uuid,
  p_complete boolean,
  p_gaps jsonb,
  p_chapters jsonb,
  p_storage_path text default null
)
returns table (
  dossier_id uuid,
  document_id uuid,
  doc_number text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc uuid;
  v_dossier uuid;
  v_number text;
  v_project text;
  v_seq integer;
begin
  if public.is_external_viewer() then
    raise exception 'not_authorized';
  end if;
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then raise exception 'not_authorized'; end if;

  if not (public.has_role(auth.uid(), 'company_admin')
          or public.has_role(auth.uid(), 'project_admin')
          or public.has_role(auth.uid(), 'engineering_admin')
          or public.has_role(auth.uid(), 'construction_admin')) then
    raise exception 'not_authorized';
  end if;

  select name into v_project from public.projects
   where id = p_project_id and company_id = v_company;
  if v_project is null then raise exception 'project_not_found'; end if;

  select count(*)::integer + 1 into v_seq
    from public.turnover_dossiers
   where company_id = v_company and project_id = p_project_id;

  insert into public.document_register
    (company_id, project_id, doc_type, title, current_revision, status,
     retention_class, storage_path, created_by, owner_id, metadata)
  values (v_company, p_project_id, 'turnover_dossier',
          'Turnover Dossier — ' || v_project,
          'R' || v_seq::text,
          'issued',
          'permanent'::public.document_retention_class,
          p_storage_path, auth.uid(), auth.uid(),
          jsonb_build_object('complete', p_complete,
                             'gap_count', coalesce(jsonb_array_length(p_gaps), 0)))
  returning id, document_register.doc_number into v_doc, v_number;

  insert into public.turnover_dossiers
    (company_id, project_id, document_id, dossier_number, complete,
     gap_count, gaps, chapters, storage_path, generated_by)
  values (v_company, p_project_id, v_doc, v_number, coalesce(p_complete, false),
          coalesce(jsonb_array_length(p_gaps), 0),
          coalesce(p_gaps, '[]'::jsonb), coalesce(p_chapters, '[]'::jsonb),
          p_storage_path, auth.uid())
  returning id into v_dossier;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_company, auth.uid(), 'turnover_dossier.generated', 'turnover_dossiers', v_dossier,
          jsonb_build_object('project_id', p_project_id, 'document_id', v_doc,
                             'doc_number', v_number, 'complete', coalesce(p_complete, false),
                             'gap_count', coalesce(jsonb_array_length(p_gaps), 0)));

  return query select v_dossier, v_doc, v_number;
end $$;

revoke all on function public.register_turnover_dossier(uuid, boolean, jsonb, jsonb, text)
  from public, anon;
grant execute on function public.register_turnover_dossier(uuid, boolean, jsonb, jsonb, text)
  to authenticated, service_role;