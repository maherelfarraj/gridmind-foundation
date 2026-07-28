-- 0102_document_register.sql — P-263 Batch 35: controlled document register,
-- transmittals (with pinned revisions), controlled copies.

-- ------------------------------------------------------------------ enums
do $$ begin
  create type public.document_register_status as enum
    ('draft','issued','superseded','obsolete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_retention_class as enum
    ('permanent','contract_term','seven_years','three_years','transient');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transmittal_purpose as enum
    ('for_approval','for_information','for_construction','as_built');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transmittal_status as enum
    ('draft','issued','acknowledged','returned','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.controlled_copy_status as enum
    ('issued','returned','recalled','destroyed');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- counters
create table if not exists public.document_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.document_counters enable row level security;  -- trigger-only
grant all on public.document_counters to service_role;

create or replace function public.next_document_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.document_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.document_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

revoke all on function public.next_document_number(uuid, text) from public, anon, authenticated;
grant execute on function public.next_document_number(uuid, text) to service_role;

-- -------------------------------------------------------- document_register
create table if not exists public.document_register (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  doc_number text,
  doc_type text not null,
  title text not null,
  discipline text,
  current_revision text not null default 'A',
  status public.document_register_status not null default 'draft',
  retention_class public.document_retention_class not null default 'contract_term',
  storage_path text,
  file_name text,
  mime_type text,
  owner_id uuid references public.profiles(id) on delete set null,
  source_table text,
  source_id uuid,
  superseded_by_id uuid references public.document_register(id) on delete set null,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_register_number_unique unique (company_id, doc_number),
  constraint document_register_source_unique unique (source_table, source_id),
  constraint document_register_no_self_supersede
    check (superseded_by_id is null or superseded_by_id <> id)
);

create index if not exists document_register_company_project_idx
  on public.document_register (company_id, project_id, status);
create index if not exists document_register_company_type_idx
  on public.document_register (company_id, doc_type);
create index if not exists document_register_superseded_idx
  on public.document_register (superseded_by_id);

create or replace function public.document_register_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.doc_number is null then
    new.doc_number := 'DOC-' || lpad(
      public.next_document_number(new.company_id, 'document')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists document_register_number_trg on public.document_register;
create trigger document_register_number_trg
  before insert on public.document_register
  for each row execute function public.document_register_before_insert();

drop trigger if exists document_register_updated_at on public.document_register;
create trigger document_register_updated_at
  before update on public.document_register
  for each row execute function public.set_updated_at();

create or replace function public.audit_document_register_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    values (new.company_id, auth.uid(), 'document.status_changed', 'document_register', new.id,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'revision', new.current_revision));
  end if;
  return new;
end $$;

drop trigger if exists document_register_audit_trg on public.document_register;
create trigger document_register_audit_trg
  after update on public.document_register
  for each row execute function public.audit_document_register_status();

grant select, insert, update, delete on public.document_register to authenticated;
grant all on public.document_register to service_role;
alter table public.document_register enable row level security;

drop policy if exists document_register_select on public.document_register;
create policy document_register_select on public.document_register
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists document_register_insert on public.document_register;
create policy document_register_insert on public.document_register
  for insert to authenticated
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('procurement_admin'::public.app_role)
                or public.has_company_role('legal_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists document_register_update on public.document_register;
create policy document_register_update on public.document_register
  for update to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and (public.has_company_role('engineering_admin'::public.app_role)
           or public.has_company_role('project_admin'::public.app_role)
           or public.has_company_role('construction_admin'::public.app_role)
           or public.has_company_role('procurement_admin'::public.app_role)
           or public.has_company_role('legal_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('procurement_admin'::public.app_role)
                or public.has_company_role('legal_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists document_register_delete on public.document_register;
create policy document_register_delete on public.document_register
  for delete to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and public.has_company_role('company_admin'::public.app_role));

-- ------------------------------------------- transmittals (extend existing)
alter table public.transmittals
  add column if not exists purpose public.transmittal_purpose not null default 'for_information',
  add column if not exists status public.transmittal_status not null default 'draft',
  add column if not exists sender_id uuid references public.profiles(id) on delete set null,
  add column if not exists recipient_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists recipient_contact_id uuid references public.contacts(id) on delete set null,
  add column if not exists recipient_name text,
  add column if not exists recipient_email text,
  add column if not exists returned_at timestamptz,
  add column if not exists approval_instance_id uuid references public.approval_instances(id) on delete set null,
  add column if not exists notes text;

-- Legacy free-text party columns stay for the field module; default them so the
-- structured recipient path can insert without them.
alter table public.transmittals alter column from_party set default '';
alter table public.transmittals alter column to_party set default '';

create index if not exists transmittals_company_status_idx
  on public.transmittals (company_id, status, response_due);

create or replace function public.transmittals_number_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.transmittal_number is null or btrim(new.transmittal_number) = '' then
    new.transmittal_number := 'TR-' || lpad(
      public.next_document_number(new.company_id, 'transmittal')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists transmittals_number_trg on public.transmittals;
create trigger transmittals_number_trg
  before insert on public.transmittals
  for each row execute function public.transmittals_number_default();

create or replace function public.audit_transmittal_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'issued' and new.sent_at is null then
      new.sent_at := now();
    elsif new.status = 'acknowledged' and new.acknowledged_at is null then
      new.acknowledged_at := now();
    elsif new.status = 'returned' and new.returned_at is null then
      new.returned_at := now();
    end if;
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    values (new.company_id, auth.uid(), 'transmittal.status_changed', 'transmittals', new.id,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'purpose', new.purpose));
  end if;
  return new;
end $$;

drop trigger if exists transmittals_status_trg on public.transmittals;
create trigger transmittals_status_trg
  before update on public.transmittals
  for each row execute function public.audit_transmittal_status();

-- Tighten the existing policies to the external-viewer doctrine and widen the
-- writer roles to the document-control set.
drop policy if exists transmittals_select on public.transmittals;
create policy transmittals_select on public.transmittals
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists transmittals_write on public.transmittals;
create policy transmittals_write on public.transmittals
  to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and (public.has_company_role('engineering_admin'::public.app_role)
           or public.has_company_role('project_admin'::public.app_role)
           or public.has_company_role('construction_admin'::public.app_role)
           or public.has_company_role('procurement_admin'::public.app_role)
           or public.has_company_role('legal_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('procurement_admin'::public.app_role)
                or public.has_company_role('legal_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

-- -------------------------------------------------------- transmittal_items
create table if not exists public.transmittal_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  transmittal_id uuid not null references public.transmittals(id) on delete cascade,
  document_id uuid not null references public.document_register(id) on delete restrict,
  line_no integer not null,
  revision_pinned text not null,
  storage_path_pinned text,
  title_pinned text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transmittal_items_line_unique unique (transmittal_id, line_no)
);

create index if not exists transmittal_items_document_idx
  on public.transmittal_items (document_id);

drop trigger if exists transmittal_items_updated_at on public.transmittal_items;
create trigger transmittal_items_updated_at
  before update on public.transmittal_items
  for each row execute function public.set_updated_at();

-- The pin is the point: once the transmittal leaves draft, the item snapshot
-- is immune to later revisions.
create or replace function public.transmittal_items_freeze()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_status public.transmittal_status;
begin
  select t.status into v_status from public.transmittals t
   where t.id = coalesce(new.transmittal_id, old.transmittal_id);
  if v_status is distinct from 'draft'::public.transmittal_status then
    raise exception 'transmittal_items_frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists transmittal_items_freeze_trg on public.transmittal_items;
create trigger transmittal_items_freeze_trg
  before insert or update or delete on public.transmittal_items
  for each row execute function public.transmittal_items_freeze();

grant select, insert, update, delete on public.transmittal_items to authenticated;
grant all on public.transmittal_items to service_role;
alter table public.transmittal_items enable row level security;

drop policy if exists transmittal_items_select on public.transmittal_items;
create policy transmittal_items_select on public.transmittal_items
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists transmittal_items_insert on public.transmittal_items;
create policy transmittal_items_insert on public.transmittal_items
  for insert to authenticated
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('procurement_admin'::public.app_role)
                or public.has_company_role('legal_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists transmittal_items_update on public.transmittal_items;
create policy transmittal_items_update on public.transmittal_items
  for update to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and (public.has_company_role('engineering_admin'::public.app_role)
           or public.has_company_role('project_admin'::public.app_role)
           or public.has_company_role('construction_admin'::public.app_role)
           or public.has_company_role('procurement_admin'::public.app_role)
           or public.has_company_role('legal_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('procurement_admin'::public.app_role)
                or public.has_company_role('legal_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists transmittal_items_delete on public.transmittal_items;
create policy transmittal_items_delete on public.transmittal_items
  for delete to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and (public.has_company_role('engineering_admin'::public.app_role)
           or public.has_company_role('project_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role)));

-- --------------------------------------------------------- controlled_copies
create table if not exists public.controlled_copies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  document_id uuid not null references public.document_register(id) on delete cascade,
  transmittal_id uuid references public.transmittals(id) on delete set null,
  copy_number integer not null,
  revision_pinned text not null,
  holder_user_id uuid references public.profiles(id) on delete set null,
  holder_contact_id uuid references public.contacts(id) on delete set null,
  holder_name text,
  location text,
  issue_date date not null default current_date,
  status public.controlled_copy_status not null default 'issued',
  recalled_at timestamptz,
  recalled_by uuid references public.profiles(id) on delete set null,
  returned_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint controlled_copies_number_unique unique (document_id, copy_number),
  constraint controlled_copies_holder_present
    check (holder_user_id is not null
        or holder_contact_id is not null
        or coalesce(btrim(holder_name), '') <> '')
);

create index if not exists controlled_copies_company_status_idx
  on public.controlled_copies (company_id, status);

drop trigger if exists controlled_copies_updated_at on public.controlled_copies;
create trigger controlled_copies_updated_at
  before update on public.controlled_copies
  for each row execute function public.set_updated_at();

create or replace function public.audit_controlled_copy_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'recalled' and new.recalled_at is null then
      new.recalled_at := now();
      new.recalled_by := coalesce(new.recalled_by, auth.uid());
    elsif new.status = 'returned' and new.returned_at is null then
      new.returned_at := now();
    end if;
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    values (new.company_id, auth.uid(), 'controlled_copy.status_changed',
            'controlled_copies', new.id,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'copy_number', new.copy_number));
  end if;
  return new;
end $$;

drop trigger if exists controlled_copies_status_trg on public.controlled_copies;
create trigger controlled_copies_status_trg
  before update on public.controlled_copies
  for each row execute function public.audit_controlled_copy_status();

grant select, insert, update, delete on public.controlled_copies to authenticated;
grant all on public.controlled_copies to service_role;
alter table public.controlled_copies enable row level security;

drop policy if exists controlled_copies_select on public.controlled_copies;
create policy controlled_copies_select on public.controlled_copies
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists controlled_copies_insert on public.controlled_copies;
create policy controlled_copies_insert on public.controlled_copies
  for insert to authenticated
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists controlled_copies_update on public.controlled_copies;
create policy controlled_copies_update on public.controlled_copies
  for update to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and (public.has_company_role('engineering_admin'::public.app_role)
           or public.has_company_role('project_admin'::public.app_role)
           or public.has_company_role('construction_admin'::public.app_role)
           or public.has_company_role('company_admin'::public.app_role)))
  with check (public.is_company_member(company_id)
              and not public.is_external_viewer()
              and (public.has_company_role('engineering_admin'::public.app_role)
                or public.has_company_role('project_admin'::public.app_role)
                or public.has_company_role('construction_admin'::public.app_role)
                or public.has_company_role('company_admin'::public.app_role)));

drop policy if exists controlled_copies_delete on public.controlled_copies;
create policy controlled_copies_delete on public.controlled_copies
  for delete to authenticated
  using (public.is_company_member(company_id)
         and not public.is_external_viewer()
         and public.has_company_role('company_admin'::public.app_role));

-- ------------------------------------------------- approval rule seed (P-111)
create or replace function public.ensure_transmittal_approval_rule(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_rule_id uuid;
begin
  insert into public.approval_rules
    (company_id, rule_key, name, description, entity_type, sla_hours,
     escalation_role, is_active)
  values
    (p_company_id, 'transmittal_for_approval', 'Transmittal issued for approval',
     'Approval of documents transmitted with purpose for_approval.',
     'transmittal', 72, 'company_admin'::public.app_role, true)
  on conflict (company_id, rule_key) do nothing;

  select id into v_rule_id
    from public.approval_rules
   where company_id = p_company_id and rule_key = 'transmittal_for_approval';

  if v_rule_id is null then return null; end if;

  insert into public.approval_chain_steps (company_id, rule_id, step_order, role, sla_hours)
  values (p_company_id, v_rule_id, 1, 'engineering_admin'::public.app_role, 72)
  on conflict (rule_id, step_order) do nothing;

  return v_rule_id;
end $$;

revoke all on function public.ensure_transmittal_approval_rule(uuid) from public, anon;
grant execute on function public.ensure_transmittal_approval_rule(uuid) to authenticated, service_role;

do $$
declare r record;
begin
  for r in select id from public.companies loop
    perform public.ensure_transmittal_approval_rule(r.id);
  end loop;
end $$;

-- ------------------------------------------------------------- backfill
-- Idempotent via (source_table, source_id).
insert into public.document_register
  (company_id, project_id, doc_type, title, current_revision, status,
   retention_class, storage_path, file_name, mime_type, owner_id,
   source_table, source_id, created_by, created_at)
select d.company_id, d.project_id, coalesce(d.category::text, 'document'), d.title,
       'A', 'issued'::public.document_register_status,
       'contract_term'::public.document_retention_class,
       d.storage_path, d.file_name, d.mime_type, d.created_by,
       'documents', d.id, d.created_by, d.created_at
  from public.documents d
on conflict (source_table, source_id) do nothing;

insert into public.document_register
  (company_id, project_id, doc_type, title, discipline, current_revision, status,
   retention_class, owner_id, source_table, source_id, created_by, created_at)
select dr.company_id, dr.project_id, 'drawing', dr.title, dr.discipline::text,
       coalesce(rev.revision_code, 'A'),
       case dr.current_status::text
         when 'superseded' then 'superseded'::public.document_register_status
         when 'obsolete' then 'obsolete'::public.document_register_status
         when 'draft' then 'draft'::public.document_register_status
         else 'issued'::public.document_register_status
       end,
       'permanent'::public.document_retention_class,
       dr.created_by, 'drawing_register', dr.id, dr.created_by, dr.created_at
  from public.drawing_register dr
  left join public.drawing_revisions rev on rev.id = dr.current_revision_id
on conflict (source_table, source_id) do nothing;

insert into public.document_register
  (company_id, project_id, doc_type, title, current_revision, status,
   retention_class, owner_id, source_table, source_id, created_by, created_at)
select r.company_id, r.project_id, 'ifc_release', r.package_name, 'A',
       case when r.status::text = 'released' then 'issued'::public.document_register_status
            when r.status::text = 'void' then 'obsolete'::public.document_register_status
            else 'draft'::public.document_register_status end,
       'permanent'::public.document_retention_class,
       r.released_by, 'ifc_releases', r.id, r.created_by, r.created_at
  from public.ifc_releases r
on conflict (source_table, source_id) do nothing;

insert into public.document_register
  (company_id, doc_type, title, current_revision, status, retention_class,
   storage_path, file_name, source_table, source_id, created_by, created_at)
select c.company_id, 'compliance_' || c.doc_type::text, c.title, 'A',
       case when c.status::text = 'expired' then 'obsolete'::public.document_register_status
            else 'issued'::public.document_register_status end,
       'seven_years'::public.document_retention_class,
       c.file_path, c.file_name, 'subcontract_compliance_docs', c.id,
       c.created_by, c.created_at
  from public.subcontract_compliance_docs c
on conflict (source_table, source_id) do nothing;