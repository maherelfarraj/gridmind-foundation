-- 0075_construction_governance.sql — part 3: HSE expansion (idempotent)
do $$ begin create type public.ra_status as enum ('draft','active','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.safety_obs_type as enum ('safe_act','unsafe_act','unsafe_condition'); exception when duplicate_object then null; end $$;
do $$ begin create type public.emergency_kind as enum ('drill','actual'); exception when duplicate_object then null; end $$;
do $$ begin create type public.audit_checklist_status as enum ('scheduled','completed','closed'); exception when duplicate_object then null; end $$;

create table if not exists public.risk_assessments (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  ra_number text not null, title text not null, activity text not null,
  hazards jsonb not null default '[]',
  review_date date, status public.ra_status not null default 'draft',
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  approval_instance_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (company_id, ra_number)
);

create table if not exists public.job_safety_analyses (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  jsa_number text not null, task text not null,
  risk_assessment_id uuid references public.risk_assessments(id) on delete set null,
  steps jsonb not null default '[]', status public.ra_status not null default 'draft',
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  approval_instance_id uuid,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (company_id, jsa_number)
);

create table if not exists public.safety_observations (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  obs_number text not null, obs_type public.safety_obs_type not null,
  location text, description text not null, action_taken text,
  severity public.observation_severity not null default 'low',
  status public.observation_status not null default 'open',
  photo_path text,
  raised_by uuid references public.profiles(id), closed_by uuid references public.profiles(id), closed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (company_id, obs_number)
);

create table if not exists public.competency_records (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  worker_name text not null, employer text, competency text not null,
  certificate_number text, issued_date date, expiry_date date, file_path text,
  verified_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.emergency_response (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  kind public.emergency_kind not null,
  event_type text not null check (event_type in ('medical','fire','env_spill','security','weather','other')),
  occurred_at timestamptz not null,
  response_time_minutes numeric(6,1),
  casualties int not null default 0 check (casualties >= 0),
  report text, lessons_learned text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.environmental_monitoring (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  metric text not null check (metric in ('noise_db','dust_pm25','water_quality','soil','emissions')),
  value numeric(12,4) not null, uom text not null, limit_value numeric(12,4),
  exceedance boolean not null default false, location text,
  measured_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.waste_tracking (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  waste_type text not null check (waste_type in ('general','hazardous','recyclable','construction')),
  qty numeric(12,3) not null check (qty > 0), uom text not null default 'kg',
  disposal_method text, contractor text, manifest_number text,
  disposal_date date not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.site_audit_checklists (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  title text not null, audit_date date not null,
  auditor uuid references public.profiles(id),
  items jsonb not null default '[]',
  findings_count int not null default 0, score_pct numeric(5,2),
  status public.audit_checklist_status not null default 'scheduled',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists safety_obs_project_status_idx on public.safety_observations (project_id, status);
create index if not exists competency_expiry_idx on public.competency_records (company_id, expiry_date);
create index if not exists env_project_metric_idx on public.environmental_monitoring (project_id, metric, measured_at desc);
create index if not exists waste_project_date_idx on public.waste_tracking (project_id, disposal_date desc);

-- grants, rls, policies and updated_at triggers, generated idempotently
do $$
declare
  t text;
  hse_tables text[] := array[
    'risk_assessments','job_safety_analyses','safety_observations','competency_records',
    'emergency_response','environmental_monitoring','waste_tracking','site_audit_checklists'];
  admin_roles text := 'public.has_company_role(''hse_admin''::public.app_role)'
             || ' or public.has_company_role(''construction_admin''::public.app_role)'
             || ' or public.has_company_role(''company_admin''::public.app_role)';
  site_roles text := 'public.has_company_role(''hse_admin''::public.app_role)'
             || ' or public.has_company_role(''construction_admin''::public.app_role)'
             || ' or public.has_company_role(''foreman''::public.app_role)'
             || ' or public.has_company_role(''field_technician''::public.app_role)'
             || ' or public.has_company_role(''company_admin''::public.app_role)';
begin
  foreach t in array hse_tables loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_company_member(company_id))',
      t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    if t = 'safety_observations' then
      -- anyone on site can report an observation; only HSE/construction admins can edit or close
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (public.is_company_member(company_id) and (%s))',
        t || '_insert', t, site_roles);
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_company_member(company_id) and (%s)) with check (public.is_company_member(company_id) and (%s))',
        t || '_write', t, admin_roles, admin_roles);
    else
      execute format(
        'create policy %I on public.%I for all to authenticated using (public.is_company_member(company_id) and (%s)) with check (public.is_company_member(company_id) and (%s))',
        t || '_write', t, admin_roles, admin_roles);
    end if;

    execute format('drop trigger if exists trg_updated_at on public.%I', t);
    execute format(
      'create trigger trg_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t);
  end loop;
end $$;