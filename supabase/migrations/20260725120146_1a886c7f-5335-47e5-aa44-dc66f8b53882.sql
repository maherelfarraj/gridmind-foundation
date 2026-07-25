-- P-110 — Monthly O&M report snapshots + PDF path.

do $$ begin
  create type om_report_type as enum ('monthly','quarterly','annual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type om_report_status as enum ('draft','generated','sent');
exception when duplicate_object then null; end $$;

create table if not exists public.om_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  report_type om_report_type not null default 'monthly',
  period_start date not null,
  period_end date not null,
  status om_report_status not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  pdf_path text,
  generated_by uuid references profiles(id),
  generated_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, report_type, period_start)
);

grant select, insert, update, delete on public.om_reports to authenticated;
grant all on public.om_reports to service_role;

alter table public.om_reports enable row level security;

create policy om_reports_select on public.om_reports
  for select to authenticated
  using (is_company_member(company_id));

create policy om_reports_write on public.om_reports
  for all to authenticated
  using (
    is_company_member(company_id)
    and (has_company_role('om_admin') or has_company_role('company_admin'))
  )
  with check (
    is_company_member(company_id)
    and (has_company_role('om_admin') or has_company_role('company_admin'))
  );

create index if not exists om_reports_company_idx
  on public.om_reports(company_id, period_start desc);
create index if not exists om_reports_project_idx
  on public.om_reports(project_id, period_start desc);

drop trigger if exists om_reports_set_updated_at on public.om_reports;
create trigger om_reports_set_updated_at
  before update on public.om_reports
  for each row execute function public.set_updated_at();