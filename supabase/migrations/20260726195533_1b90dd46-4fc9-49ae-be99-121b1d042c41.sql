-- 0072_scada_workflow_rules.sql — SCADA-to-O&M action rules + execution log. Idempotent.

do $$ begin
  create type public.event_action_type as enum
    ('create_incident','create_work_order','assign_technician','spare_parts_request',
     'warranty_claim','hse_escalation','client_notification','lender_report_exception',
     'performance_ld_assessment');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.event_action_status as enum
    ('pending_approval','approved','executed','rejected','failed','skipped');
exception when duplicate_object then null; end $$;

create table if not exists public.event_action_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id),
  name text not null,
  event_type public.scada_event_type not null,
  min_severity public.alarm_severity not null default 'warning',
  match jsonb not null default '{}',
  action_type public.event_action_type not null,
  action_config jsonb not null default '{}',
  requires_approval boolean not null default true,
  approval_rule_key text not null default 'scada_event_action',
  ai_assist boolean not null default false,
  enabled boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
create table if not exists public.event_action_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  rule_id uuid references public.event_action_rules(id) on delete set null,
  scada_event_id uuid references public.scada_events(id) on delete set null,
  action_type public.event_action_type not null,
  status public.event_action_status not null default 'pending_approval',
  approval_instance_id uuid references public.approval_instances(id) on delete set null,
  ai_suggestion jsonb,
  result_entity text,
  result_entity_id uuid,
  executed_by uuid references public.profiles(id),
  executed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_id, scada_event_id)
);
create index if not exists event_action_rules_company_idx
  on public.event_action_rules(company_id, enabled, event_type);
create index if not exists event_action_log_company_idx
  on public.event_action_log(company_id, status, created_at desc);
create index if not exists event_action_log_event_idx on public.event_action_log(scada_event_id);

alter table public.event_action_rules enable row level security;
alter table public.event_action_log enable row level security;
drop policy if exists ear_select on public.event_action_rules;
create policy ear_select on public.event_action_rules for select to authenticated
  using (public.is_company_member(company_id));
drop policy if exists ear_write on public.event_action_rules;
create policy ear_write on public.event_action_rules for all to authenticated
  using (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (public.has_company_role('om_admin')
    or public.has_company_role('scada_admin') or public.has_company_role('company_admin')));
drop policy if exists eal_select on public.event_action_log;
create policy eal_select on public.event_action_log for select to authenticated
  using (public.is_company_member(company_id));
grant select on public.event_action_log to authenticated;
grant select, insert, update, delete on public.event_action_rules to authenticated;
grant all on public.event_action_rules to service_role;
grant all on public.event_action_log to service_role;
drop trigger if exists trg_ear_updated on public.event_action_rules;
create trigger trg_ear_updated before update on public.event_action_rules
  for each row execute function public.set_updated_at();
drop trigger if exists trg_eal_updated on public.event_action_log;
create trigger trg_eal_updated before update on public.event_action_log
  for each row execute function public.set_updated_at();
