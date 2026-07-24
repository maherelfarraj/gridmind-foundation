
-- P-051 — Documents & drawing register domain
-- Idempotent, tenant-scoped, RLS on every table.

-- 1. Enums (guarded, re-runnable) --------------------------------------------
do $$ begin
  create type public.document_category as enum
    ('drawing','report','calculation','datasheet','correspondence','contract_doc','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.drawing_status as enum
    ('draft','IFD','IFC','as_built','superseded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.drawing_discipline as enum
    ('civil','structural','electrical','mechanical','scada_controls','survey','general');
exception when duplicate_object then null; end $$;

-- 2. Tables -------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  category public.document_category not null default 'other',
  storage_path text,
  file_name text,
  file_size_bytes bigint,
  mime_type text,
  tags text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drawing_register (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  drawing_number text not null,
  title text not null,
  discipline public.drawing_discipline not null default 'general',
  current_status public.drawing_status not null default 'draft',
  current_revision_id uuid,
  locked boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_register_project_number_uk unique (project_id, drawing_number)
);

create table if not exists public.drawing_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  drawing_id uuid not null references public.drawing_register(id) on delete cascade,
  revision_code text not null,
  status public.drawing_status not null default 'draft',
  storage_path text not null,
  file_name text,
  file_size_bytes bigint,
  mime_type text,
  issue_reason text,
  issued_by uuid references public.profiles(id),
  issued_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drawing_revisions_drawing_code_uk unique (drawing_id, revision_code)
);

-- Deferred FK: current_revision_id references drawing_revisions
do $$ begin
  alter table public.drawing_register
    add constraint fk_current_revision
    foreign key (current_revision_id) references public.drawing_revisions(id);
exception when duplicate_object then null; end $$;

create table if not exists public.document_markups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  revision_id uuid not null references public.drawing_revisions(id) on delete cascade,
  reviewer_id uuid references public.profiles(id),
  reviewer_org text,
  page_number int,
  annotation jsonb not null,
  status text not null default 'open'
    check (status in ('open','accepted','rejected','resolved')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Indexes ------------------------------------------------------------------
create index if not exists documents_project_idx
  on public.documents (project_id);
create index if not exists drawing_register_project_discipline_idx
  on public.drawing_register (project_id, discipline);
create index if not exists drawing_revisions_drawing_idx
  on public.drawing_revisions (drawing_id);
create index if not exists document_markups_revision_status_idx
  on public.document_markups (revision_id, status);

-- 4. GRANTs (before RLS enable) ----------------------------------------------
grant select, insert, update on public.documents           to authenticated;
grant select, insert, update on public.drawing_register    to authenticated;
grant select, insert, update on public.drawing_revisions   to authenticated;
grant select, insert, update on public.document_markups    to authenticated;
grant all on public.documents         to service_role;
grant all on public.drawing_register  to service_role;
grant all on public.drawing_revisions to service_role;
grant all on public.document_markups  to service_role;

-- 5. Enable RLS ---------------------------------------------------------------
alter table public.documents         enable row level security;
alter table public.drawing_register  enable row level security;
alter table public.drawing_revisions enable row level security;
alter table public.document_markups  enable row level security;

-- 6. Policies -----------------------------------------------------------------
-- documents
drop policy if exists documents_select        on public.documents;
drop policy if exists documents_insert        on public.documents;
drop policy if exists documents_update        on public.documents;

create policy documents_select on public.documents
  for select to authenticated
  using (public.is_company_member(company_id));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

create policy documents_update on public.documents
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

-- drawing_register
drop policy if exists drawing_register_select on public.drawing_register;
drop policy if exists drawing_register_insert on public.drawing_register;
drop policy if exists drawing_register_update on public.drawing_register;

create policy drawing_register_select on public.drawing_register
  for select to authenticated
  using (public.is_company_member(company_id));

create policy drawing_register_insert on public.drawing_register
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

create policy drawing_register_update on public.drawing_register
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

-- drawing_revisions
drop policy if exists drawing_revisions_select on public.drawing_revisions;
drop policy if exists drawing_revisions_insert on public.drawing_revisions;
drop policy if exists drawing_revisions_update on public.drawing_revisions;

create policy drawing_revisions_select on public.drawing_revisions
  for select to authenticated
  using (public.is_company_member(company_id));

create policy drawing_revisions_insert on public.drawing_revisions
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'engineer'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

create policy drawing_revisions_update on public.drawing_revisions
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin'::app_role)
      or public.has_role(auth.uid(), 'project_admin'::app_role)
    )
  );

-- document_markups — external reviewers may INSERT
drop policy if exists document_markups_select on public.document_markups;
drop policy if exists document_markups_insert on public.document_markups;
drop policy if exists document_markups_update on public.document_markups;

create policy document_markups_select on public.document_markups
  for select to authenticated
  using (public.is_company_member(company_id));

create policy document_markups_insert on public.document_markups
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    or public.has_role(auth.uid(), 'client_viewer'::app_role)
    or public.has_role(auth.uid(), 'lender_viewer'::app_role)
  );

create policy document_markups_update on public.document_markups
  for update to authenticated
  using (
    reviewer_id = auth.uid()
    or public.has_role(auth.uid(), 'engineering_admin'::app_role)
  )
  with check (
    reviewer_id = auth.uid()
    or public.has_role(auth.uid(), 'engineering_admin'::app_role)
  );

-- 7. updated_at triggers (reuse public.set_updated_at from 0010) --------------
drop trigger if exists set_documents_updated_at         on public.documents;
drop trigger if exists set_drawing_register_updated_at  on public.drawing_register;
drop trigger if exists set_drawing_revisions_updated_at on public.drawing_revisions;
drop trigger if exists set_document_markups_updated_at  on public.document_markups;

create trigger set_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

create trigger set_drawing_register_updated_at
  before update on public.drawing_register
  for each row execute function public.set_updated_at();

create trigger set_drawing_revisions_updated_at
  before update on public.drawing_revisions
  for each row execute function public.set_updated_at();

create trigger set_document_markups_updated_at
  before update on public.document_markups
  for each row execute function public.set_updated_at();

-- 8. Audit trigger on drawing_revisions.status change ------------------------
create or replace function public.audit_drawing_revision_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.write_audit_log(
      'drawing_revision.status_changed',
      'drawing_revisions',
      new.id,
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists drawing_revisions_status_audit on public.drawing_revisions;
create trigger drawing_revisions_status_audit
  after update on public.drawing_revisions
  for each row execute function public.audit_drawing_revision_status();
