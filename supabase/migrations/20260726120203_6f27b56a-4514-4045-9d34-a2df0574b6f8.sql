create table if not exists public.sld_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  revision_id uuid not null references public.sld_revisions(id) on delete cascade,
  schedule_type text not null check (schedule_type in
    ('boq','equipment','cable','protection','legend','title_block')),
  rows jsonb not null default '[]',
  row_count int not null default 0,
  generated_by uuid references public.profiles(id),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, schedule_type)
);

create index if not exists sld_schedules_revision_idx on public.sld_schedules(revision_id);
create index if not exists sld_schedules_company_idx on public.sld_schedules(company_id);

grant select, insert, update on public.sld_schedules to authenticated;
grant all on public.sld_schedules to service_role;

alter table public.sld_schedules enable row level security;
alter table public.sld_schedules force row level security;

drop policy if exists sld_schedules_select on public.sld_schedules;
create policy sld_schedules_select on public.sld_schedules for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists sld_schedules_write on public.sld_schedules;
create policy sld_schedules_write on public.sld_schedules for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'engineer')
      or public.has_role(auth.uid(), 'project_admin')
    )
  );

drop policy if exists sld_schedules_update on public.sld_schedules;
create policy sld_schedules_update on public.sld_schedules for update to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'engineer')
      or public.has_role(auth.uid(), 'project_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'engineer')
      or public.has_role(auth.uid(), 'project_admin')
    )
  );

drop trigger if exists sld_schedules_set_updated_at on public.sld_schedules;
create trigger sld_schedules_set_updated_at
  before update on public.sld_schedules
  for each row execute function public.set_updated_at();