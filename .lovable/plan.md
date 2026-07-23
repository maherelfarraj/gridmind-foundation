## Migration 0008b — verification grants

Add `supabase/migrations/0008b_verification_grants.sql` containing exactly one statement:

```sql
grant execute on function public.consume_rate_limit(text, int, numeric)
  to supabase_read_only_user;
```

No other grants, revokes, or object changes. The existing `anon` / `authenticated` / `service_role` EXECUTE grants from P-016 stay as-is.

## Acceptance checks (via Lovable read-only runner)

Run in order, show raw results after each:

1. `select public.consume_rate_limit('test-key', 3, 0.1);` → expect `true`
2. `select public.consume_rate_limit('test-key', 3, 0.1);` → expect `true`
3. `select public.consume_rate_limit('test-key', 3, 0.1);` → expect `true`
4. `select public.consume_rate_limit('test-key', 3, 0.1);` → expect `false`
5. Wait ~10s, then `select public.consume_rate_limit('test-key', 3, 0.1);` → expect `true` (bucket refilled at 0.1 tok/s)
6. Cleanup: `delete from public.rate_limit_buckets where key = 'test-key';`

Note: step 6 runs through the migration/insert channel (delete is a write) since the read-only runner can't execute DELETE.
