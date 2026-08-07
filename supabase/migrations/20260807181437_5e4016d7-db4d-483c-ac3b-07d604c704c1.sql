-- GC-14 — Governed contingency & quantitative risk exposure

create type public.contingency_pool_status as enum ('draft','active','closed');
create type public.contingency_movement_kind as enum ('draw','release','transfer_in','transfer_out');
create type public.contingency_movement_status as enum ('pending','approved','rejected');
create type public.risk_distribution as enum ('triangular','pert');

create table public.contingency_pools (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cost_code_id uuid references public.cost_codes(id) on delete set null,
  name text not null,
  basis text,
  currency_code text not null references public.currencies(code),
  original_amount numeric(18,2) not null default 0 check (original_amount >= 0),
  status public.contingency_pool_status not null default 'draft',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
grant select, insert, update, delete on public.contingency_pools to authenticated;
grant all on public.contingency_pools to service_role;
alter table public.contingency_pools enable row level security;
create policy contingency_pools_select on public.contingency_pools
  for select to authenticated using (public.is_company_member(company_id));
create policy contingency_pools_write on public.contingency_pools
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

create table public.contingency_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  pool_id uuid not null references public.contingency_pools(id) on delete cascade,
  kind public.contingency_movement_kind not null,
  amount numeric(18,2) not null check (amount > 0),
  currency_code text not null references public.currencies(code),
  effective_date date not null,
  reason text not null,
  risk_id uuid references public.risks(id) on delete set null,
  change_order_id uuid references public.change_orders(id) on delete set null,
  counterparty_pool_id uuid references public.contingency_pools(id) on delete set null,
  status public.contingency_movement_status not null default 'pending',
  requested_by uuid references public.profiles(id),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contingency_movements_pool_idx on public.contingency_movements (pool_id, status, effective_date);
create index contingency_movements_project_idx on public.contingency_movements (project_id, status);
grant select, insert, update, delete on public.contingency_movements to authenticated;
grant all on public.contingency_movements to service_role;
alter table public.contingency_movements enable row level security;
create policy contingency_movements_select on public.contingency_movements
  for select to authenticated using (public.is_company_member(company_id));
create policy contingency_movements_insert on public.contingency_movements
  for insert to authenticated
  with check (public.is_company_member(company_id) and status = 'pending' and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));
create policy contingency_movements_update on public.contingency_movements
  for update to authenticated
  using (public.is_company_member(company_id) and status <> 'approved' and (
    public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id));
create policy contingency_movements_delete on public.contingency_movements
  for delete to authenticated
  using (public.is_company_member(company_id) and status = 'pending' and (
    public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

create table public.risk_quantifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  risk_id uuid not null unique references public.risks(id) on delete cascade,
  currency_code text not null references public.currencies(code),
  cost_low numeric(18,2) not null default 0 check (cost_low >= 0),
  cost_most_likely numeric(18,2) not null default 0 check (cost_most_likely >= 0),
  cost_high numeric(18,2) not null default 0 check (cost_high >= 0),
  probability_pct numeric(5,2) not null default 0 check (probability_pct >= 0 and probability_pct <= 100),
  schedule_days_impact integer not null default 0 check (schedule_days_impact >= 0),
  distribution public.risk_distribution not null default 'triangular',
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_quantifications_range check (cost_low <= cost_most_likely and cost_most_likely <= cost_high)
);
create index risk_quantifications_project_idx on public.risk_quantifications (project_id);
grant select, insert, update, delete on public.risk_quantifications to authenticated;
grant all on public.risk_quantifications to service_role;
alter table public.risk_quantifications enable row level security;
create policy risk_quantifications_select on public.risk_quantifications
  for select to authenticated using (public.is_company_member(company_id));
create policy risk_quantifications_write on public.risk_quantifications
  for all to authenticated
  using (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id) and (
    public.has_company_role('finance_admin') or public.has_company_role('project_admin')
    or public.has_company_role('company_admin')));

-- Approved movements are immutable: only the approval transition itself may write them.
create or replace function public.contingency_movement_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'approved' then
      raise exception 'Approved contingency movements are immutable';
    end if;
    if new.status = 'approved' then
      new.decided_at := coalesce(new.decided_at, now());
      new.decided_by := coalesce(new.decided_by, auth.uid());
    end if;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'approved' then
      raise exception 'Approved contingency movements cannot be deleted';
    end if;
    return old;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.contingency_movement_guard() from public, anon, authenticated;

create trigger contingency_movements_guard
  before update or delete on public.contingency_movements
  for each row execute function public.contingency_movement_guard();

create trigger contingency_pools_touch
  before update on public.contingency_pools
  for each row execute function public.update_updated_at_column();

create trigger risk_quantifications_touch
  before update on public.risk_quantifications
  for each row execute function public.update_updated_at_column();