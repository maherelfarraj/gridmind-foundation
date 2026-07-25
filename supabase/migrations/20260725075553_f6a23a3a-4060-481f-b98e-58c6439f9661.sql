
do $$ begin
  if not exists (select 1 from pg_type where typname = 'debit_note_status') then
    create type debit_note_status as enum ('draft','issued','settled','cancelled');
  end if;
end $$;

create table if not exists public.debit_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  project_id uuid references public.projects(id) on delete set null,
  contract_id uuid references public.contracts(id),
  invoice_id uuid references public.invoices(id),
  note_number text not null,
  status debit_note_status not null default 'draft',
  reason text not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency_code text not null references public.currencies(code),
  issued_at date,
  settled_at date,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, note_number)
);

grant select, insert, update on public.debit_notes to authenticated;
grant all on public.debit_notes to service_role;

alter table public.debit_notes enable row level security;

drop policy if exists dn_select on public.debit_notes;
create policy dn_select on public.debit_notes for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists dn_write on public.debit_notes;
create policy dn_write on public.debit_notes for all to authenticated
  using (public.is_company_member(company_id)
         and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')))
  with check (public.is_company_member(company_id)
              and (public.has_company_role('finance_admin') or public.has_company_role('company_admin')));

create index if not exists dn_company_idx on public.debit_notes(company_id, project_id, status);

drop trigger if exists debit_notes_set_updated_at on public.debit_notes;
create trigger debit_notes_set_updated_at
  before update on public.debit_notes
  for each row execute function public.set_updated_at();
