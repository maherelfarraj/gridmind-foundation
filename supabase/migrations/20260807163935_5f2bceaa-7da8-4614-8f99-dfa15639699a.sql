-- GC-12c — EVM governance hardening: exception scoping, approver segregation,
-- period locks and mapping-version transition validation. Idempotent.

-- 1. Quality exceptions belong to a working report only.
DROP POLICY IF EXISTS evm_exceptions_write ON public.evm_exceptions;
CREATE POLICY evm_exceptions_write ON public.evm_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (
    is_company_member(company_id)
    AND EXISTS (
      SELECT 1 FROM public.evm_reports r
       WHERE r.id = evm_exceptions.report_id
         AND r.status = 'working'::public.evm_report_status
         AND r.company_id = evm_exceptions.company_id
    )
  );

-- 2. Report guard: keep the freeze, add approver segregation and period locks.
CREATE OR REPLACE FUNCTION public.evm_reports_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if tg_op = 'UPDATE' then
    -- Approved and superseded reports are frozen: only the supersession
    -- pointers may ever change afterwards.
    if old.status in ('approved','superseded') then
      if new.status = old.status
         and (new.totals is distinct from old.totals
              or new.data_date is distinct from old.data_date
              or new.reporting_currency is distinct from old.reporting_currency
              or new.fx_provenance is distinct from old.fx_provenance
              or new.ac_basis is distinct from old.ac_basis
              or new.official_eac_method is distinct from old.official_eac_method) then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
      if old.status = 'superseded' and new.status <> 'superseded' then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
      if old.status = 'approved' and new.status not in ('approved','superseded') then
        raise exception 'evm_report_frozen' using errcode = '42501';
      end if;
    end if;

    -- Segregation of duties: the approver may not be the preparer or submitter.
    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.approved_by is null then
        raise exception 'evm_approver_required' using errcode = '42501';
      end if;
      if new.approved_by = coalesce(new.submitted_by, old.submitted_by)
         or new.approved_by = coalesce(new.prepared_by, old.prepared_by) then
        raise exception 'evm_self_approval' using errcode = '42501';
      end if;
      -- A locked or closed financial period may not receive a new approval.
      perform public.assert_costing_period_open(
        new.company_id, new.project_id, coalesce(new.period_month, old.period_month)
      );
    end if;

    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- 3. Mapping-version guard: validated transitions plus approver segregation.
CREATE OR REPLACE FUNCTION public.evm_mapping_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if tg_op = 'UPDATE' then
    -- Only draft -> approved -> superseded is permitted; nothing reopens.
    if new.status is distinct from old.status then
      if not (
        (old.status = 'draft'     and new.status in ('approved','superseded'))
        or (old.status = 'approved' and new.status = 'superseded')
      ) then
        raise exception 'evm_mapping_invalid_transition' using errcode = '42501';
      end if;
    end if;

    if old.status <> 'draft' then
      if new.label is distinct from old.label or new.note is distinct from old.note then
        raise exception 'evm_mapping_version_frozen' using errcode = '42501';
      end if;
    end if;

    if new.status = 'approved' and old.status is distinct from 'approved' then
      if new.approved_by is null then
        raise exception 'evm_approver_required' using errcode = '42501';
      end if;
      if new.approved_by = coalesce(new.created_by, old.created_by) then
        raise exception 'evm_self_approval' using errcode = '42501';
      end if;
      new.approved_at := coalesce(new.approved_at, now());
    end if;

    if new.status = 'superseded' and new.superseded_by_id is null then
      raise exception 'evm_mapping_supersession_target_required' using errcode = '42501';
    end if;

    new.row_version := old.row_version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.evm_reports_guard() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.evm_mapping_versions_guard() FROM PUBLIC, anon;