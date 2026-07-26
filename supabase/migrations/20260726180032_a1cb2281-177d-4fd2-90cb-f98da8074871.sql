-- 0069_ea_studies.sql — Electrical-analysis study record (Batch 19 / P-165). Idempotent.

do $$ begin
  create type public.ea_study_type as enum (
    'load_flow','short_circuit','cable_ampacity','voltage_drop','transformer_loading',
    'motor_starting','protection_schedule','harmonics','grounding','arc_flash',
    'dc_system','aux_ac','ups_battery','generator_sizing','capacitor_bank',
    'reactive_power','pf_correction','grid_code_checklist'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ea_study_status as enum ('draft','under_review','approved');
exception when duplicate_object then null; end $$;

create table if not exists public.ea_studies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  study_number text not null,
  title text not null,
  study_type public.ea_study_type not null,
  revision int not null default 0,
  status public.ea_study_status not null default 'draft',
  input_sheet jsonb not null default '{}',
  assumptions jsonb not null default '[]',
  method text not null default '',
  results jsonb not null default '{}',
  warnings jsonb not null default '[]',
  standards_ref text[] not null default '{}',
  reviewer_id uuid references public.profiles(id),
  approval_instance_id uuid references public.approval_instances(id),
  submitted_at timestamptz,
  approved_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, study_number)
);

create table if not exists public.ea_study_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  study_id uuid not null references public.ea_studies(id) on delete cascade,
  revision int not null,
  status public.ea_study_status not null default 'draft',
  input_sheet jsonb not null default '{}',
  assumptions jsonb not null default '[]',
  method text not null default '',
  results jsonb not null default '{}',
  warnings jsonb not null default '[]',
  standards_ref text[] not null default '{}',
  change_summary text,
  reviewer_id uuid references public.profiles(id),
  approval_instance_id uuid references public.approval_instances(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (study_id, revision)
);

create index if not exists ea_studies_project_type_idx
  on public.ea_studies(project_id, study_type);
create index if not exists ea_studies_project_status_idx
  on public.ea_studies(project_id, status);
create index if not exists ea_study_revisions_study_idx
  on public.ea_study_revisions(study_id, revision desc);

drop trigger if exists set_updated_at on public.ea_studies;
create trigger set_updated_at before update on public.ea_studies
  for each row execute function public.set_updated_at();
drop trigger if exists set_updated_at on public.ea_study_revisions;
create trigger set_updated_at before update on public.ea_study_revisions
  for each row execute function public.set_updated_at();

create or replace function public.ea_study_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'approved' and new.revision = old.revision
     and (new.input_sheet is distinct from old.input_sheet
          or new.results is distinct from old.results
          or new.method is distinct from old.method) then
    raise exception 'ea_study_immutable: approved studies change only via a new revision';
  end if;
  return new;
end $$;
drop trigger if exists ea_study_guard on public.ea_studies;
create trigger ea_study_guard before update on public.ea_studies
  for each row execute function public.ea_study_guard();

alter table public.ea_studies enable row level security;
alter table public.ea_study_revisions enable row level security;

drop policy if exists ea_studies_select on public.ea_studies;
create policy ea_studies_select on public.ea_studies for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_studies_insert on public.ea_studies;
create policy ea_studies_insert on public.ea_studies for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')));
drop policy if exists ea_studies_update on public.ea_studies;
create policy ea_studies_update on public.ea_studies for update to authenticated
  using (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')));

drop policy if exists ea_rev_select on public.ea_study_revisions;
create policy ea_rev_select on public.ea_study_revisions for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());
drop policy if exists ea_rev_insert on public.ea_study_revisions;
create policy ea_rev_insert on public.ea_study_revisions for insert to authenticated
  with check (public.is_company_member(company_id) and (
    public.has_role(auth.uid(),'engineer')
    or public.has_role(auth.uid(),'engineering_admin')
    or public.has_role(auth.uid(),'project_admin')));
-- No UPDATE/DELETE policies or grants on ea_study_revisions: append-only history.

grant select, insert, update on public.ea_studies to authenticated;
grant select, insert on public.ea_study_revisions to authenticated;
grant all on public.ea_studies to service_role;
grant all on public.ea_study_revisions to service_role;

insert into public.approval_rules
  (company_id, rule_key, name, entity_type, sla_hours, blocks_export, is_active)
select c.id, 'ea_study_approval', 'Electrical study approval', 'ea_study', 72, true, true
from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'engineer'::public.app_role
from public.approval_rules r where r.rule_key = 'ea_study_approval'
on conflict (rule_id, step_order) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'engineering_admin'::public.app_role
from public.approval_rules r where r.rule_key = 'ea_study_approval'
on conflict (rule_id, step_order) do nothing;