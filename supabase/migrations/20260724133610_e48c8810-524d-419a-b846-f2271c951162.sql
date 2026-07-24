
do $$ begin
  create type public.proposal_status as enum
    ('draft','in_review','approved','sent','viewed','accepted',
     'rejected','expired','superseded');
exception when duplicate_object then null; end $$;

create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  version int not null default 1 check (version >= 1),
  previous_version_id uuid references public.proposals(id) on delete set null,
  status public.proposal_status not null default 'draft',
  currency_code text not null default 'USD',
  subtotal numeric(18,2) not null default 0,
  margin_pct numeric(6,3),
  fx_rate_snapshot numeric(18,6),
  contingency_pct numeric(6,3) not null default 0,
  total numeric(18,2) not null default 0,
  valid_until date,
  array_config jsonb not null default '{}'::jsonb,
  yield_result jsonb,
  pricing_lock jsonb,
  esign_provider text,
  esign_envelope_id text,
  esign_status text check (esign_status in
    ('sent','viewed','completed','declined','voided')),
  esign_history jsonb not null default '[]'::jsonb,
  esign_sent_at timestamptz,
  esign_completed_at timestamptz,
  signed_copy_path text,
  sent_at timestamptz,
  accepted_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.proposal_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  sort_order int not null default 0,
  category text not null default 'equipment' check (category in
    ('equipment','installation','civil','electrical','engineering',
     'contingency','other')),
  description text not null,
  qty numeric(14,3) not null default 1 check (qty >= 0),
  unit text not null default 'ea',
  unit_price numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_proposals_company_opp
  on public.proposals(company_id, opportunity_id, status);
create index if not exists idx_proposal_line_items_proposal
  on public.proposal_line_items(proposal_id, sort_order);

grant select, insert, update, delete on public.proposals to authenticated;
grant all on public.proposals to service_role;
grant select, insert, update, delete on public.proposal_line_items to authenticated;
grant all on public.proposal_line_items to service_role;

alter table public.proposals enable row level security;
alter table public.proposal_line_items enable row level security;

-- proposals policies
drop policy if exists proposals_select on public.proposals;
create policy proposals_select on public.proposals for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  );

drop policy if exists proposals_update on public.proposals;
create policy proposals_update on public.proposals for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  );

drop policy if exists proposals_delete on public.proposals;
create policy proposals_delete on public.proposals for delete to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_role(auth.uid(),'company_admin'::app_role)
  );

-- proposal_line_items policies
drop policy if exists proposal_line_items_select on public.proposal_line_items;
create policy proposal_line_items_select on public.proposal_line_items for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists proposal_line_items_insert on public.proposal_line_items;
create policy proposal_line_items_insert on public.proposal_line_items for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  );

drop policy if exists proposal_line_items_update on public.proposal_line_items;
create policy proposal_line_items_update on public.proposal_line_items for update to authenticated
  using (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  )
  with check (
    public.is_company_member(company_id)
    and (public.has_role(auth.uid(),'sales'::app_role)
         or public.has_role(auth.uid(),'company_admin'::app_role))
  );

drop policy if exists proposal_line_items_delete on public.proposal_line_items;
create policy proposal_line_items_delete on public.proposal_line_items for delete to authenticated
  using (
    public.is_company_member(company_id)
    and public.has_role(auth.uid(),'company_admin'::app_role)
  );

-- immutability guard: financial fields frozen once status leaves draft/in_review
create or replace function public.proposals_guard_immutable() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status not in ('draft','in_review') and (
       new.subtotal is distinct from old.subtotal
       or new.total is distinct from old.total
       or new.margin_pct is distinct from old.margin_pct
       or new.fx_rate_snapshot is distinct from old.fx_rate_snapshot
       or new.contingency_pct is distinct from old.contingency_pct) then
    raise exception 'proposal % is % — create a new version to change pricing',
      old.id, old.status;
  end if;
  return new;
end $$;

drop trigger if exists trg_proposals_immutable on public.proposals;
create trigger trg_proposals_immutable before update on public.proposals
  for each row execute function public.proposals_guard_immutable();

drop trigger if exists trg_proposals_updated_at on public.proposals;
create trigger trg_proposals_updated_at before update on public.proposals
  for each row execute function public.set_updated_at();

drop trigger if exists trg_proposal_line_items_updated_at on public.proposal_line_items;
create trigger trg_proposal_line_items_updated_at before update on public.proposal_line_items
  for each row execute function public.set_updated_at();
