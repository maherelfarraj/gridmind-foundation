
create table if not exists public.approval_instances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  entity text not null,
  entity_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  instance_id uuid not null references public.approval_instances(id) on delete cascade,
  approver_id uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  comment text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'gates_approval_fk'
  ) then
    alter table public.project_phase_gates
      add constraint gates_approval_fk
      foreign key (approval_instance_id) references public.approval_instances(id);
  end if;
end $$;

grant select, insert, update on public.approval_instances to authenticated;
grant select, insert, update on public.approvals to authenticated;
grant all on public.approval_instances to service_role;
grant all on public.approvals to service_role;

alter table public.approval_instances enable row level security;
alter table public.approvals enable row level security;

drop policy if exists instances_select on public.approval_instances;
drop policy if exists instances_insert on public.approval_instances;
drop policy if exists instances_update on public.approval_instances;
drop policy if exists approvals_select on public.approvals;
drop policy if exists approvals_insert on public.approvals;
drop policy if exists approvals_update on public.approvals;

create policy instances_select on public.approval_instances for select to authenticated
  using (public.is_company_member(company_id));
create policy instances_insert on public.approval_instances for insert to authenticated
  with check (public.is_company_member(company_id) and requested_by = auth.uid());
create policy instances_update on public.approval_instances for update to authenticated
  using (public.has_company_role('company_admin') or public.has_company_role('project_admin')
         or requested_by = auth.uid());

create policy approvals_select on public.approvals for select to authenticated
  using (public.is_company_member(company_id));
create policy approvals_insert on public.approvals for insert to authenticated
  with check (public.is_company_member(company_id));
create policy approvals_update on public.approvals for update to authenticated
  using (approver_id = auth.uid() or public.has_company_role('company_admin'));

drop trigger if exists trg_instances_updated on public.approval_instances;
create trigger trg_instances_updated before update on public.approval_instances
  for each row execute function public.set_updated_at();

drop trigger if exists trg_approvals_updated on public.approvals;
create trigger trg_approvals_updated before update on public.approvals
  for each row execute function public.set_updated_at();

-- Normalize legacy checklist rows to {key,label,required,done}
update public.project_phase_gates
   set checklist = coalesce((
     select jsonb_agg(
       case
         when item ? 'key' then item
         else jsonb_build_object(
           'key', lower(regexp_replace(coalesce(item->>'name', item->>'label',''), '\W+', '_', 'g')),
           'label', coalesce(item->>'label', item->>'name',''),
           'required', coalesce((item->>'required')::boolean, true),
           'done', coalesce((item->>'done')::boolean, false)
         )
       end
     )
     from jsonb_array_elements(checklist) item
   ), '[]'::jsonb)
 where jsonb_typeof(checklist) = 'array'
   and exists (select 1 from jsonb_array_elements(checklist) i where not (i ? 'key'));
