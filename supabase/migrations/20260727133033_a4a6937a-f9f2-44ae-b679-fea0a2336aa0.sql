-- 0088_esg_approval.sql — ESG report approval rule seed + report workflow columns (P-219)

-- 1) Workflow columns on esg_reports (additive, idempotent)
alter table public.esg_reports add column if not exists report_number text;
alter table public.esg_reports add column if not exists approval_instance_id uuid;
alter table public.esg_reports add column if not exists pdf_path text;
alter table public.esg_reports add column if not exists submitted_at timestamptz;
alter table public.esg_reports add column if not exists submitted_by uuid;
alter table public.esg_reports add column if not exists published_at timestamptz;
alter table public.esg_reports add column if not exists published_by uuid;
alter table public.esg_reports add column if not exists rejection_comment text;

create unique index if not exists esg_reports_number_uq
  on public.esg_reports (company_id, report_number)
  where report_number is not null;

-- 2) ESG-#### numbering per company (reuses public.esg_counters)
alter table public.esg_counters add column if not exists next_report_seq integer not null default 0;

create or replace function public.esg_reports_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_seq integer;
begin
  if new.report_number is null or new.report_number = '' or new.report_number = 'PENDING' then
    insert into public.esg_counters (company_id, next_report_seq)
    values (new.company_id, 1)
    on conflict (company_id) do update
      set next_report_seq = public.esg_counters.next_report_seq + 1
    returning next_report_seq into v_seq;
    new.report_number := 'ESG-' || lpad(v_seq::text, 4, '0');
  end if;
  return new;
end $$;

revoke all on function public.esg_reports_before_insert() from public, anon, authenticated;

drop trigger if exists esg_reports_before_insert on public.esg_reports;
create trigger esg_reports_before_insert
  before insert on public.esg_reports
  for each row execute function public.esg_reports_before_insert();

-- Backfill numbers for reports created before this migration
do $$
declare r record; v_seq integer;
begin
  for r in select id, company_id from public.esg_reports where report_number is null order by created_at loop
    insert into public.esg_counters (company_id, next_report_seq)
    values (r.company_id, 1)
    on conflict (company_id) do update
      set next_report_seq = public.esg_counters.next_report_seq + 1
    returning next_report_seq into v_seq;
    update public.esg_reports
       set report_number = 'ESG-' || lpad(v_seq::text, 4, '0')
     where id = r.id;
  end loop;
end $$;

-- 3) Seed the ESG report approval rule per company (hse_admin → company_admin chain)
insert into public.approval_rules (company_id, rule_key, name, entity_type, sla_hours, escalation_role)
select c.id, 'esg_report', 'ESG report → HSE then Company Admin', 'esg_report',
       72, 'company_admin' from public.companies c
on conflict (company_id, rule_key) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 1, 'hse_admin' from public.approval_rules r
 where r.rule_key = 'esg_report'
on conflict (rule_id, step_order) do nothing;

insert into public.approval_chain_steps (company_id, rule_id, step_order, role)
select r.company_id, r.id, 2, 'company_admin' from public.approval_rules r
 where r.rule_key = 'esg_report'
on conflict (rule_id, step_order) do nothing;