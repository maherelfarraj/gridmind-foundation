## No-op: migration 0007 already applied

The currencies + FX migration landed in the previous turn via `supabase--migration`. All P-015 objects are already in the database:

- `public.currencies` (`code` PK, `name`, `symbol`, `minor_unit`, `is_active`, timestamps) + `update_currencies_updated_at` trigger
- `public.fx_rates` (`base_code`/`quote_code` FKs to currencies, `rate numeric(20,8) check (rate > 0)`, `as_of date`, `source default 'manual'`, `check (base_code <> quote_code)`, `unique (base_code, quote_code, as_of)`) + updated_at trigger
- Index `fx_rates_latest_idx (base_code, quote_code, as_of desc)`
- GRANTs: revoked from `anon`/`public`; SELECT to `authenticated`; ALL to `service_role`
- RLS enabled on both, with `*_all_read` (SELECT for authenticated) and `*_super_admin_write` (ALL gated by `has_role(auth.uid(),'super_admin')`)
- Seeded currencies: USD, EUR, MAD, JOD, AED, CNY (idempotent)
- Seeded USD-quoted rates as of `current_date`, `source='seed'`: EUR/MAD/JOD/AED/CNY → USD (idempotent)

## Verification I'll run in build mode (read-only)

```sql
select tablename from pg_tables where schemaname='public' and tablename in ('currencies','fx_rates') order by 1;
select code from public.currencies order by code;
select base_code, quote_code, rate, as_of, source from public.fx_rates order by base_code;
select indexname from pg_indexes where schemaname='public' and tablename='fx_rates';
select tablename, policyname from pg_policies where schemaname='public' and tablename in ('currencies','fx_rates') order by 1,2;
```

## Next step

Approve this and I'll run the verification query, confirm the objects/seed rows, then move on to P-016.
