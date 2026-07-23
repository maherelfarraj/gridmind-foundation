
-- 1. Table
create table if not exists public.module_access_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  module text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_access_rules_module_check check (module in (
    'crm','engineering','procurement','planning_budget','field_qaqc',
    'commissioning','om_scada','portals','green_hydrogen'
  )),
  constraint module_access_rules_company_module_key unique (company_id, module)
);

create index if not exists module_access_rules_company_id_idx
  on public.module_access_rules(company_id);

-- updated_at trigger
drop trigger if exists update_module_access_rules_updated_at on public.module_access_rules;
create trigger update_module_access_rules_updated_at
  before update on public.module_access_rules
  for each row execute function public.update_updated_at_column();

-- 2. GRANTs
revoke all on public.module_access_rules from anon, public;
grant select, insert, update, delete on public.module_access_rules to authenticated;
grant all on public.module_access_rules to service_role;

-- 3. RLS + policies
alter table public.module_access_rules enable row level security;

drop policy if exists "module_access_rules_select_members" on public.module_access_rules;
create policy "module_access_rules_select_members"
  on public.module_access_rules
  for select
  to authenticated
  using (public.is_company_member(company_id));

drop policy if exists "module_access_rules_insert_admin" on public.module_access_rules;
create policy "module_access_rules_insert_admin"
  on public.module_access_rules
  for insert
  to authenticated
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "module_access_rules_update_admin" on public.module_access_rules;
create policy "module_access_rules_update_admin"
  on public.module_access_rules
  for update
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  with check (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "module_access_rules_delete_admin" on public.module_access_rules;
create policy "module_access_rules_delete_admin"
  on public.module_access_rules
  for delete
  to authenticated
  using (
    public.is_company_admin(company_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- 4. has_module_access helper
create or replace function public.has_module_access(p_company_id uuid, p_module text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_override boolean;
  v_baseline boolean;
begin
  select plan_tier into v_plan
  from public.companies
  where id = p_company_id;

  if v_plan is null then
    return false;
  end if;

  -- Hard rule: green_hydrogen requires enterprise, no override can bypass.
  if p_module = 'green_hydrogen' and v_plan <> 'enterprise' then
    return false;
  end if;

  -- Baseline by plan tier.
  v_baseline := case
    when v_plan = 'starter' then
      p_module in ('crm','engineering','procurement','planning_budget')
    when v_plan = 'growth' then
      p_module in ('crm','engineering','procurement','planning_budget',
                   'field_qaqc','commissioning','portals')
    when v_plan = 'enterprise' then
      p_module in ('crm','engineering','procurement','planning_budget',
                   'field_qaqc','commissioning','portals','om_scada','green_hydrogen')
    else false
  end;

  -- Override lookup.
  select enabled into v_override
  from public.module_access_rules
  where company_id = p_company_id
    and module = p_module;

  if v_override is not null then
    return v_override;
  end if;

  return v_baseline;
end;
$$;

revoke execute on function public.has_module_access(uuid, text) from public, anon;
grant execute on function public.has_module_access(uuid, text) to authenticated, service_role;
