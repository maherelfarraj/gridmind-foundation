-- 0023 IFC release ceremony (P-060)
-- Stores prepared/released IFC packages with revision snapshots, role sign-offs,
-- and a distribution list. Backfills the design_freeze checklist item on
-- Development gates so the phase-gate engine coordinates with IFC releases.

-- =========================================================================
-- Tables
-- =========================================================================
create table if not exists public.ifc_releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  package_name text not null,
  notes text,
  revision_snapshot jsonb not null default '[]'::jsonb,
  distribution_list jsonb not null default '[]'::jsonb,
  status text not null default 'prepared'
    check (status in ('prepared','released','void')),
  prepared_by uuid references public.profiles(id),
  released_by uuid references public.profiles(id),
  released_at timestamptz,
  voided_by uuid references public.profiles(id),
  voided_at timestamptz,
  void_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.ifc_releases to authenticated;
grant all on public.ifc_releases to service_role;

alter table public.ifc_releases enable row level security;

create policy "ifc_releases_select_members"
  on public.ifc_releases for select
  to authenticated
  using (public.is_company_member(company_id));

create policy "ifc_releases_insert_admin"
  on public.ifc_releases for insert
  to authenticated
  with check (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'project_admin')
      or public.has_role(auth.uid(), 'company_admin')
      or public.has_role(auth.uid(), 'super_admin')
    )
  );

create policy "ifc_releases_update_admin"
  on public.ifc_releases for update
  to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'project_admin')
      or public.has_role(auth.uid(), 'company_admin')
      or public.has_role(auth.uid(), 'super_admin')
    )
  );

create trigger trg_ifc_releases_updated_at
  before update on public.ifc_releases
  for each row execute function public.set_updated_at();

create index if not exists idx_ifc_releases_project_status
  on public.ifc_releases(project_id, status);

-- Sign-offs
create table if not exists public.ifc_release_signoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  release_id uuid not null references public.ifc_releases(id) on delete cascade,
  signer_id uuid not null references public.profiles(id),
  role_label text not null
    check (role_label in ('Lead Engineer','Engineering Manager','Project Director')),
  signature_text text not null,
  signed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(release_id, role_label)
);

grant select, insert on public.ifc_release_signoffs to authenticated;
grant all on public.ifc_release_signoffs to service_role;

alter table public.ifc_release_signoffs enable row level security;

create policy "ifc_signoffs_select_members"
  on public.ifc_release_signoffs for select
  to authenticated
  using (public.is_company_member(company_id));

create policy "ifc_signoffs_insert_admin"
  on public.ifc_release_signoffs for insert
  to authenticated
  with check (
    public.is_company_member(company_id)
    and signer_id = auth.uid()
    and (
      public.has_role(auth.uid(), 'engineering_admin')
      or public.has_role(auth.uid(), 'project_admin')
      or public.has_role(auth.uid(), 'company_admin')
      or public.has_role(auth.uid(), 'super_admin')
    )
  );

create index if not exists idx_ifc_signoffs_release
  on public.ifc_release_signoffs(release_id);

-- =========================================================================
-- Backfill: design_freeze checklist item on every Development gate.
-- Uses the {key,label,required,done} shape that toggleGateChecklistItem
-- normalizes to. Idempotent.
-- =========================================================================
update public.project_phase_gates
   set checklist = coalesce(checklist, '[]'::jsonb)
     || jsonb_build_array(jsonb_build_object(
          'key', 'design_freeze',
          'label', 'Design freeze — IFC package released',
          'required', true,
          'done', false
        ))
 where phase = 'development'
   and not exists (
     select 1
     from jsonb_array_elements(coalesce(checklist, '[]'::jsonb)) as it
     where it->>'key' = 'design_freeze'
        or it->>'name' = 'Design freeze — IFC package released'
   );