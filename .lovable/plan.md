# P-062 — RFQs, bids & line awards

Schema-only task (server functions/UI land in later phases). No app code changes.

## 1. Migration `supabase/migrations/0025_rfq_core.sql`

Apply the exact SQL in the prompt with these additions:

- Wrap both `create type` statements in guarded `do $$ begin ... exception when duplicate_object then null; end $$;` blocks (idempotent re-apply).
- Attach existing `public.set_updated_at()` trigger to `rfqs`, `rfq_bids`, `rfq_line_awards`:
  ```sql
  create trigger rfqs_set_updated_at before update on public.rfqs
    for each row execute function public.set_updated_at();
  -- same for rfq_bids, rfq_line_awards
  ```
  Guard each with `drop trigger if exists ...` for re-apply safety.
- Keep GRANTs exactly as spec'd — note awards get only `insert, update` (no delete) since they're financial commitments; `rfq_line_awards` write policy is limited to `procurement_admin` / `company_admin` (blocks `procurement_officer`, which is the acceptance test).

Order per house rules: CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY.

## 2. RLS test stub `tests/rls/rfq-core.rls.test.ts`

Minimal vitest stub asserting cross-tenant isolation on all three tables (full suite in P-132). Structure mirrors existing `tests/rls/` conventions — placeholder `describe.skip` or a real two-tenant probe if a harness already exists. I'll check `tests/rls/` first and match whatever's there; if empty, ship a `describe.skip('rfq RLS — cross-tenant isolation', ...)` scaffold with three `it` cases (one per table) so P-132 can wire it up.

## 3. Notes deferred to later phases (not implemented here)

- `rfq_number` generator (RFQ-#### per company, unique-constraint retry) — belongs in `rfq.functions.ts` with the create RPC.
- Zod validation of `line_no` join integrity across `rfqs.lines` / `rfq_bids.lines` / `rfq_line_awards`.
- `writeAuditLog('rfq.create'|'rfq.bid_submit'|'rfq.award', ...)` — inside the mutations.
- These are called out in the prompt as `createServerFn` responsibilities; leaving them for the RFQ UI phase.

## Verification after apply

- `supabase--read_query` on `pg_policies` and `information_schema.triggers` to confirm 6 policies (2 per table) + 3 `set_updated_at` triggers.
- Re-run the migration to confirm idempotency of the enum guards and trigger drops.
- `supabase--linter` to catch any missed RLS/grant issue.
