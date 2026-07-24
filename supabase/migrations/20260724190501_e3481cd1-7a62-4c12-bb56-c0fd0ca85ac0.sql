-- 0028 — Goods Receipts (P-066)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'grn_status') then
    create type public.grn_status as enum ('draft','confirmed','has_defects','closed');
  end if;
end $$;

create table if not exists public.goods_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  grn_number text not null,
  status public.grn_status not null default 'draft',
  lines jsonb not null default '[]'::jsonb,
  defects_count int not null default 0,
  photos jsonb not null default '[]'::jsonb,
  notes text,
  received_by uuid references public.profiles(id),
  received_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, grn_number)
);

grant select, insert, update on public.goods_receipts to authenticated;
grant all on public.goods_receipts to service_role;

alter table public.goods_receipts enable row level security;

drop policy if exists grn_select on public.goods_receipts;
create policy grn_select on public.goods_receipts
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists grn_write on public.goods_receipts;
create policy grn_write on public.goods_receipts
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('foreman')
      or public.has_company_role('field_technician')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('procurement_officer')
      or public.has_company_role('foreman')
      or public.has_company_role('field_technician')
      or public.has_company_role('company_admin')
    )
  );

create index if not exists grn_po_idx on public.goods_receipts(po_id);
create index if not exists grn_company_project_idx
  on public.goods_receipts(company_id, project_id, status);

drop trigger if exists set_updated_at on public.goods_receipts;
create trigger set_updated_at
  before update on public.goods_receipts
  for each row execute function public.set_updated_at();
