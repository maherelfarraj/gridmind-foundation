-- P-107 preventive maintenance plans
do $$ begin
  create type pm_frequency as enum ('weekly','monthly','quarterly','semiannual','annual');
exception when duplicate_object then null; end $$;

create table if not exists public.preventive_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id),
  equipment_id uuid references public.equipment_registry(id) on delete cascade,
  title text not null,
  description text,
  frequency pm_frequency not null,
  interval_days int not null default 30,
  next_due_date date not null,
  last_generated_at timestamptz,
  checklist jsonb not null default '[]'::jsonb,
  estimated_hours numeric(6,2),
  default_assignee uuid references public.profiles(id),
  auto_generate boolean not null default true,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.preventive_maintenance_plans to authenticated;
grant all on public.preventive_maintenance_plans to service_role;

alter table public.preventive_maintenance_plans enable row level security;

create policy pm_plans_select on public.preventive_maintenance_plans
  for select to authenticated
  using (public.is_company_member(company_id));

create policy pm_plans_write on public.preventive_maintenance_plans
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_company_role('om_admin') or public.has_company_role('company_admin'))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_company_role('om_admin') or public.has_company_role('company_admin'))
  );

create index if not exists pm_plans_due_idx
  on public.preventive_maintenance_plans(company_id, active, auto_generate, next_due_date);

drop trigger if exists pm_plans_set_updated_at on public.preventive_maintenance_plans;
create trigger pm_plans_set_updated_at
  before update on public.preventive_maintenance_plans
  for each row execute function public.set_updated_at();
