-- GC-13c — cash-flow governance hardening.

create or replace function public.cashflow_lines_frozen_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_snapshot uuid;
  v_status public.cashflow_snapshot_status;
begin
  v_snapshot := coalesce(new.snapshot_id, old.snapshot_id);
  select s.status into v_status from public.cashflow_snapshots s where s.id = v_snapshot;
  if v_status in ('approved', 'superseded') then
    raise exception 'cashflow_snapshot_frozen' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.cashflow_lines_frozen_guard() from public;

drop trigger if exists trg_cashflow_lines_frozen on public.cashflow_snapshot_lines;
create trigger trg_cashflow_lines_frozen
  before insert or update or delete on public.cashflow_snapshot_lines
  for each row execute function public.cashflow_lines_frozen_guard();

create or replace function public.funding_facilities_version_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.funding_facilities_version_guard() from public;

drop trigger if exists trg_funding_facilities_version on public.funding_facilities;
create trigger trg_funding_facilities_version
  before update on public.funding_facilities
  for each row execute function public.funding_facilities_version_guard();

drop policy if exists cashflow_snapshots_update on public.cashflow_snapshots;
create policy cashflow_snapshots_update on public.cashflow_snapshots
  for update to authenticated
  using (
    is_company_member(company_id)
    and (
      has_company_role('finance_admin'::app_role)
      or has_company_role('project_admin'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  )
  with check (
    is_company_member(company_id)
    and (
      has_company_role('finance_admin'::app_role)
      or has_company_role('project_admin'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  );

drop policy if exists cashflow_adjustments_update on public.cashflow_adjustments;
create policy cashflow_adjustments_update on public.cashflow_adjustments
  for update to authenticated
  using (
    is_company_member(company_id)
    and (
      has_company_role('finance_admin'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  )
  with check (
    is_company_member(company_id)
    and (
      has_company_role('finance_admin'::app_role)
      or has_company_role('company_admin'::app_role)
    )
  );