# P-016 — Migration 0008: `consume_rate_limit` token bucket

Create `supabase/migrations/0008_rate_limit.sql` implementing a Postgres token-bucket rate limiter callable from public API hooks (including anonymous callers keyed by API key/IP).

## What the migration creates

1. **Table `public.rate_limit_buckets`**
   - `key text primary key`
   - `tokens numeric not null`
   - `capacity int not null`
   - `refill_per_sec numeric not null`
   - `updated_at timestamptz not null default now()`

2. **Grants / RLS**
   - `REVOKE ALL ON public.rate_limit_buckets FROM anon, authenticated, PUBLIC`
   - `GRANT ALL ON public.rate_limit_buckets TO service_role` (admin/maintenance only)
   - `ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY`
   - No policies — table is unreachable via PostgREST; only the SECURITY DEFINER function touches it.

3. **Function `public.consume_rate_limit(p_key text, p_capacity int, p_refill_per_sec numeric) returns boolean`**
   - `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`
   - Race-safe flow:
     1. `INSERT ... ON CONFLICT (key) DO NOTHING` seeding bucket at full capacity with `updated_at = now()`.
     2. `SELECT ... FOR UPDATE` the row.
     3. Compute `elapsed = extract(epoch from now() - updated_at)`; `tokens = least(capacity, tokens + elapsed * refill_per_sec)`.
     4. If `tokens >= 1`: decrement by 1, `UPDATE` tokens + `updated_at = now()`, return `true`.
     5. Else: `UPDATE` refilled tokens + `updated_at = now()`, return `false`.
   - Also updates `capacity`/`refill_per_sec` on the row to the passed-in values so callers can tune limits without a manual reset.
   - Grants: `REVOKE ALL ON FUNCTION ... FROM PUBLIC`; `GRANT EXECUTE ON FUNCTION ... TO anon, authenticated, service_role`.

## Out of scope (per prompt)

- TypeScript fail-open wrapper — implemented later.
- No seed rows; buckets are created lazily on first call.

## Verification after apply

Run via Lovable chat (per the locked workflow):

```sql
select proname, prosecdef from pg_proc where proname = 'consume_rate_limit';
select relname, relrowsecurity from pg_class where relname = 'rate_limit_buckets';
select consume_rate_limit('test:plan', 2, 1)  -- expect true
     , consume_rate_limit('test:plan', 2, 1)  -- expect true
     , consume_rate_limit('test:plan', 2, 1); -- expect false
delete from public.rate_limit_buckets where key = 'test:plan';
```
