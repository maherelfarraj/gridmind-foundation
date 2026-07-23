## No-op: migration 0006 already applied

The invites migration landed in the previous turn via `supabase--migration`. All P-014 objects are in the database:

- `public.invite_status` enum (`pending`, `accepted`, `revoked`, `expired`)
- `public.invites` table with `token_hash`, 7-day `expires_at` default, `accepted_at`, `accepted_by`
- Partial unique index `invites_one_pending_per_email` on `(company_id, email) where status = 'pending'`
- Supporting indexes on `company_id` and `(email, status)`
- `update_invites_updated_at` trigger
- GRANTs: revoked from `anon`/`public`; full CRUD to `authenticated`; `all` to `service_role`
- RLS enabled with four policies: admin select / self select / admin insert / admin update / admin delete
- `create_invite(uuid, citext, app_role) returns text` — SECURITY DEFINER, returns raw token once, writes `invite.created` audit
- `redeem_invite(text) returns uuid` — SECURITY DEFINER, expires-on-touch, email match, upserts profile + role, writes `invite.accepted` audit
- EXECUTE revoked from `public`/`anon`; granted to `authenticated`/`service_role`

## Verification I'll run in build mode (read-only)

Quick psql check confirming presence of the objects, then report back — no schema changes.

```sql
select tablename from pg_tables where schemaname='public' and tablename='invites';
select typname from pg_type where typname='invite_status';
select proname from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('create_invite','redeem_invite');
select indexname from pg_indexes
  where schemaname='public' and tablename='invites';
select polname from pg_policies where schemaname='public' and tablename='invites';
```

## Next step

Approve this and I'll run the verification query, confirm the objects, then move on to P-015.
