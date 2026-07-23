## P-013 — Migration 0005: module_access_rules + plan tiers + gating function

Create `supabase/migrations/0005_module_gating.sql` (idempotent) implementing plan-tier module gating with per-company overrides for GridMind EPC.

### 1. `public.module_access_rules`

Columns:
- `id uuid pk default gen_random_uuid()`
- `company_id uuid not null references public.companies(id) on delete cascade`
- `module text not null` with `CHECK (module in ('crm','engineering','procurement','planning_budget','field_qaqc','commissioning','om_scada','portals','green_hydrogen'))`
- `enabled boolean not null default true`
- `created_at`, `updated_at timestamptz not null default now()`
- `unique (company_id, module)`
- Trigger: `update_updated_at_column` on before update

Index: `(company_id)` for fast lookup during gating checks.

### 2. GRANTs (before RLS)

```sql
revoke all on public.module_access_rules from anon, public;
grant select, insert, update, delete on public.module_access_rules to authenticated;
grant all on public.module_access_rules to service_role;
```

No `anon` access — module gating is authenticated-only.

### 3. Enable RLS + policies (scoped `to authenticated`)

- SELECT: `is_company_member(company_id)`
- INSERT / UPDATE / DELETE: `is_company_admin(company_id) or has_role(auth.uid(), 'super_admin')`

Idempotent `drop policy if exists` + `create policy`.

### 4. `has_module_access(p_company_id uuid, p_module text)` — gating helper

`SECURITY DEFINER`, `set search_path = public`, `stable`, returns `boolean`.

Logic:
1. Resolve `plan_tier` from `public.companies` where `id = p_company_id`. If company not found → return `false`.
2. **Hard rule**: if `p_module = 'green_hydrogen'` and `plan_tier <> 'enterprise'` → return `false` (no override can bypass this).
3. Compute plan baseline membership:
   - `starter` → `{crm, engineering, procurement, planning_budget}`
   - `growth` → starter ∪ `{field_qaqc, commissioning, portals}`
   - `enterprise` → all nine modules
4. Look up `module_access_rules(company_id, module)`:
   - If a row exists, return its `enabled` value (subject to the green_hydrogen hard-block above).
   - Else return baseline membership.

Grants:
```sql
revoke execute on function public.has_module_access(uuid, text) from public, anon;
grant execute on function public.has_module_access(uuid, text) to authenticated, service_role;
```

### 5. Deliverable

Single migration applied via `supabase--migration`. The new SECURITY DEFINER warning for `has_module_access` is expected and intentional (matches P-010/P-011/P-012 helpers). Frontend `src/lib/permissions.ts` remains a stub until a later batch swaps it to call this RPC — no code changes in this prompt.
