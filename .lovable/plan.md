# P-017 — Migration 0009: `api_keys` + `webhook_endpoints` + `webhook_deliveries`

Create `supabase/migrations/0009_api_webhooks.sql` for the guarded public API surface. All three tables follow the tenant rule (company_id), have RLS enabled with explicit grants, and never store raw secrets.

## Tables

### `public.api_keys`
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null references public.companies(id) on delete cascade`
- `name text not null`
- `key_prefix text not null` — first 8 chars, display only
- `key_hash text not null unique` — SHA-256 hex of the raw `gm_<random>` key
- `scopes text[] not null default '{}'`
- `last_used_at timestamptz`
- `expires_at timestamptz`
- `revoked_at timestamptz`
- `created_by uuid references public.profiles(id)`
- `created_at`, `updated_at` timestamptz + update trigger
- Index on `(company_id)` and unique on `key_hash`.

### `public.webhook_endpoints`
- `id uuid pk`
- `company_id uuid not null references companies(id) on delete cascade`
- `url text not null`
- `description text`
- `signing_secret_hash text not null` — SHA-256 hex, never raw
- `events text[] not null default '{}'`
- `is_active boolean not null default true`
- `created_by uuid references profiles(id)`
- `created_at`, `updated_at` + update trigger

### `public.webhook_deliveries`
- `id uuid pk`
- `endpoint_id uuid not null references webhook_endpoints(id) on delete cascade`
- `company_id uuid not null references companies(id) on delete cascade`
- `event text not null`
- `payload jsonb not null default '{}'::jsonb`
- `status delivery_status not null default 'pending'` — enum (`pending`, `success`, `failed`)
- `attempts int not null default 0`
- `next_retry_at timestamptz`
- `response_status int`
- `response_body text`
- `delivered_at timestamptz`
- `created_at`, `updated_at` + update trigger
- Index on `(company_id)`, `(endpoint_id)`, and `(status, next_retry_at)` for dispatcher polling.

## Grants + RLS (per project conventions)

For each table, in order: CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY.

- `api_keys`, `webhook_endpoints`: `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO authenticated`; `GRANT ALL TO service_role`.
- `webhook_deliveries`: `GRANT SELECT ON ... TO authenticated`; `GRANT ALL TO service_role` (dispatcher writes bypass RLS via service_role).
- No `anon` grants anywhere.

### Policies

- **api_keys**
  - SELECT: `is_company_member(company_id)`
  - INSERT / UPDATE (revoke): `is_company_admin(company_id)`
  - No client DELETE (revocation = setting `revoked_at`).
- **webhook_endpoints**
  - SELECT: `is_company_member(company_id)`
  - INSERT / UPDATE / DELETE: `is_company_admin(company_id)`
- **webhook_deliveries**
  - SELECT: `is_company_member(company_id)`
  - No INSERT / UPDATE / DELETE policies for regular roles (service_role only).

## Function: `verify_api_key`

```sql
create or replace function public.verify_api_key(p_raw_key text)
returns table(key_id uuid, company_id uuid, scopes text[])
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
begin
  if p_raw_key is null or length(p_raw_key) = 0 then
    return;
  end if;
  v_hash := encode(digest(p_raw_key, 'sha256'), 'hex');

  update public.api_keys
     set last_used_at = now()
   where key_hash = v_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   returning id, api_keys.company_id, api_keys.scopes
     into key_id, company_id, scopes;

  if found then
    return next;
  end if;
  return;
end;
$$;
```

- `revoke all on function ... from public;`
- `grant execute on function ... to anon, authenticated, service_role;` — callers (public API layer) may be anonymous; returning empty on failure is treated as 401 upstream.

## Verification queries (via Lovable chat)

```sql
select tablename, rowsecurity from pg_tables
 where tablename in ('api_keys','webhook_endpoints','webhook_deliveries');

select policyname, tablename, cmd from pg_policies
 where tablename in ('api_keys','webhook_endpoints','webhook_deliveries')
 order by tablename, policyname;

select proname, prosecdef from pg_proc where proname = 'verify_api_key';
```

Expected: RLS enabled on all three; policies present as listed; `verify_api_key` exists with `prosecdef = t`.
