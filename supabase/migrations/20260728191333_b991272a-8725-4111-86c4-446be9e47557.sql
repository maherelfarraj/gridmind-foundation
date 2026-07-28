-- 0098_subcontract_core.sql — P-257 Batch 34: subcontracts, SOV lines, progress claims.

-- ---------------------------------------------------------------- enums
do $$ begin
  create type public.subcontract_status as enum
    ('draft','active','complete','terminated');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subcontract_claim_status as enum
    ('draft','submitted','under_review','certified','rejected');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------- counters
create table if not exists public.subcontract_counters (
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  last_number integer not null default 0,
  primary key (company_id, kind)
);
alter table public.subcontract_counters enable row level security;  -- trigger-only
grant all on public.subcontract_counters to service_role;

create or replace function public.next_subcontract_number(p_company_id uuid, p_kind text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  insert into public.subcontract_counters (company_id, kind, last_number)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind)
    do update set last_number = public.subcontract_counters.last_number + 1
  returning last_number into v_n;
  return v_n;
end $$;

revoke all on function public.next_subcontract_number(uuid, text) from public, anon, authenticated;
grant execute on function public.next_subcontract_number(uuid, text) to service_role;

-- --------------------------------------------------- portal seat helper
-- Mirrors the vendor-portal doctrine: a subcontractor is a vendor holding an
-- active, unexpired portal seat. Read-only, used by SELECT policies.
create or replace function public.sub_portal_has_seat(p_vendor_id uuid, p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.vendor_portal_memberships m
     where m.vendor_id = p_vendor_id
       and m.company_id = p_company_id
       and m.user_id = auth.uid()
       and m.status = 'active'
       and (m.expires_at is null or m.expires_at > now())
  )
$$;

revoke all on function public.sub_portal_has_seat(uuid, uuid) from public, anon;
grant execute on function public.sub_portal_has_seat(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------------------------ subcontracts
create table if not exists public.subcontracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  subcontract_number text,
  title text not null,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  scope_summary text,
  contract_value numeric(14,2) not null default 0 check (contract_value >= 0),
  currency_code text not null references public.currencies(code),
  retention_pct numeric(6,3) not null default 10
    check (retention_pct >= 0 and retention_pct <= 100),
  start_date date,
  end_date date,
  defects_liability_end date,
  status public.subcontract_status not null default 'draft',
  signed_document_path text,
  notes text,
  retention_held numeric(14,2) not null default 0,
  retention_released numeric(14,2) not null default 0,
  certified_to_date numeric(14,2) not null default 0,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subcontracts_number_unique unique (company_id, subcontract_number),
  constraint subcontracts_dates_ordered
    check (end_date is null or start_date is null or end_date >= start_date)
);

create index if not exists subcontracts_company_project_idx
  on public.subcontracts(company_id, project_id, status);
create index if not exists subcontracts_company_vendor_idx
  on public.subcontracts(company_id, vendor_id);

