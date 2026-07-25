do $$ begin
  create type public.commissioning_certificate_type as enum
    ('mechanical_completion','cod','ccc_transfer');
exception when duplicate_object then null; end $$;

create table if not exists public.commissioning_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid not null references public.projects(id) on delete cascade,
  certificate_type public.commissioning_certificate_type not null,
  certificate_number text not null,
  status text not null default 'draft'
    check (status in ('draft','pending_signatures','signed','void')),
  effective_date date,
  pr_at_cod numeric(6,3),
  payload jsonb not null default '{}',
  signatures jsonb not null default '[]',
  signed_pdf_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, certificate_type),
  unique (company_id, certificate_number)
);

grant select on public.commissioning_certificates to authenticated;
grant insert, update on public.commissioning_certificates to authenticated;
grant all on public.commissioning_certificates to service_role;

alter table public.commissioning_certificates enable row level security;

drop policy if exists commissioning_certificates_select on public.commissioning_certificates;
create policy commissioning_certificates_select on public.commissioning_certificates
  for select to authenticated using (is_company_member(company_id));

drop policy if exists commissioning_certificates_write on public.commissioning_certificates;
create policy commissioning_certificates_write on public.commissioning_certificates
  for all to authenticated
  using (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')))
  with check (is_company_member(company_id) and (
    has_company_role('construction_admin') or has_company_role('project_admin')
    or has_company_role('company_admin')));

create index if not exists commissioning_certificates_project_idx
  on public.commissioning_certificates(company_id, project_id, certificate_type);

drop trigger if exists trg_commissioning_certificates_updated on public.commissioning_certificates;
create trigger trg_commissioning_certificates_updated before update
  on public.commissioning_certificates
  for each row execute function public.set_updated_at();