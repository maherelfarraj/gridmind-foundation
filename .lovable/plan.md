## P-012 — Migration 0004: audit_logs + retention + write helper

Create `supabase/migrations/0004_audit.sql` (idempotent) implementing an append-only audit trail and per-company retention policies for GridMind EPC.

### 1. `public.audit_logs` (append-only)

Columns:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null` (tenant scope)
- `actor_id uuid references public.profiles(id) on delete set null` (nullable so profile deletes don't break history)
- `action text not null`
- `entity text not null`
- `entity_id uuid`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- **no `updated_at`** — rows are immutable

Indexes: `(company_id, created_at desc)`, `(company_id, entity, entity_id)`.

### 2. `public.audit_log_retention_policies`

Columns:
- `id uuid pk`
- `company_id uuid not null references public.companies(id) on delete cascade`
- `entity text not null`
- `retention_days int not null default 2555 check (retention_days >= 90)`
- `created_at`, `updated_at` (+ `update_updated_at_column` trigger)
- `unique (company_id, entity)`

### 3. GRANTs (before RLS)

```sql
revoke all on public.audit_logs, public.audit_log_retention_policies from anon, public;
grant select, insert on public.audit_logs to authenticated;         -- no UPDATE/DELETE
grant select, insert, update, delete on public.audit_log_retention_policies to authenticated;
grant all on public.audit_logs, public.audit_log_retention_policies to service_role;
```

Explicit `revoke update, delete on public.audit_logs from authenticated, anon, public` for belt-and-braces immutability — retention cleanup runs as `service_role`.

### 4. `write_audit_log` helper (SECURITY DEFINER)

```sql
create or replace function public.write_audit_log(
  p_action text, p_entity text, p_entity_id uuid, p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_company uuid; v_actor uuid := auth.uid(); v_id uuid;
begin
  if v_actor is null then
    raise exception 'write_audit_log: no authenticated user' using errcode = '28000';
  end if;
  select company_id into v_company from public.profiles where id = v_actor;
  if v_company is null then
    raise exception 'write_audit_log: actor % has no profile', v_actor using errcode = 'P0001';
  end if;
  insert into public.audit_logs(company_id, actor_id, action, entity, entity_id, metadata)
  values (v_company, v_actor, p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end$$;

revoke execute on function public.write_audit_log(text, text, uuid, jsonb) from public, anon;
grant execute on function public.write_audit_log(text, text, uuid, jsonb) to authenticated, service_role;
```

Actor and company are resolved from `auth.uid()` — callers cannot spoof either.

### 5. Enable RLS + policies (idempotent `drop policy if exists` + `create policy`, scoped `to authenticated`)

**audit_logs**
- SELECT: `is_company_member(company_id)`
- INSERT: `is_company_member(company_id) and actor_id = auth.uid()` (defense in depth; the helper is the intended write path)
- UPDATE / DELETE: no policy (privilege already revoked)

**audit_log_retention_policies**
- SELECT: `is_company_member(company_id)`
- INSERT / UPDATE / DELETE: `is_company_admin(company_id) or has_role(auth.uid(), 'super_admin')`

### 6. Deliverable

Single migration applied via `supabase--migration`. Linter warnings for the two new tables should clear; the five SECURITY DEFINER helper warnings (P-010 + `is_company_admin` from P-011 + new `write_audit_log`) are intentional.
