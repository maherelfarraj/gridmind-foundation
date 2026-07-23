
-- 0007_currencies_fx.sql

-- 1. currencies
create table if not exists public.currencies (
  code text primary key,
  name text not null,
  symbol text not null,
  minor_unit int not null default 2 check (minor_unit >= 0 and minor_unit <= 6),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists update_currencies_updated_at on public.currencies;
create trigger update_currencies_updated_at
  before update on public.currencies
  for each row execute function public.update_updated_at_column();

-- 2. fx_rates
create table if not exists public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_code text not null references public.currencies(code) on update cascade on delete restrict,
  quote_code text not null references public.currencies(code) on update cascade on delete restrict,
  rate numeric(20,8) not null check (rate > 0),
  as_of date not null,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fx_rates_base_ne_quote check (base_code <> quote_code),
  constraint fx_rates_pair_asof_unique unique (base_code, quote_code, as_of)
);

create index if not exists fx_rates_latest_idx
  on public.fx_rates (base_code, quote_code, as_of desc);

drop trigger if exists update_fx_rates_updated_at on public.fx_rates;
create trigger update_fx_rates_updated_at
  before update on public.fx_rates
  for each row execute function public.update_updated_at_column();

-- 3. GRANTs
revoke all on public.currencies from anon, public;
revoke all on public.fx_rates  from anon, public;

grant select on public.currencies to authenticated;
grant select on public.fx_rates  to authenticated;

grant all on public.currencies to service_role;
grant all on public.fx_rates  to service_role;

-- 4. RLS
alter table public.currencies enable row level security;
alter table public.fx_rates  enable row level security;

drop policy if exists "currencies_all_read" on public.currencies;
create policy "currencies_all_read" on public.currencies
  for select to authenticated using (true);

drop policy if exists "currencies_super_admin_write" on public.currencies;
create policy "currencies_super_admin_write" on public.currencies
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'super_admin'::public.app_role));

drop policy if exists "fx_rates_all_read" on public.fx_rates;
create policy "fx_rates_all_read" on public.fx_rates
  for select to authenticated using (true);

drop policy if exists "fx_rates_super_admin_write" on public.fx_rates;
create policy "fx_rates_super_admin_write" on public.fx_rates
  for all to authenticated
  using (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- 5. Seed currencies
insert into public.currencies (code, name, symbol, minor_unit) values
  ('USD', 'US Dollar',             '$',   2),
  ('EUR', 'Euro',                  '€',   2),
  ('MAD', 'Moroccan Dirham',       'DH',  2),
  ('JOD', 'Jordanian Dinar',       'JD',  3),
  ('AED', 'UAE Dirham',            'د.إ', 2),
  ('CNY', 'Chinese Yuan Renminbi', '¥',   2)
on conflict (code) do nothing;

-- 6. Seed fx_rates (indicative, USD-quoted, today)
insert into public.fx_rates (base_code, quote_code, rate, as_of, source) values
  ('EUR', 'USD', 1.08, current_date, 'seed'),
  ('MAD', 'USD', 0.10, current_date, 'seed'),
  ('JOD', 'USD', 1.41, current_date, 'seed'),
  ('AED', 'USD', 0.27, current_date, 'seed'),
  ('CNY', 'USD', 0.14, current_date, 'seed')
on conflict (base_code, quote_code, as_of) do nothing;
