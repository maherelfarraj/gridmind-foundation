create table if not exists public.sld_export_artifacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  revision_id uuid not null references public.sld_revisions(id) on delete cascade,
  format text not null check (format in ('svg','pdf','png','json','csv','dxf')),
  storage_path text not null,
  file_name text not null,
  file_size_bytes bigint,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sld_export_artifacts_revision_idx on public.sld_export_artifacts (revision_id, created_at desc);
create index if not exists sld_export_artifacts_company_idx on public.sld_export_artifacts (company_id);

revoke all on public.sld_export_artifacts from anon;
grant select, insert on public.sld_export_artifacts to authenticated;
grant all on public.sld_export_artifacts to service_role;

alter table public.sld_export_artifacts enable row level security;

drop policy if exists sld_export_artifacts_select on public.sld_export_artifacts;
create policy sld_export_artifacts_select on public.sld_export_artifacts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists sld_export_artifacts_insert on public.sld_export_artifacts;
create policy sld_export_artifacts_insert on public.sld_export_artifacts
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'engineer')
      or public.has_role(auth.uid(), 'project_admin')
    )
  );

drop trigger if exists set_updated_at_sld_export_artifacts on public.sld_export_artifacts;
create trigger set_updated_at_sld_export_artifacts
  before update on public.sld_export_artifacts
  for each row execute function public.update_updated_at_column();