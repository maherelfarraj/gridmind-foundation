create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_company_created_idx
  on public.audit_logs(company_id, created_at desc);

create index if not exists audit_logs_entity_idx
  on public.audit_logs(entity, entity_id);

create table if not exists public.audit_log_retention_policies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  entity text not null,
  retention_days int not null default 2555
    check (retention_days >= 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, entity)
);

create table if not exists public.module_access_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, module)
);

create index if not exists module_access_rules_company_id_idx
  on public.module_access_rules(company_id);

-- Helper function: append-only audit log
create or replace function public.write_audit_log(
  p_action text, p_entity text, p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_company uuid;
  v_id uuid;
begin
  select company_id into v_company from public.profiles where id = auth.uid();
  if v_company is null then
    raise exception 'not_authenticated_or_no_company';
  end if;
  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_company, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_metadata,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- Grants
revoke all on public.audit_logs, public.audit_log_retention_policies, public.module_access_rules from anon;
grant select, insert on public.audit_logs to authenticated;
grant select, insert, update, delete on public.audit_log_retention_policies to authenticated;
grant select, insert, update, delete on public.module_access_rules to authenticated;
grant all on public.audit_logs, public.audit_log_retention_policies, public.module_access_rules to service_role;

revoke all on function public.write_audit_log(text, text, uuid, jsonb) from anon;
grant execute on function public.write_audit_log(text, text, uuid, jsonb) to authenticated, service_role;

-- Tighten existing helper grants (remove anon access)
revoke all on function public.has_module_access(uuid, text) from anon;
grant execute on function public.has_module_access(uuid, text) to authenticated, service_role;

-- Enable RLS
alter table public.audit_logs enable row level security;
alter table public.audit_log_retention_policies enable row level security;
alter table public.module_access_rules enable row level security;

-- Policies: audit_logs (append-only)
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (public.is_company_member(company_id));

-- Policies: audit_log_retention_policies
drop policy if exists retention_select on public.audit_log_retention_policies;
create policy retention_select on public.audit_log_retention_policies for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists retention_write on public.audit_log_retention_policies;
create policy retention_write on public.audit_log_retention_policies for all to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

-- Policies: module_access_rules
drop policy if exists module_access_rules_select on public.module_access_rules;
create policy module_access_rules_select on public.module_access_rules for select to authenticated
  using (public.is_company_member(company_id) or public.has_role(auth.uid(),'super_admin'));

drop policy if exists module_access_rules_write on public.module_access_rules;
create policy module_access_rules_write on public.module_access_rules for all to authenticated
  using (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'))
  with check (public.is_company_admin(company_id) or public.has_role(auth.uid(),'super_admin'));

-- updated_at triggers (function already exists)
drop trigger if exists update_audit_retention_updated_at on public.audit_log_retention_policies;
create trigger update_audit_retention_updated_at
  before update on public.audit_log_retention_policies
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_module_access_rules_updated_at on public.module_access_rules;
create trigger update_module_access_rules_updated_at
  before update on public.module_access_rules
  for each row execute function public.update_updated_at_column();