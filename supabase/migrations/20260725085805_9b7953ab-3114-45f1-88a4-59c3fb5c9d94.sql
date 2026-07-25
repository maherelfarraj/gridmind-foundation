
do $$ begin create type public.hse_incident_type as enum ('injury','near_miss','property_damage','environmental','security'); exception when duplicate_object then null; end $$;
do $$ begin create type public.hse_incident_severity as enum ('minor','moderate','major','critical','fatal'); exception when duplicate_object then null; end $$;
do $$ begin create type public.hse_incident_status as enum ('open','investigating','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.hse_inspection_status as enum ('scheduled','completed','closed'); exception when duplicate_object then null; end $$;

create table if not exists public.hse_incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  incident_number text not null,
  incident_type public.hse_incident_type not null,
  severity public.hse_incident_severity not null default 'minor',
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  location text,
  description text not null,
  persons_involved text,
  days_away_from_work int not null default 0,
  restricted_duty boolean not null default false,
  medical_treatment boolean not null default false,
  osha_recordable boolean not null default false,
  status public.hse_incident_status not null default 'open',
  corrective_actions jsonb not null default '[]'::jsonb,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, incident_number)
);

create table if not exists public.hse_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  inspection_date date not null,
  inspection_type text not null default 'routine',
  inspector_id uuid references public.profiles(id),
  area text,
  checklist jsonb not null default '[]'::jsonb,
  findings_count int not null default 0,
  open_findings int not null default 0,
  status public.hse_inspection_status not null default 'scheduled',
  due_date date,
  closed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hse_training_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  profile_id uuid references public.profiles(id),
  person_name text not null,
  course text not null,
  provider text,
  completed_on date not null,
  expires_on date,
  certificate_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.hse_incidents to authenticated;
grant select, insert, update on public.hse_inspections to authenticated;
grant select, insert, update on public.hse_training_records to authenticated;
grant all on public.hse_incidents to service_role;
grant all on public.hse_inspections to service_role;
grant all on public.hse_training_records to service_role;

alter table public.hse_incidents enable row level security;
alter table public.hse_inspections enable row level security;
alter table public.hse_training_records enable row level security;

create policy incidents_select on public.hse_incidents for select to authenticated
  using (public.is_company_member(company_id));
create policy incidents_insert on public.hse_incidents for insert to authenticated
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('construction_admin'::public.app_role)
      or public.has_company_role('foreman'::public.app_role)
      or public.has_company_role('field_technician'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );
create policy incidents_update on public.hse_incidents for update to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('construction_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('construction_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );

create policy inspections_select on public.hse_inspections for select to authenticated
  using (public.is_company_member(company_id));
create policy inspections_write on public.hse_inspections for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );

create policy training_select on public.hse_training_records for select to authenticated
  using (public.is_company_member(company_id));
create policy training_write on public.hse_training_records for all to authenticated
  using (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  )
  with check (
    public.is_company_member(company_id) and (
      public.has_company_role('hse_admin'::public.app_role)
      or public.has_company_role('company_admin'::public.app_role)
    )
  );

create index if not exists incidents_project_status_idx
  on public.hse_incidents(company_id, project_id, status, occurred_at);
create index if not exists inspections_project_idx
  on public.hse_inspections(company_id, project_id, inspection_date);
create index if not exists training_expiry_idx
  on public.hse_training_records(company_id, expires_on);

drop trigger if exists trg_hse_incidents_updated_at on public.hse_incidents;
create trigger trg_hse_incidents_updated_at
  before update on public.hse_incidents
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hse_inspections_updated_at on public.hse_inspections;
create trigger trg_hse_inspections_updated_at
  before update on public.hse_inspections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_hse_training_updated_at on public.hse_training_records;
create trigger trg_hse_training_updated_at
  before update on public.hse_training_records
  for each row execute function public.set_updated_at();
