-- P-083 — Field core (Stage 5 Build/Field data backbone).

-- Enums (guarded)
do $$ begin create type public.dpr_status as enum ('draft','submitted','approved'); exception when duplicate_object then null; end $$;
do $$ begin create type public.observation_severity as enum ('low','medium','high','critical'); exception when duplicate_object then null; end $$;
do $$ begin create type public.observation_status as enum ('open','in_progress','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.weather_delay_type as enum ('rain','wind','heat','cold','dust_storm','lightning','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.offline_queue_status as enum ('pending','synced','failed'); exception when duplicate_object then null; end $$;

-- Tables
create table if not exists public.construction_daily_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  report_date date not null,
  shift text not null default 'day' check (shift in ('day','night')),
  status dpr_status not null default 'draft',
  weather_summary text,
  temperature_high_c numeric(4,1),
  temperature_low_c numeric(4,1),
  work_summary text,
  constraints_notes text,
  quantities jsonb not null default '[]',
  total_manpower int not null default 0,
  total_hours numeric(8,2) not null default 0,
  submitted_by uuid references profiles(id),
  submitted_at timestamptz,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, project_id, report_date, shift)
);

create table if not exists public.manpower_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  dpr_id uuid not null references construction_daily_reports(id) on delete cascade,
  trade text not null,
  contractor text,
  headcount int not null check (headcount >= 0),
  hours numeric(5,2) not null default 8,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.field_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  dpr_id uuid references construction_daily_reports(id) on delete set null,
  discipline text not null default 'general',
  area text,
  severity observation_severity not null default 'low',
  status observation_status not null default 'open',
  description text not null,
  action_required text,
  due_date date,
  raised_by uuid references profiles(id),
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weather_delays (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  dpr_id uuid references construction_daily_reports(id) on delete set null,
  delay_date date not null,
  delay_type weather_delay_type not null,
  start_time time,
  end_time time,
  lost_hours numeric(4,1) not null default 0,
  wbs_item_id uuid references wbs_items(id),
  impact_notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid not null references projects(id),
  dpr_id uuid references construction_daily_reports(id) on delete set null,
  observation_id uuid references field_observations(id) on delete set null,
  file_path text not null,
  caption text,
  discipline text,
  area text,
  taken_at timestamptz not null default now(),
  latitude numeric(9,6),
  longitude numeric(9,6),
  uploaded_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.offline_queue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  project_id uuid references projects(id),
  user_id uuid not null references profiles(id),
  client_idempotency_key text not null,
  entity text not null,
  action text not null,
  payload jsonb not null default '{}',
  status offline_queue_status not null default 'pending',
  error text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id, client_idempotency_key)
);

-- RLS
alter table public.construction_daily_reports enable row level security;
alter table public.manpower_logs enable row level security;
alter table public.field_observations enable row level security;
alter table public.weather_delays enable row level security;
alter table public.site_photos enable row level security;
alter table public.offline_queue enable row level security;

-- Policies (drop-if-exists then create for idempotency)
drop policy if exists dpr_select on public.construction_daily_reports;
drop policy if exists dpr_write on public.construction_daily_reports;
create policy dpr_select on public.construction_daily_reports for select to authenticated using (is_company_member(company_id));
create policy dpr_write on public.construction_daily_reports for all to authenticated
  using (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')));

drop policy if exists manpower_select on public.manpower_logs;
drop policy if exists manpower_write on public.manpower_logs;
create policy manpower_select on public.manpower_logs for select to authenticated using (is_company_member(company_id));
create policy manpower_write on public.manpower_logs for all to authenticated
  using (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')));

drop policy if exists observations_select on public.field_observations;
drop policy if exists observations_write on public.field_observations;
create policy observations_select on public.field_observations for select to authenticated using (is_company_member(company_id));
create policy observations_write on public.field_observations for all to authenticated
  using (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('hse_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('hse_admin') or has_company_role('company_admin')));

drop policy if exists weather_select on public.weather_delays;
drop policy if exists weather_write on public.weather_delays;
create policy weather_select on public.weather_delays for select to authenticated using (is_company_member(company_id));
create policy weather_write on public.weather_delays for all to authenticated
  using (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('company_admin')));

drop policy if exists photos_select on public.site_photos;
drop policy if exists photos_write on public.site_photos;
create policy photos_select on public.site_photos for select to authenticated using (is_company_member(company_id));
create policy photos_write on public.site_photos for all to authenticated
  using (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('hse_admin') or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (has_company_role('construction_admin') or has_company_role('foreman') or has_company_role('field_technician') or has_company_role('hse_admin') or has_company_role('company_admin')));

drop policy if exists offline_select on public.offline_queue;
drop policy if exists offline_insert on public.offline_queue;
drop policy if exists offline_update on public.offline_queue;
create policy offline_select on public.offline_queue for select to authenticated
  using (is_company_member(company_id) and (user_id = auth.uid() or has_company_role('construction_admin') or has_company_role('company_admin')));
create policy offline_insert on public.offline_queue for insert to authenticated
  with check (is_company_member(company_id) and user_id = auth.uid());
create policy offline_update on public.offline_queue for update to authenticated
  using (is_company_member(company_id) and user_id = auth.uid())
  with check (is_company_member(company_id) and user_id = auth.uid());

-- Grants
grant select on public.construction_daily_reports, public.manpower_logs, public.field_observations, public.weather_delays, public.site_photos, public.offline_queue to authenticated;
grant insert, update, delete on public.construction_daily_reports, public.manpower_logs to authenticated;
grant insert, update on public.field_observations, public.weather_delays, public.site_photos to authenticated;
grant insert, update on public.offline_queue to authenticated;

-- Indexes
create index if not exists dpr_company_project_date_idx on public.construction_daily_reports(company_id, project_id, report_date);
create index if not exists manpower_dpr_idx on public.manpower_logs(dpr_id);
create index if not exists observations_project_status_idx on public.field_observations(company_id, project_id, status);
create index if not exists weather_project_date_idx on public.weather_delays(company_id, project_id, delay_date);
create index if not exists photos_dpr_idx on public.site_photos(dpr_id);
create index if not exists photos_observation_idx on public.site_photos(observation_id);
create index if not exists offline_user_status_idx on public.offline_queue(user_id, status);

-- Updated-at triggers
drop trigger if exists trg_updated_at on public.construction_daily_reports;
create trigger trg_updated_at before update on public.construction_daily_reports for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.manpower_logs;
create trigger trg_updated_at before update on public.manpower_logs for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.field_observations;
create trigger trg_updated_at before update on public.field_observations for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.weather_delays;
create trigger trg_updated_at before update on public.weather_delays for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.site_photos;
create trigger trg_updated_at before update on public.site_photos for each row execute function public.set_updated_at();
drop trigger if exists trg_updated_at on public.offline_queue;
create trigger trg_updated_at before update on public.offline_queue for each row execute function public.set_updated_at();
