create type public.project_archetype as enum
  ('utility_pv','standalone_bess','c_and_i_rooftop','hybrid_pv_bess',
   'onshore_wind','green_hydrogen','transmission_substation');
create type public.project_phase as enum ('development','ntp','cod','handover');
create type public.project_status as enum ('active','on_hold','completed','archived');
create type public.project_department as enum
  ('engineering','procurement','construction','hse','finance','legal','om','scada','billing');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  code text not null,
  archetype public.project_archetype not null,
  phase public.project_phase not null default 'development',
  status public.project_status not null default 'active',
  capacity_mw numeric(12,3),
  capacity_mwh numeric(12,3),
  site_name text, site_country text, site_region text,
  site_lat numeric(9,6), site_lng numeric(9,6),
  offtaker text, target_cod date, description text,
  template_id uuid,
  project_admin_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  project_role text not null default 'member'
    check (project_role in ('admin','member','viewer')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.project_departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  department public.project_department not null,
  lead_user_id uuid references public.profiles(id),
  status text not null default 'not_started'
    check (status in ('not_started','active','blocked','complete')),
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, department)
);

create table public.project_phase_gates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase public.project_phase not null,
  name text not null,
  sort_order int not null,
  status text not null default 'locked'
    check (status in ('locked','open','in_review','approved')),
  checklist jsonb not null default '[]',
  approval_instance_id uuid,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, phase)
);

do $$
declare t text;
begin
  foreach t in array array['projects','project_members','project_departments','project_phase_gates'] loop
    execute format('create trigger trg_%I_updated before update on public.%I
      for each row execute function public.set_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I_select on public.%I for select to authenticated
      using (public.is_company_member(company_id))', t, t);
    execute format('create policy %I_admin on public.%I for all to authenticated
      using (public.has_company_role(''company_admin''::app_role) or public.has_company_role(''project_admin''::app_role))
      with check (public.has_company_role(''company_admin''::app_role) or public.has_company_role(''project_admin''::app_role))', t, t);
    execute format('create index idx_%I_company on public.%I(company_id)', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

create policy departments_lead_update on public.project_departments for update
  to authenticated using (lead_user_id = auth.uid())
  with check (lead_user_id = auth.uid());

create index idx_projects_phase on public.projects(company_id, phase);
create index idx_project_members_project on public.project_members(project_id);
create index idx_project_members_user on public.project_members(user_id);
create index idx_project_departments_project on public.project_departments(project_id);
create index idx_phase_gates_project on public.project_phase_gates(project_id);

grant all on public.projects to service_role;
grant all on public.project_members to service_role;
grant all on public.project_departments to service_role;
grant all on public.project_phase_gates to service_role;

create or replace function public.audit_project_transition() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'project_phase_gates' and old.status is distinct from new.status then
    perform public.write_audit_log('project_gate.' || new.status, 'project_phase_gates', new.id,
      jsonb_build_object('project_id', new.project_id, 'phase', new.phase,
        'from', old.status, 'to', new.status));
  elsif TG_TABLE_NAME = 'projects' and old.phase is distinct from new.phase then
    perform public.write_audit_log('project.phase_change', 'projects', new.id,
      jsonb_build_object('from', old.phase, 'to', new.phase));
  end if;
  return new;
end $$;
create trigger trg_gate_audit after update on public.project_phase_gates
  for each row execute function public.audit_project_transition();
create trigger trg_project_phase_audit after update on public.projects
  for each row execute function public.audit_project_transition();