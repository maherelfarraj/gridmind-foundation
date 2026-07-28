-- P-260 — Sub compliance + scorecards with the expiry engine.

-- 1) Compliance document register -----------------------------------------
create table if not exists public.subcontract_compliance_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  subcontract_id uuid references public.subcontracts(id) on delete cascade,
  doc_type text not null check (doc_type in ('insurance','license','safety_cert','performance_bond')),
  title text not null,
  reference text,
  issue_date date,
  expiry_date date not null,
  mandatory boolean not null default false,
  file_path text,
  file_name text,
  status text not null default 'valid',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subcontract_compliance_docs_dates check (issue_date is null or expiry_date >= issue_date)
);

grant select, insert, update, delete on public.subcontract_compliance_docs to authenticated;
grant all on public.subcontract_compliance_docs to service_role;

alter table public.subcontract_compliance_docs enable row level security;

drop policy if exists subcontract_compliance_docs_select on public.subcontract_compliance_docs;
create policy subcontract_compliance_docs_select on public.subcontract_compliance_docs
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_compliance_docs_insert on public.subcontract_compliance_docs;
create policy subcontract_compliance_docs_insert on public.subcontract_compliance_docs
  for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_compliance_docs_update on public.subcontract_compliance_docs;
create policy subcontract_compliance_docs_update on public.subcontract_compliance_docs
  for update to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer())
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_compliance_docs_delete on public.subcontract_compliance_docs;
create policy subcontract_compliance_docs_delete on public.subcontract_compliance_docs
  for delete to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

create index if not exists subcontract_compliance_docs_vendor_idx
  on public.subcontract_compliance_docs (company_id, vendor_id, expiry_date);
create index if not exists subcontract_compliance_docs_sub_idx
  on public.subcontract_compliance_docs (subcontract_id, doc_type);
create index if not exists subcontract_compliance_docs_status_idx
  on public.subcontract_compliance_docs (company_id, status, expiry_date);

-- 2) Derived status (derived-status doctrine: trigger is the sole writer) ---
create or replace function public.sub_compliance_status(p_expiry date, p_asof date default current_date)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_expiry is null then 'valid'
    when p_expiry < p_asof then 'expired'
    when p_expiry <= p_asof + 30 then 'expiring_soon'
    else 'valid'
  end
$$;

create or replace function public.subcontract_compliance_docs_derive()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_company uuid;
begin
  if new.subcontract_id is not null then
    select s.company_id, s.vendor_id into v_company, new.vendor_id
      from public.subcontracts s where s.id = new.subcontract_id;
    if v_company is null then
      raise exception 'subcontract_not_found' using errcode = '22023';
    end if;
    new.company_id := v_company;
  end if;
  if new.doc_type = 'insurance' then
    new.mandatory := true;
  end if;
  new.status := public.sub_compliance_status(new.expiry_date);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists subcontract_compliance_docs_derive_t on public.subcontract_compliance_docs;
create trigger subcontract_compliance_docs_derive_t
  before insert or update on public.subcontract_compliance_docs
  for each row execute function public.subcontract_compliance_docs_derive();

-- 3) Expiry sweep with fingerprint dedupe ----------------------------------
create unique index if not exists notifications_compliance_fingerprint_uk
  on public.notifications (user_id, (metadata->>'compliance_fingerprint'))
  where metadata ? 'compliance_fingerprint';

create or replace function public.sub_compliance_expiry_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_refreshed int := 0; v_alerts int := 0;
begin
  with upd as (
    update public.subcontract_compliance_docs d
       set status = public.sub_compliance_status(d.expiry_date), updated_at = now()
     where d.status is distinct from public.sub_compliance_status(d.expiry_date)
    returning 1)
  select count(*) into v_refreshed from upd;

  with ins as (
    insert into public.notifications (company_id, user_id, type, title, body, link, metadata)
    select d.company_id, ur.user_id, 'subcontract.compliance_expiry',
           case when d.status = 'expired' then 'Compliance document expired: ' || d.title
                else 'Compliance document expiring soon: ' || d.title end,
           coalesce(v.name, 'Subcontractor') || ' — ' || d.doc_type ||
             ' expires ' || to_char(d.expiry_date, 'YYYY-MM-DD') || '.',
           case when d.subcontract_id is not null
                then '/procurement/subcontracts/' || d.subcontract_id::text
                else '/procurement/vendors/' || d.vendor_id::text end,
           jsonb_build_object(
             'compliance_fingerprint',
               d.id::text || ':' || d.status || ':' || to_char(d.expiry_date, 'YYYY-MM-DD'),
             'doc_id', d.id, 'vendor_id', d.vendor_id, 'subcontract_id', d.subcontract_id,
             'doc_type', d.doc_type, 'status', d.status, 'expiry_date', d.expiry_date)
      from public.subcontract_compliance_docs d
      join public.vendors v on v.id = d.vendor_id
      join public.user_roles ur on ur.company_id = d.company_id
     where d.status in ('expiring_soon','expired')
       and ur.role::text in ('procurement_admin','procurement_officer','finance_admin',
                             'hse_admin','company_admin')
    on conflict do nothing
    returning 1)
  select count(*) into v_alerts from ins;

  return jsonb_build_object('refreshed', v_refreshed, 'alerts', v_alerts);
end $$;

