-- P-135 — Audit-log retention enforcement (SECURITY DEFINER, service-role only).
--
-- Deletes expired rows from public.audit_logs based on
-- public.audit_log_retention_policies. audit_logs is append-only for normal
-- roles (no UPDATE/DELETE grants), so retention runs as a DEFINER function
-- callable only by service_role from the /api/cron/audit-retention route.
--
-- Rules:
--   * Explicit policy row → GREATEST(retention_days, 90) day window.
--   * Financial entities with no policy → 2555 day (7y) fallback.
--   * Never deletes rows newer than 90 days regardless of caller input.

create or replace function public.enforce_audit_log_retention()
returns table(company_id uuid, entity text, deleted_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  financial_entities constant text[] := array[
    'invoices','debit_notes','pay_applications',
    'change_orders','cash_flows','budgets'
  ];
  financial_fallback_days constant integer := 2555;
  min_days constant integer := 90;
begin
  return query
  with pol as (
    -- Explicit policies, floored at the 90-day minimum.
    select
      p.company_id,
      p.entity,
      greatest(p.retention_days, min_days) as retention_days
    from public.audit_log_retention_policies p
    union all
    -- Financial-entity fallback: 7 years for (company, entity) pairs that
    -- have audit rows but no explicit policy row.
    select
      a.company_id,
      a.entity,
      financial_fallback_days as retention_days
    from (
      select distinct al.company_id, al.entity
      from public.audit_logs al
      where al.entity = any(financial_entities)
    ) a
    where not exists (
      select 1
      from public.audit_log_retention_policies p2
      where p2.company_id = a.company_id
        and p2.entity = a.entity
    )
  ),
  del as (
    delete from public.audit_logs a
    using pol
    where a.company_id = pol.company_id
      and a.entity = pol.entity
      and a.created_at < now() - make_interval(days => pol.retention_days)
    returning a.company_id, a.entity
  )
  select d.company_id, d.entity, count(*)::bigint
  from del d
  group by d.company_id, d.entity;
end;
$$;

revoke all on function public.enforce_audit_log_retention() from public, authenticated, anon;
grant execute on function public.enforce_audit_log_retention() to service_role;

comment on function public.enforce_audit_log_retention() is
  'P-135: deletes expired audit_logs per audit_log_retention_policies. '
  'Financial entities without policies default to 7 years; 90-day floor always enforced. '
  'SECURITY DEFINER; service_role only.';
