-- 0101_subcontract_finance.sql — P-261: certified claim → AP invoice → payment.

-- --------------------------------------------------------- payment terms
alter table public.subcontracts
  add column if not exists payment_terms_days integer not null default 30
    check (payment_terms_days >= 0 and payment_terms_days <= 365);

-- Traceability from the AP invoice back to the subcontract world.
alter table public.invoices
  add column if not exists subcontract_id uuid references public.subcontracts(id) on delete set null;
alter table public.invoices
  add column if not exists subcontract_claim_id uuid references public.subcontract_claims(id) on delete set null;

create index if not exists invoices_subcontract_idx
  on public.invoices(company_id, subcontract_id);

-- --------------------------------------------------- AP invoice numbering
-- Dedicated AP-#### series (counter-backed, race-free) so subcontractor
-- payables never collide with the client-side INV-#### receivable series.
create or replace function public.next_ap_invoice_number(p_company_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return 'AP-' || lpad(
    public.next_subcontract_number(p_company_id, 'ap_invoice')::text, 4, '0');
end $$;

revoke all on function public.next_ap_invoice_number(uuid) from public, anon, authenticated;
grant execute on function public.next_ap_invoice_number(uuid) to service_role;

-- ------------------------------------------------- retention release rows
create table if not exists public.subcontract_retention_releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  subcontract_id uuid not null references public.subcontracts(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  release_date date not null default current_date,
  reason text,
  invoice_id uuid references public.invoices(id) on delete set null,
  released_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subcontract_retention_releases_sc_idx
  on public.subcontract_retention_releases(company_id, subcontract_id);

grant select on public.subcontract_retention_releases to authenticated;
grant all on public.subcontract_retention_releases to service_role;
alter table public.subcontract_retention_releases enable row level security;

drop policy if exists subcontract_retention_releases_select on public.subcontract_retention_releases;
create policy subcontract_retention_releases_select
  on public.subcontract_retention_releases for select to authenticated
  using (public.is_company_member(company_id));

drop trigger if exists subcontract_retention_releases_updated_at on public.subcontract_retention_releases;
create trigger subcontract_retention_releases_updated_at
  before update on public.subcontract_retention_releases
  for each row execute function public.set_updated_at();

-- ------------------------------------------------ derived retention ledger
-- held = certified retention − (claim-level releases + release ledger rows)
create or replace function public.subcontract_retention_sync(p_subcontract_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.subcontracts s
     set retention_held = t.retained - t.released,
         retention_released = t.released,
         certified_to_date = t.certified
    from (
      select
        coalesce((select sum(c.retention_amount)
                    from public.subcontract_claims c
                   where c.subcontract_id = p_subcontract_id
                     and c.status = 'certified'), 0) as retained,
        coalesce((select sum(c.retention_released_amount)
                    from public.subcontract_claims c
                   where c.subcontract_id = p_subcontract_id
                     and c.status = 'certified'), 0)
        + coalesce((select sum(r.amount)
                      from public.subcontract_retention_releases r
                     where r.subcontract_id = p_subcontract_id), 0) as released,
        coalesce((select sum(c.this_period_amount)
                    from public.subcontract_claims c
                   where c.subcontract_id = p_subcontract_id
                     and c.status = 'certified'), 0) as certified
    ) t
   where s.id = p_subcontract_id;
end $$;

revoke all on function public.subcontract_retention_sync(uuid) from public, anon;
grant execute on function public.subcontract_retention_sync(uuid) to authenticated, service_role;

create or replace function public.subcontract_retention_releases_after()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.subcontract_retention_sync(coalesce(new.subcontract_id, old.subcontract_id));
  return null;
end $$;

drop trigger if exists subcontract_retention_releases_after_trg on public.subcontract_retention_releases;
create trigger subcontract_retention_releases_after_trg
  after insert or update or delete on public.subcontract_retention_releases
  for each row execute function public.subcontract_retention_releases_after();

-- ---------------------------------------- certified claim → AP invoice
create or replace function public.sub_claim_generate_ap_invoice(p_claim_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim  public.subcontract_claims%rowtype;
  v_sc     public.subcontracts%rowtype;
  v_issue  date;
  v_number text;
  v_id     uuid;
begin
  select * into v_claim from public.subcontract_claims where id = p_claim_id;
  if not found or v_claim.status <> 'certified' then
    return null;
  end if;
  if v_claim.invoice_id is not null then
    return v_claim.invoice_id;   -- idempotent
  end if;
  if coalesce(v_claim.net_payable, 0) <= 0 then
    return null;
  end if;

  select * into v_sc from public.subcontracts where id = v_claim.subcontract_id;

  v_issue  := coalesce(v_claim.certified_at::date, current_date);
  v_number := public.next_ap_invoice_number(v_claim.company_id);

  insert into public.invoices (
    company_id, project_id, invoice_number, direction, status,
    vendor_id, amount, currency_code, issue_date, due_date,
    milestone_label, retention_pct, subcontract_id, subcontract_claim_id,
    created_by
  ) values (
    v_claim.company_id, v_sc.project_id, v_number, 'payable', 'approved',
    v_sc.vendor_id, v_claim.net_payable, v_sc.currency_code, v_issue,
    v_issue + make_interval(days => coalesce(v_sc.payment_terms_days, 30)),
    coalesce(v_sc.subcontract_number, 'SC') || ' · ' || coalesce(v_claim.claim_number, 'claim'),
    0, v_sc.id, v_claim.id, coalesce(v_claim.certified_by, auth.uid())
  )
  returning id into v_id;

  update public.subcontract_claims set invoice_id = v_id where id = p_claim_id;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_claim.company_id, auth.uid(), 'subcontract_claim.ap_invoice_created',
          'invoices', v_id,
          jsonb_build_object('claim_id', p_claim_id, 'invoice_number', v_number,
                             'amount', v_claim.net_payable,
                             'subcontract_id', v_sc.id));
  return v_id;
end $$;

revoke all on function public.sub_claim_generate_ap_invoice(uuid) from public, anon, authenticated;
grant execute on function public.sub_claim_generate_ap_invoice(uuid) to service_role;

-- Hook it into the engine settle path (approval only).
create or replace function public.settle_derived_entity(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inst    public.approval_instances%rowtype;
  v_applied boolean := false;
  v_approved boolean;
  v_comment text;
begin
  select * into v_inst from public.approval_instances where id = p_instance_id;
  if not found or v_inst.status not in ('approved', 'rejected') then
    return jsonb_build_object('settled', false, 'reason', 'not_decided');
  end if;
  v_approved := (v_inst.status = 'approved');

  if v_inst.entity_type = 'sld_drawing' then
    perform set_config('gridmind.approval_settle', 'on', true);
    update public.sld_drawings
       set status = case when v_approved then 'approved'::public.sld_status
                         else 'draft'::public.sld_status end,
           updated_at = now()
     where id = v_inst.entity_id
       and status = 'under_review'::public.sld_status;
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

  elsif v_inst.entity_type in ('timesheet', 'timesheet_week') then
    perform set_config('gridmind.approval_settle', 'on', true);
    update public.timesheets
       set status = case when v_approved then 'approved'::public.timesheet_status
                         else 'rejected'::public.timesheet_status end,
           approval_instance_id = coalesce(approval_instance_id, v_inst.id),
           updated_at = now()
     where id = v_inst.entity_id
       and status in ('submitted'::public.timesheet_status,
                      'in_review'::public.timesheet_status);
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

  elsif v_inst.entity_type = 'subcontract_claim' then
    select a.comment into v_comment
      from public.approvals a
     where a.instance_id = v_inst.id and a.decided_at is not null
     order by a.decided_at desc
     limit 1;

    perform set_config('gridmind.approval_settle', 'on', true);
    update public.subcontract_claims
       set status = case when v_approved then 'certified'::public.subcontract_claim_status
                         else 'rejected'::public.subcontract_claim_status end,
           approval_instance_id = coalesce(approval_instance_id, v_inst.id),
           certified_by = case when v_approved
                               then coalesce(certified_by, v_inst.decided_by, auth.uid())
                               else certified_by end,
           certified_at = case when v_approved
                               then coalesce(certified_at, v_inst.decided_at, now())
                               else certified_at end,
           rejection_reason = case when v_approved then null else v_comment end,
           updated_at = now()
     where id = v_inst.entity_id
       and status in ('submitted'::public.subcontract_claim_status,
                      'under_review'::public.subcontract_claim_status);
    get diagnostics v_applied = row_count;
    perform set_config('gridmind.approval_settle', 'off', true);

    -- P-261: the money loop — certified claim raises its payable invoice.
    if v_applied and v_approved then
      perform public.sub_claim_generate_ap_invoice(v_inst.entity_id);
    end if;

  else
    return jsonb_build_object('settled', false, 'reason', 'entity_not_mirrored',
                              'entity_type', v_inst.entity_type);
  end if;

  return jsonb_build_object('settled', v_applied, 'entity_type', v_inst.entity_type,
                            'entity_id', v_inst.entity_id);
end; $$;

revoke all on function public.settle_derived_entity(uuid) from public, anon;
grant execute on function public.settle_derived_entity(uuid) to authenticated, service_role;

-- ------------------------------------------------------ retention release
create or replace function public.subcontract_release_retention(
  p_subcontract_id uuid,
  p_amount numeric,
  p_release_date date default current_date,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sc      public.subcontracts%rowtype;
  v_number  text;
  v_inv     uuid;
  v_rel     uuid;
  v_date    date := coalesce(p_release_date, current_date);
begin
  select * into v_sc from public.subcontracts where id = p_subcontract_id;
  if not found then
    raise exception 'subcontract_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_sc.company_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (public.has_company_role('finance_admin')
          or public.has_company_role('company_admin')
          or public.has_company_role('procurement_admin')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Early release (before the defects liability period ends) is a finance call.
  if v_sc.defects_liability_end is null or v_sc.defects_liability_end > v_date then
    if not (public.has_company_role('finance_admin')
            or public.has_company_role('company_admin')) then
      raise exception 'retention_release_before_dlp'
        using errcode = '42501',
              hint = 'Defects liability period has not ended; finance approval required.';
    end if;
  end if;

  if coalesce(p_amount, 0) <= 0 then
    raise exception 'retention_release_amount_invalid' using errcode = '22023';
  end if;
  if round(p_amount, 2) > round(v_sc.retention_held, 2) then
    raise exception 'retention_release_exceeds_held' using errcode = '22023';
  end if;

  perform public.assert_finance_period_open(v_sc.company_id, v_date);

  v_number := public.next_ap_invoice_number(v_sc.company_id);

  insert into public.invoices (
    company_id, project_id, invoice_number, direction, status,
    vendor_id, amount, currency_code, issue_date, due_date,
    milestone_label, retention_pct, subcontract_id, created_by
  ) values (
    v_sc.company_id, v_sc.project_id, v_number, 'payable', 'approved',
    v_sc.vendor_id, round(p_amount, 2), v_sc.currency_code, v_date,
    v_date + make_interval(days => coalesce(v_sc.payment_terms_days, 30)),
    coalesce(v_sc.subcontract_number, 'SC') || ' · retention release',
    0, v_sc.id, auth.uid()
  )
  returning id into v_inv;

  insert into public.subcontract_retention_releases
    (company_id, subcontract_id, amount, release_date, reason, invoice_id, released_by)
  values (v_sc.company_id, p_subcontract_id, round(p_amount, 2), v_date, p_reason,
          v_inv, auth.uid())
  returning id into v_rel;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, metadata)
  values (v_sc.company_id, auth.uid(), 'subcontract.retention_released',
          'subcontracts', p_subcontract_id,
          jsonb_build_object('release_id', v_rel, 'amount', round(p_amount, 2),
                             'invoice_id', v_inv, 'invoice_number', v_number,
                             'release_date', v_date));

  select * into v_sc from public.subcontracts where id = p_subcontract_id;

  return jsonb_build_object(
    'release_id', v_rel, 'invoice_id', v_inv, 'invoice_number', v_number,
    'amount', round(p_amount, 2),
    'retention_held', v_sc.retention_held,
    'retention_released', v_sc.retention_released);
end $$;

revoke all on function public.subcontract_release_retention(uuid, numeric, date, text)
  from public, anon;
grant execute on function public.subcontract_release_retention(uuid, numeric, date, text)
  to authenticated, service_role;

-- Backfill the ledger with the new derivation.
do $$
declare r record;
begin
  for r in select id from public.subcontracts loop
    perform public.subcontract_retention_sync(r.id);
  end loop;
end $$;