create or replace function public.subcontracts_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.subcontract_number is null then
    new.subcontract_number := 'SC-' || lpad(
      public.next_subcontract_number(new.company_id, 'subcontract')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists subcontracts_number_trg on public.subcontracts;
create trigger subcontracts_number_trg
  before insert on public.subcontracts
  for each row execute function public.subcontracts_before_insert();

drop trigger if exists subcontracts_updated_at on public.subcontracts;
create trigger subcontracts_updated_at
  before update on public.subcontracts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------- subcontract_lines
create table if not exists public.subcontract_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  subcontract_id uuid not null references public.subcontracts(id) on delete cascade,
  line_no integer not null,
  description text not null,
  uom text,
  qty numeric(14,3) not null default 1 check (qty >= 0),
  unit_price numeric(14,4) not null default 0 check (unit_price >= 0),
  amount numeric(14,2) generated always as (round(qty * unit_price, 2)) stored,
  wbs_item_id uuid references public.wbs_items(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subcontract_lines_no_unique unique (subcontract_id, line_no)
);

create index if not exists subcontract_lines_company_sc_idx
  on public.subcontract_lines(company_id, subcontract_id);

drop trigger if exists subcontract_lines_updated_at on public.subcontract_lines;
create trigger subcontract_lines_updated_at
  before update on public.subcontract_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------- subcontract_claims
create table if not exists public.subcontract_claims (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  subcontract_id uuid not null references public.subcontracts(id) on delete restrict,
  claim_number text,
  period_start date not null,
  period_end date not null,
  gross_to_date numeric(14,2) not null default 0,
  previous_certified numeric(14,2) not null default 0,
  this_period_amount numeric(14,2) not null default 0,
  retention_amount numeric(14,2) not null default 0,
  net_payable numeric(14,2) not null default 0,
  retention_released_amount numeric(14,2) not null default 0,
  status public.subcontract_claim_status not null default 'draft',
  approval_instance_id uuid references public.approval_instances(id) on delete set null,
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  certified_by uuid references public.profiles(id),
  certified_at timestamptz,
  rejection_reason text,
  invoice_id uuid references public.invoices(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subcontract_claims_number_unique unique (company_id, claim_number),
  constraint subcontract_claims_period_ordered check (period_end >= period_start)
);

create index if not exists subcontract_claims_company_sc_status_idx
  on public.subcontract_claims(company_id, subcontract_id, status);

create or replace function public.subcontract_claims_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.claim_number is null then
    new.claim_number := 'CLM-' || lpad(
      public.next_subcontract_number(new.company_id, 'claim')::text, 4, '0');
  end if;
  return new;
end $$;

drop trigger if exists subcontract_claims_number_trg on public.subcontract_claims;
create trigger subcontract_claims_number_trg
  before insert on public.subcontract_claims
  for each row execute function public.subcontract_claims_before_insert();

drop trigger if exists subcontract_claims_updated_at on public.subcontract_claims;
create trigger subcontract_claims_updated_at
  before update on public.subcontract_claims
  for each row execute function public.set_updated_at();

-- ----------------------------------------------- subcontract_claim_lines
create table if not exists public.subcontract_claim_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  claim_id uuid not null references public.subcontract_claims(id) on delete cascade,
  subcontract_line_id uuid not null references public.subcontract_lines(id) on delete restrict,
  previous_pct numeric(6,3) not null default 0
    check (previous_pct >= 0 and previous_pct <= 100),
  this_period_pct numeric(6,3) not null default 0
    check (this_period_pct >= -100 and this_period_pct <= 100),
  cumulative_pct numeric(6,3) not null default 0,
  line_amount numeric(14,2) not null default 0,
  previous_amount numeric(14,2) not null default 0,
  this_period_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subcontract_claim_lines_unique unique (claim_id, subcontract_line_id)
);

create index if not exists subcontract_claim_lines_company_claim_idx
  on public.subcontract_claim_lines(company_id, claim_id);

drop trigger if exists subcontract_claim_lines_updated_at on public.subcontract_claim_lines;
create trigger subcontract_claim_lines_updated_at
  before update on public.subcontract_claim_lines
  for each row execute function public.set_updated_at();

-- Derived money on each claim line: pull the SOV amount, carry the previous
-- certified percent forward, and forbid cumulative completion outside 0..100.
create or replace function public.subcontract_claim_lines_derive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.subcontract_lines%rowtype;
  v_prev numeric(6,3);
begin
  select * into v_line from public.subcontract_lines where id = new.subcontract_line_id;
  if v_line.id is null then
    raise exception 'subcontract_line_not_found';
  end if;

  select coalesce(max(cl.cumulative_pct), 0) into v_prev
    from public.subcontract_claim_lines cl
    join public.subcontract_claims c on c.id = cl.claim_id
   where cl.subcontract_line_id = new.subcontract_line_id
     and c.status = 'certified'
     and cl.claim_id <> new.claim_id;

  new.company_id := v_line.company_id;
  new.previous_pct := v_prev;
  new.cumulative_pct := round(v_prev + new.this_period_pct, 3);

  if new.cumulative_pct < 0 or new.cumulative_pct > 100 then
    raise exception 'claim_cumulative_out_of_range';
  end if;

  new.line_amount := v_line.amount;
  new.previous_amount := round(v_line.amount * v_prev / 100, 2);
  new.this_period_amount := round(v_line.amount * new.cumulative_pct / 100, 2)
                            - new.previous_amount;
  return new;
end $$;

drop trigger if exists subcontract_claim_lines_derive_trg on public.subcontract_claim_lines;
create trigger subcontract_claim_lines_derive_trg
  before insert or update on public.subcontract_claim_lines
  for each row execute function public.subcontract_claim_lines_derive();

-- Roll claim-line money up onto the claim header (retention computed here).
create or replace function public.subcontract_claim_recalc(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.subcontract_claims%rowtype;
  v_ret_pct numeric(6,3);
  v_prev numeric(14,2);
  v_this numeric(14,2);
  v_ret numeric(14,2);
begin
  select * into v_claim from public.subcontract_claims where id = p_claim_id;
  if v_claim.id is null then return; end if;

  select s.retention_pct into v_ret_pct
    from public.subcontracts s where s.id = v_claim.subcontract_id;

  select coalesce(sum(previous_amount), 0), coalesce(sum(this_period_amount), 0)
    into v_prev, v_this
    from public.subcontract_claim_lines where claim_id = p_claim_id;

  v_ret := round(v_this * coalesce(v_ret_pct, 0) / 100, 2);

  update public.subcontract_claims
     set previous_certified   = v_prev,
         this_period_amount   = v_this,
         gross_to_date        = v_prev + v_this,
         retention_amount     = v_ret,
         net_payable          = v_this - v_ret
   where id = p_claim_id;
end $$;

revoke all on function public.subcontract_claim_recalc(uuid) from public, anon;
grant execute on function public.subcontract_claim_recalc(uuid) to authenticated, service_role;

create or replace function public.subcontract_claim_lines_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.subcontract_claim_recalc(coalesce(new.claim_id, old.claim_id));
  return null;
end $$;

drop trigger if exists subcontract_claim_lines_after_trg on public.subcontract_claim_lines;
create trigger subcontract_claim_lines_after_trg
  after insert or update or delete on public.subcontract_claim_lines
  for each row execute function public.subcontract_claim_lines_after();

-- ------------------------------------------------------ retention ledger
-- Batch-32 doctrine: the subcontract's retention/certified totals are derived,
-- never hand-written — recomputed from the certified claims.
create or replace function public.subcontract_retention_sync(p_subcontract_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subcontracts s
     set retention_held = t.held,
         retention_released = t.released,
         certified_to_date = t.certified
    from (
      select coalesce(sum(c.retention_amount), 0)
               - coalesce(sum(c.retention_released_amount), 0) as held,
             coalesce(sum(c.retention_released_amount), 0)     as released,
             coalesce(sum(c.this_period_amount), 0)            as certified
        from public.subcontract_claims c
       where c.subcontract_id = p_subcontract_id
         and c.status = 'certified'
    ) t
   where s.id = p_subcontract_id;
end $$;

revoke all on function public.subcontract_retention_sync(uuid) from public, anon;
grant execute on function public.subcontract_retention_sync(uuid) to authenticated, service_role;

create or replace function public.subcontract_claims_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.subcontract_retention_sync(coalesce(new.subcontract_id, old.subcontract_id));

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
    values (new.company_id, auth.uid(), 'subcontract_claim.status_changed',
            'subcontract_claims', new.id,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'claim_number', new.claim_number,
                               'net_payable', new.net_payable));
  end if;
  return null;
end $$;

drop trigger if exists subcontract_claims_after_trg on public.subcontract_claims;
create trigger subcontract_claims_after_trg
  after insert or update or delete on public.subcontract_claims
  for each row execute function public.subcontract_claims_after();

-- ------------------------------------------------------------------ grants
grant select, insert, update on public.subcontracts to authenticated;
grant select, insert, update, delete on public.subcontract_lines to authenticated;
grant select, insert, update on public.subcontract_claims to authenticated;
grant select, insert, update, delete on public.subcontract_claim_lines to authenticated;
grant all on public.subcontracts to service_role;
grant all on public.subcontract_lines to service_role;
grant all on public.subcontract_claims to service_role;
grant all on public.subcontract_claim_lines to service_role;

alter table public.subcontracts enable row level security;
alter table public.subcontract_lines enable row level security;
alter table public.subcontract_claims enable row level security;
alter table public.subcontract_claim_lines enable row level security;

-- ---------------------------------------------------------------- policies
-- SELECT: internal company members (non-external) OR the sub's own portal seat.
drop policy if exists subcontracts_select on public.subcontracts;
create policy subcontracts_select on public.subcontracts
  for select to authenticated
  using (
    (public.is_company_member(company_id) and not public.is_external_viewer())
    or public.sub_portal_has_seat(vendor_id, company_id));

drop policy if exists subcontracts_insert on public.subcontracts;
create policy subcontracts_insert on public.subcontracts
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

drop policy if exists subcontracts_update on public.subcontracts;
create policy subcontracts_update on public.subcontracts
  for update to authenticated
  using (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

drop policy if exists subcontract_lines_select on public.subcontract_lines;
create policy subcontract_lines_select on public.subcontract_lines
  for select to authenticated
  using (exists (select 1 from public.subcontracts s
                  where s.id = subcontract_id
                    and ((public.is_company_member(s.company_id)
                          and not public.is_external_viewer())
                      or public.sub_portal_has_seat(s.vendor_id, s.company_id))));

drop policy if exists subcontract_lines_write on public.subcontract_lines;
create policy subcontract_lines_write on public.subcontract_lines
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

drop policy if exists subcontract_claims_select on public.subcontract_claims;
create policy subcontract_claims_select on public.subcontract_claims
  for select to authenticated
  using (exists (select 1 from public.subcontracts s
                  where s.id = subcontract_id
                    and ((public.is_company_member(s.company_id)
                          and not public.is_external_viewer())
                      or public.sub_portal_has_seat(s.vendor_id, s.company_id))));

drop policy if exists subcontract_claims_insert on public.subcontract_claims;
create policy subcontract_claims_insert on public.subcontract_claims
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

-- Certified claims are engine-settled and frozen to direct writers.
drop policy if exists subcontract_claims_update on public.subcontract_claims;
create policy subcontract_claims_update on public.subcontract_claims
  for update to authenticated
  using (
    status <> 'certified'
    and public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

drop policy if exists subcontract_claim_lines_select on public.subcontract_claim_lines;
create policy subcontract_claim_lines_select on public.subcontract_claim_lines
  for select to authenticated
  using (exists (select 1 from public.subcontract_claims c
                  join public.subcontracts s on s.id = c.subcontract_id
                 where c.id = claim_id
                   and ((public.is_company_member(s.company_id)
                         and not public.is_external_viewer())
                     or public.sub_portal_has_seat(s.vendor_id, s.company_id))));

drop policy if exists subcontract_claim_lines_write on public.subcontract_claim_lines;
create policy subcontract_claim_lines_write on public.subcontract_claim_lines
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and exists (select 1 from public.subcontract_claims c
                 where c.id = claim_id and c.status <> 'certified')
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')))
  with check (
    public.is_company_member(company_id)
    and not public.is_external_viewer()
    and exists (select 1 from public.subcontract_claims c
                 where c.id = claim_id and c.status <> 'certified')
    and (public.has_company_role('project_admin')
      or public.has_company_role('construction_admin')
      or public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')));

-- ------------------------------------------------- approval rule seeding
create or replace function public.ensure_subcontract_claim_rule(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_rule_id uuid;
begin
  insert into public.approval_rules
    (company_id, rule_key, name, description, entity_type, sla_hours,
     escalation_role, is_active)
  values
    (p_company_id, 'subcontract_claim_certify', 'Subcontract progress claim certification',
     'Certification of a subcontractor progress claim before payment.',
     'subcontract_claim', 72, 'company_admin'::public.app_role, true)
  on conflict (company_id, rule_key) do nothing;

  select id into v_rule_id
    from public.approval_rules
   where company_id = p_company_id and rule_key = 'subcontract_claim_certify';

  if v_rule_id is null then return null; end if;

  insert into public.approval_chain_steps (company_id, rule_id, step_order, role, sla_hours)
  values (p_company_id, v_rule_id, 1, 'project_admin'::public.app_role, 72)
  on conflict (rule_id, step_order) do nothing;

  return v_rule_id;
end $$;

revoke all on function public.ensure_subcontract_claim_rule(uuid) from public, anon;
grant execute on function public.ensure_subcontract_claim_rule(uuid) to authenticated, service_role;

do $$
declare r record;
begin
  for r in select id from public.companies loop
    perform public.ensure_subcontract_claim_rule(r.id);
  end loop;
end $$;