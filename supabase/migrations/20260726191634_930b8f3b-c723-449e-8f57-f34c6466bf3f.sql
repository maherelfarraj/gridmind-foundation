-- P-172 — SCADA ingestion expansion: protocol tag mappings + ingestion health runs.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'tag_mapping_protocol') then
    create type public.tag_mapping_protocol as enum ('mqtt','opcua','modbus','historian_csv','vendor_api');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ingestion_run_status') then
    create type public.ingestion_run_status as enum ('running','success','partial','failed');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ingestion_trigger') then
    create type public.ingestion_trigger as enum ('manual','scheduled','push','import');
  end if;
end $$;

-- ---------------------------------------------------------------- mappings --
create table if not exists public.tag_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  connector_id uuid references public.scada_connectors(id) on delete set null,
  tag_dictionary_id uuid not null references public.tag_dictionary(id) on delete cascade,
  protocol public.tag_mapping_protocol not null,
  source_address text not null,
  source_details jsonb not null default '{}'::jsonb,
  data_type text not null default 'float32',
  byte_order text not null default 'big_endian',
  scaling_factor numeric not null default 1,
  scaling_offset numeric not null default 0,
  poll_interval_s integer not null default 60 check (poll_interval_s between 1 and 86400),
  enabled boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_mappings_address_len check (char_length(source_address) between 1 and 512)
);

create unique index if not exists tag_mappings_unique_source
  on public.tag_mappings (company_id, protocol, source_address, tag_dictionary_id);
create index if not exists tag_mappings_project_idx on public.tag_mappings (project_id);
create index if not exists tag_mappings_connector_idx on public.tag_mappings (connector_id);

drop trigger if exists set_updated_at_tag_mappings on public.tag_mappings;
create trigger set_updated_at_tag_mappings before update on public.tag_mappings
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.tag_mappings to authenticated;
grant all on public.tag_mappings to service_role;
alter table public.tag_mappings enable row level security;

drop policy if exists tag_mappings_select on public.tag_mappings;
create policy tag_mappings_select on public.tag_mappings for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists tag_mappings_write on public.tag_mappings;
create policy tag_mappings_write on public.tag_mappings for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));

-- ----------------------------------------------------------- ingestion runs --
create table if not exists public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  connector_id uuid references public.scada_connectors(id) on delete set null,
  trigger public.ingestion_trigger not null default 'manual',
  status public.ingestion_run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  rows_received integer not null default 0,
  rows_accepted integer not null default 0,
  rows_rejected integer not null default 0,
  source_label text,
  error_text text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ingestion_runs_company_started_idx
  on public.ingestion_runs (company_id, started_at desc);
create index if not exists ingestion_runs_connector_idx on public.ingestion_runs (connector_id);

drop trigger if exists set_updated_at_ingestion_runs on public.ingestion_runs;
create trigger set_updated_at_ingestion_runs before update on public.ingestion_runs
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.ingestion_runs to authenticated;
grant all on public.ingestion_runs to service_role;
alter table public.ingestion_runs enable row level security;

drop policy if exists ingestion_runs_select on public.ingestion_runs;
create policy ingestion_runs_select on public.ingestion_runs for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists ingestion_runs_write on public.ingestion_runs;
create policy ingestion_runs_write on public.ingestion_runs for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));
