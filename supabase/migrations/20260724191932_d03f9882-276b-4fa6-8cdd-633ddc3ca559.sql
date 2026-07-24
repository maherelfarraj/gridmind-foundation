do $$
begin
  if not exists (select 1 from pg_type where typname = 'match_status') then
    create type public.match_status as enum ('pending','matched','variance_blocked','approved_with_variance');
  end if;
end $$;

create table if not exists public.three_way_matches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  po_id uuid not null references public.purchase_orders(id),
  goods_receipt_id uuid references public.goods_receipts(id),
  invoice_id uuid,
  vendor_invoice_number text not null,
  invoice_date date,
  invoice_amount numeric(14,2) not null,
  invoice_currency_code text not null references public.currencies(code),
  invoice_file_path text,
  status public.match_status not null default 'pending',
  qty_variance_pct numeric(6,2),
  price_variance_pct numeric(6,2),
  amount_variance numeric(14,2),
  variance_threshold_pct numeric(5,2) not null default 5.00,
  payment_release_blocked boolean not null default false,
  resolution_note text,
  matched_by uuid references public.profiles(id),
  matched_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.three_way_matches to authenticated;
grant all on public.three_way_matches to service_role;

alter table public.three_way_matches enable row level security;

drop policy if exists twm_select on public.three_way_matches;
create policy twm_select on public.three_way_matches
  for select to authenticated
  using (public.is_company_member(company_id));

drop policy if exists twm_write on public.three_way_matches;
create policy twm_write on public.three_way_matches
  for all to authenticated
  using (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')
    )
  )
  with check (
    public.is_company_member(company_id)
    and (
      public.has_company_role('procurement_admin')
      or public.has_company_role('finance_admin')
      or public.has_company_role('company_admin')
    )
  );

create index if not exists twm_po_idx on public.three_way_matches(po_id, status);
create index if not exists twm_company_idx on public.three_way_matches(company_id, status);

drop trigger if exists three_way_matches_set_updated_at on public.three_way_matches;
create trigger three_way_matches_set_updated_at
  before update on public.three_way_matches
  for each row execute function public.set_updated_at();
