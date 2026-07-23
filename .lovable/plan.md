## P-014 — Migration 0006: invites (7-day tokenized links)

Create `supabase/migrations/0006_invites.sql` (idempotent) implementing invite-only onboarding for GridMind EPC.

### 1. Prerequisites

- `create extension if not exists pgcrypto` — needed for `gen_random_bytes` and `digest(..., 'sha256')`. (Idempotent; safe even if already present from 0001.)
- New enum `public.invite_status` with values `pending`, `accepted`, `revoked`, `expired`, created via guarded `do` block.

### 2. `public.invites`

Columns:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null references public.companies(id) on delete cascade`
- `email citext not null` — normalized; requires `create extension if not exists citext`. (Alternative: `text` + `lower(email)` in index. I'll use `citext` for case-insensitive email matching, which is standard.)
- `role public.app_role not null` — single role granted on acceptance
- `token_hash text not null unique` — hex SHA-256 of raw signed token; raw token NEVER stored
- `invited_by uuid not null references public.profiles(id) on delete restrict`
- `status public.invite_status not null default 'pending'`
- `expires_at timestamptz not null default (now() + interval '7 days')`
- `accepted_at timestamptz`
- `accepted_by uuid references public.profiles(id)`
- `created_at`, `updated_at timestamptz not null default now()`
- Trigger: `update_updated_at_column` before update

Indexes:
- `unique index invites_one_pending_per_email on invites (company_id, email) where status = 'pending'` — enforces "at most one pending invite per (company_id, email)".
- `invites_company_id_idx (company_id)`
- `invites_email_status_idx (email, status)` — for the "user sees their own pending invites" policy.

### 3. GRANTs (before RLS)

```sql
revoke all on public.invites from anon, public;
grant select, insert, update, delete on public.invites to authenticated;
grant all on public.invites to service_role;
```

No anon access — invite lookup is done via `SECURITY DEFINER redeem_invite`.

### 4. RLS policies (scoped `to authenticated`)

- SELECT (admin scope): `is_company_admin(company_id) or has_role(auth.uid(), 'super_admin')`
- SELECT (self scope): `status = 'pending' and expires_at > now() and email = (select email from public.profiles where id = auth.uid())::citext` — signed-in user sees their own pending invites (needed so the invitee's client can render "You've been invited to X").
- INSERT / UPDATE / DELETE: `is_company_admin(company_id) or has_role(auth.uid(), 'super_admin')`
  (Direct writes are for revocation and admin housekeeping; issuance and acceptance go through the SECURITY DEFINER helpers, but admins may still revoke via UPDATE.)

Idempotent `drop policy if exists` + `create policy`.

### 5. `create_invite(p_company_id uuid, p_email citext, p_role public.app_role) returns text`

`SECURITY DEFINER`, `set search_path = public`, `volatile`.

Logic:
1. Require `auth.uid() is not null` (raise `28000` if not).
2. Authorization: caller must be `is_company_admin(p_company_id)` or `has_role(auth.uid(),'super_admin')` — otherwise raise `insufficient_privilege`.
3. Extra role guard: reuse `assert_can_grant_role(<a synthetic target check>)` isn't a clean fit (it needs a target user id). Instead, apply its intent inline: reject granting `super_admin` unless caller is `super_admin`.
4. Expire any stale pending invite for `(p_company_id, p_email)` where `expires_at <= now()` — set `status='expired'` so the partial unique index does not collide.
5. Generate `v_token bytea := gen_random_bytes(32)` and `v_token_text text := encode(v_token, 'hex')`.
6. Insert row with `token_hash = encode(digest(v_token_text, 'sha256'), 'hex')`, `invited_by = auth.uid()`, `role = p_role`.
   - If unique violation on the partial index → raise `unique_violation` with a clear message ("a pending invite already exists").
7. `perform write_audit_log('invite.created','invites', v_invite_id, jsonb_build_object('email', p_email, 'role', p_role))`.
8. Return `v_token_text` — the RAW token, returned exactly once for the email link.

Grants:
```sql
revoke execute on function public.create_invite(uuid, citext, public.app_role) from public, anon;
grant execute on function public.create_invite(uuid, citext, public.app_role) to authenticated, service_role;
```

### 6. `redeem_invite(p_token text) returns uuid`

Returns the company_id the caller was added to. `SECURITY DEFINER`, `set search_path = public`, `volatile`.

Logic:
1. Require `auth.uid() is not null` (raise `28000`).
2. Compute `v_hash := encode(digest(p_token, 'sha256'), 'hex')`.
3. Select the invite row `for update` where `token_hash = v_hash`. If not found → raise `no_data_found` ("invalid invite").
4. If `status <> 'pending'` → raise `P0001` ("invite is not pending").
5. If `expires_at <= now()` → update to `status = 'expired'` and raise `P0001` ("invite expired"). (Marks-expired-on-touch as spec requires.)
6. Optional email match: verify `lower(invite.email) = lower(auth.jwt() ->> 'email')`; if mismatch raise `insufficient_privilege` ("invite is not for this account").
7. Upsert caller's `profiles` row into `invite.company_id`:
   ```
   insert into public.profiles (id, company_id, email)
   values (auth.uid(), v_invite.company_id, auth.jwt() ->> 'email')
   on conflict (id) do update set company_id = excluded.company_id, updated_at = now();
   ```
8. Insert `user_roles (user_id, company_id, role)` values — `on conflict (user_id, company_id, role) do nothing`.
9. Update invite: `status='accepted', accepted_at=now(), accepted_by=auth.uid()`.
10. `perform write_audit_log('invite.accepted','invites', v_invite.id, jsonb_build_object('company_id', v_invite.company_id, 'role', v_invite.role))`.
11. Return `v_invite.company_id`.

Grants:
```sql
revoke execute on function public.redeem_invite(text) from public, anon;
grant execute on function public.redeem_invite(text) to authenticated, service_role;
```

### 7. Notes / expected linter output

- New `SECURITY DEFINER` warnings for `create_invite` and `redeem_invite` are expected and intentional (same pattern as P-010/P-011/P-012/P-013 helpers).
- `citext` and `pgcrypto` extension warnings (if any) are pre-approved by the invite spec.
- Frontend wiring (invite compose UI, `/invite/:token` acceptance page, email delivery) is out of scope for this prompt — this migration only lands the data model + helpers.

### Deliverable

Single migration file `supabase/migrations/0006_invites.sql` applied via `supabase--migration`. No code changes in this prompt.