revoke all on function public.sub_compliance_expiry_sweep() from public, anon;
grant execute on function public.sub_compliance_expiry_sweep() to authenticated, service_role;

-- 4) Hard gate: expired mandatory insurance blocks claim submission --------
create or replace function public.sub_compliance_gate(p_subcontract_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_s public.subcontracts%rowtype;
begin
  select * into v_s from public.subcontracts where id = p_subcontract_id;
  if v_s.id is null then return null; end if;
  if exists (
    select 1 from public.subcontract_compliance_docs d
     where d.company_id = v_s.company_id
       and d.vendor_id = v_s.vendor_id
       and d.mandatory
       and d.doc_type = 'insurance'
       and (d.subcontract_id is null or d.subcontract_id = v_s.id)
       and d.expiry_date < current_date)
  then
    return 'compliance_insurance_expired';
  end if;
  return null;
end $$;

revoke all on function public.sub_compliance_gate(uuid) from public, anon;
grant execute on function public.sub_compliance_gate(uuid) to authenticated, service_role;

create or replace function public.subcontract_claims_compliance_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_err text;
begin
  if new.status::text = 'submitted'
     and (tg_op = 'INSERT' or old.status::text is distinct from 'submitted') then
    v_err := public.sub_compliance_gate(new.subcontract_id);
    if v_err is not null then
      raise exception '%', v_err using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists subcontract_claims_compliance_guard_t on public.subcontract_claims;
create trigger subcontract_claims_compliance_guard_t
  before insert or update on public.subcontract_claims
  for each row execute function public.subcontract_claims_compliance_guard();

-- 5) Scorecards -------------------------------------------------------------
create table if not exists public.subcontract_scorecards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  claim_accuracy numeric(6,2),
  safety_score numeric(6,2),
  quality_score numeric(6,2),
  on_time_score numeric(6,2),
  composite numeric(6,2),
  metrics jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  computed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, vendor_id, period_start, period_end)
);

grant select, insert, update on public.subcontract_scorecards to authenticated;
grant all on public.subcontract_scorecards to service_role;

alter table public.subcontract_scorecards enable row level security;

drop policy if exists subcontract_scorecards_select on public.subcontract_scorecards;
create policy subcontract_scorecards_select on public.subcontract_scorecards
  for select to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_scorecards_insert on public.subcontract_scorecards;
create policy subcontract_scorecards_insert on public.subcontract_scorecards
  for insert to authenticated
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop policy if exists subcontract_scorecards_update on public.subcontract_scorecards;
create policy subcontract_scorecards_update on public.subcontract_scorecards
  for update to authenticated
  using (public.is_company_member(company_id) and not public.is_external_viewer())
  with check (public.is_company_member(company_id) and not public.is_external_viewer());

drop trigger if exists subcontract_scorecards_touch on public.subcontract_scorecards;
create trigger subcontract_scorecards_touch
  before update on public.subcontract_scorecards
  for each row execute function public.update_updated_at_column();

-- 6) Sub portal read routines (own data only) -------------------------------
create or replace function public.sub_portal_list_compliance(p_vendor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid;
begin
  select m.company_id into v_company
    from public.vendor_portal_memberships m
   where m.vendor_id = p_vendor_id and m.user_id = auth.uid()
     and m.status::text = 'active'
     and (m.expires_at is null or m.expires_at > now())
   limit 1;
  if v_company is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', d.id, 'doc_type', d.doc_type, 'title', d.title,
             'issue_date', d.issue_date, 'expiry_date', d.expiry_date,
             'mandatory', d.mandatory, 'status', d.status,
             'subcontract_id', d.subcontract_id)
           order by d.expiry_date)
      from public.subcontract_compliance_docs d
     where d.company_id = v_company and d.vendor_id = p_vendor_id), '[]'::jsonb);
end $$;

revoke all on function public.sub_portal_list_compliance(uuid) from public, anon;
grant execute on function public.sub_portal_list_compliance(uuid) to authenticated, service_role;

create or replace function public.sub_portal_get_scorecard(p_vendor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_company uuid; v_cur record; v_prior record;
begin
  select m.company_id into v_company
    from public.vendor_portal_memberships m
   where m.vendor_id = p_vendor_id and m.user_id = auth.uid()
     and m.status::text = 'active'
     and (m.expires_at is null or m.expires_at > now())
   limit 1;
  if v_company is null then
    raise exception 'vendor_portal_access_denied' using errcode = '42501';
  end if;

  select * into v_cur from public.subcontract_scorecards
   where company_id = v_company and vendor_id = p_vendor_id
   order by period_end desc limit 1;
  if v_cur.id is null then return jsonb_build_object('scorecard', null); end if;

  select * into v_prior from public.subcontract_scorecards
   where company_id = v_company and vendor_id = p_vendor_id and period_end < v_cur.period_end
   order by period_end desc limit 1;

  -- the sub sees ONLY their own composite: no sub-scores, no peer comparison
  return jsonb_build_object('scorecard', jsonb_build_object(
    'period_start', v_cur.period_start,
    'period_end', v_cur.period_end,
    'composite', v_cur.composite,
    'prior_composite', v_prior.composite,
    'computed_at', v_cur.computed_at));
end $$;

revoke all on function public.sub_portal_get_scorecard(uuid) from public, anon;
grant execute on function public.sub_portal_get_scorecard(uuid) to authenticated, service_role;