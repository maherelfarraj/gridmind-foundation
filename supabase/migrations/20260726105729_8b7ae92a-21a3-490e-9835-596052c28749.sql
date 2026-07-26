do $$ begin
  create type sld_status as enum
    ('draft','under_review','approved','ifc','as_built','superseded');
exception when duplicate_object then null; end $$;

create table if not exists public.sld_drawings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  drawing_number text not null,
  title text not null,
  status sld_status not null default 'draft',
  current_revision_id uuid,
  sheet_size text not null default 'A1' check (sheet_size in ('A0','A1','A2','A3')),
  border_template text not null default 'gridmind_default',
  locked boolean not null default false,
  drawing_register_id uuid references drawing_register(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, drawing_number)
);

create table if not exists public.sld_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  drawing_id uuid not null references sld_drawings(id) on delete cascade,
  revision_code text not null,
  status sld_status not null default 'draft',
  issue_reason text,
  canvas jsonb not null default '{}',
  graph_hash text,
  issued_by uuid references profiles(id),
  issued_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (drawing_id, revision_code)
);

alter table public.sld_drawings drop constraint if exists fk_sld_current_revision;
alter table public.sld_drawings
  add constraint fk_sld_current_revision
  foreign key (current_revision_id) references sld_revisions(id);

create table if not exists public.sld_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  revision_id uuid not null references sld_revisions(id) on delete cascade,
  symbol_type text not null,
  tag text,
  label text,
  x numeric not null default 0,
  y numeric not null default 0,
  rotation int not null default 0 check (rotation in (0,90,180,270)),
  mirrored boolean not null default false,
  layer_id text not null default 'default',
  group_id uuid,
  properties jsonb not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sld_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  revision_id uuid not null references sld_revisions(id) on delete cascade,
  from_object_id uuid not null references sld_objects(id) on delete cascade,
  from_port text not null default 'out',
  to_object_id uuid not null references sld_objects(id) on delete cascade,
  to_port text not null default 'in',
  connection_type text not null default 'cable'
    check (connection_type in ('cable','busbar','dc_string','earth','signal')),
  cable_number text,
  properties jsonb not null default '{}',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_object_id <> to_object_id)
);

create index if not exists sld_drawings_project_idx on public.sld_drawings(project_id, status);
create index if not exists sld_revisions_drawing_idx on public.sld_revisions(drawing_id);
create index if not exists sld_objects_revision_idx on public.sld_objects(revision_id, symbol_type);
create unique index if not exists sld_objects_tag_uq
  on public.sld_objects(revision_id, tag) where tag is not null;
create index if not exists sld_connections_revision_idx on public.sld_connections(revision_id);
create index if not exists sld_connections_from_idx on public.sld_connections(from_object_id);
create index if not exists sld_connections_to_idx on public.sld_connections(to_object_id);

create sequence if not exists public.sld_drawing_seq;

create or replace function public.next_sld_drawing_number(p_project_id uuid)
returns text language plpgsql security definer set search_path = public as $fn$
declare v_count int;
begin
  select count(*) + 1 into v_count from sld_drawings where project_id = p_project_id;
  return 'SLD-' || lpad(v_count::text, 4, '0');
end $fn$;

revoke all on function public.next_sld_drawing_number(uuid) from public, anon;
grant execute on function public.next_sld_drawing_number(uuid) to authenticated;

do $$ declare t text; begin
  foreach t in array array['sld_drawings','sld_revisions','sld_objects','sld_connections'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
      for each row execute function set_updated_at()', t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['sld_drawings','sld_revisions','sld_objects','sld_connections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated
      using (is_company_member(company_id))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for insert to authenticated
      with check (is_company_member(company_id) and (
        has_role(auth.uid(),''engineering_admin'') or has_role(auth.uid(),''engineer'')
        or has_role(auth.uid(),''project_admin'')))', t, t);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated
      using (is_company_member(company_id) and (
        has_role(auth.uid(),''engineering_admin'') or has_role(auth.uid(),''engineer'')
        or has_role(auth.uid(),''project_admin'')))
      with check (is_company_member(company_id) and (
        has_role(auth.uid(),''engineering_admin'') or has_role(auth.uid(),''engineer'')
        or has_role(auth.uid(),''project_admin'')))', t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  revoke all on sequence public.sld_drawing_seq from anon;
  grant usage on sequence public.sld_drawing_seq to authenticated;
end $$;