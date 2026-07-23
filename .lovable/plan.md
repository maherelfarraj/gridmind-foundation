## P-015 — Migration 0007: currencies + fx_rates + seed

Create `supabase/migrations/0007_currencies_fx.sql` (idempotent) — global reference data for multi-currency support. Deliberately no `company_id`; tenancy expressed via RLS (all authenticated read, super_admin write). Apply via `supabase--migration`.

### 1. `public.currencies`

Columns:
- `code text primary key` — ISO 4217, e.g. `'USD'`
- `name text not null`
- `symbol text not null`
- `minor_unit int not null default 2 check (minor_unit >= 0 and minor_unit <= 6)`
- `is_active boolean not null default true`
- `created_at`, `updated_at timestamptz not null default now()`
- Trigger: `update_updated_at_column` before update

### 2. `public.fx_rates`

Columns:
- `id uuid primary key default gen_random_uuid()`
- `base_code text not null references public.currencies(code) on update cascade on delete restrict`
- `quote_code text not null references public.currencies(code) on update cascade on delete restrict`
- `rate numeric(20,8) not null check (rate > 0)`
- `as_of date not null`
- `source text not null default 'manual'`
- `created_at`, `updated_at timestamptz not null default now()`
- `unique (base_code, quote_code, as_of)`
- `check (base_code <> quote_code)`
- Trigger: `update_updated_at_column` before update

Indexes:
- `fx_rates_latest_idx (base_code, quote_code, as_of desc)` — for "latest rate" lookups by the future rate-feed job.

### 3. GRANTs (before RLS)

```sql
revoke all on public.currencies from anon, public;
revoke all on public.fx_rates  from anon, public;

grant select on public.currencies to authenticated;
grant select on public.fx_rates  to authenticated;

grant all on public.currencies to service_role;
grant all on public.fx_rates  to service_role;
```

No anon access. Only super_admin can write via policies below; the production rate-feed job uses `service_role`, which bypasses RLS.

### 4. RLS

```sql
alter table public.currencies enable row level security;
alter table public.fx_rates  enable row level security;
```

Policies (idempotent `drop policy if exists` + `create policy`, `to authenticated`):

- `currencies_all_read` — SELECT, `using (true)`
- `currencies_super_admin_write` — ALL (insert/update/delete), `using (public.has_role(auth.uid(),'super_admin'))` and same `with check`
- `fx_rates_all_read` — SELECT, `using (true)`
- `fx_rates_super_admin_write` — ALL, `using (public.has_role(auth.uid(),'super_admin'))` and same `with check`

(No `authenticated` INSERT/UPDATE/DELETE beyond the super_admin path.)

### 5. Seed — currencies

`insert into public.currencies (code, name, symbol, minor_unit) values (...) on conflict (code) do nothing`, seeding exactly:

| code | name                  | symbol | minor_unit |
| ---- | --------------------- | ------ | ---------- |
| USD  | US Dollar             | $      | 2          |
| EUR  | Euro                  | €      | 2          |
| MAD  | Moroccan Dirham       | DH     | 2          |
| JOD  | Jordanian Dinar       | JD     | 3          |
| AED  | UAE Dirham            | د.إ    | 2          |
| CNY  | Chinese Yuan Renminbi | ¥      | 2          |

### 6. Seed — fx_rates (USD-quoted, `as_of = current_date`, `source = 'seed'`)

Insert a starter set so finance screens work before the real rate feed exists. Indicative placeholders only.

Rows (`base_code`, `quote_code`, `rate`):
- `USD → USD` — skipped (violates `base <> quote`); code must never store a self-pair.
- `EUR → USD` — `1.08`
- `MAD → USD` — `0.10`
- `JOD → USD` — `1.41`
- `AED → USD` — `0.27`
- `CNY → USD` — `0.14`

`insert ... on conflict (base_code, quote_code, as_of) do nothing` so re-running the migration is safe.

### 7. Expected linter output

No new SECURITY DEFINER functions introduced; the existing `has_role` helper is reused. Any pre-existing linter warnings from earlier migrations remain unchanged.

### Deliverable

Single migration file `supabase/migrations/0007_currencies_fx.sql` applied via `supabase--migration`. No frontend code changes in this prompt.
