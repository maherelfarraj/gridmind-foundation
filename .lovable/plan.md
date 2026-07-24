## P-044 — Proposals schema + versioning RPC

### Migration (single call, applied via migration tool)
Contents match spec exactly, plus the omitted-for-brevity boilerplate:

1. `create type proposal_status` (guarded by `do $$ ... duplicate_object`).
2. `create table public.proposals` with version chain, financial fields, e-sign block, jsonb configs.
3. `create table public.proposal_line_items` with category check + numeric guards.
4. Two indexes as specified.
5. `proposals_guard_immutable()` trigger — blocks pricing edits once status leaves `draft`/`in_review`.
6. `set_updated_at` BEFORE UPDATE triggers on both tables (uses existing `public.set_updated_at()`).
7. `GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals, public.proposal_line_items TO authenticated;` + `GRANT ALL ... TO service_role;` (no anon — every policy scopes to company membership).
8. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on both.
9. Four policies per table, matching P-041 CRM pattern:
   - `select` — `is_company_member(company_id)`
   - `insert` — `is_company_member(company_id) AND (has_role(auth.uid(),'sales') OR has_role(auth.uid(),'company_admin'))`
   - `update` — same as insert (both USING and WITH CHECK)
   - `delete` — `is_company_member(company_id) AND has_role(auth.uid(),'company_admin')`

### Server function — `createProposalVersion`
File: `src/lib/proposal.functions.ts` (new).

- `createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth]).inputValidator(z.object({ proposalId: z.string().uuid() }).parse).handler(...)`
- Loads source proposal + all its `proposal_line_items` under RLS via `context.supabase`.
- Inserts a new proposal row copying every field except: `id` (new), `version = old.version + 1`, `previous_version_id = old.id`, `status = 'draft'`, `esign_provider/envelope_id/status/history/sent_at/completed_at`, `signed_copy_path`, `pricing_lock`, `sent_at`, `accepted_at` all reset; `created_by = context.userId`.
- Bulk-inserts copied line items with the new `proposal_id`, preserving `sort_order`, `category`, `description`, `qty`, `unit`, `unit_price`, `line_total`.
- Updates old row: `status = 'superseded'` (allowed only if old.status not already superseded/accepted; otherwise raise).
- Calls `writeAuditLog('proposal.version_created','proposal', newId, { opportunity_id, from_version: old.version })` via `supabase.rpc('write_audit_log', ...)`.
- Returns `{ id, version }`.

### Verification (post-migration)
Direct SQL queries via psql:
- Confirm both tables + all columns exist and RLS enabled (`pg_tables.rowsecurity`).
- Immutability test: insert a proposal at status `sent`, attempt `update proposals set total=999`, expect `proposal ... is sent — create a new version to change pricing`. Clean up.
- Second migration apply is a no-op (all `if not exists` / `create or replace` / `drop trigger if exists`).

Version-chain live test (`createProposalVersion` → v2 draft, v1 superseded, audit row) will be exercised in P-045 when the builder UI exists; called out here so we don't build a throwaway harness.

### Not in scope
- Proposal builder UI, line-item editor, PDF/DOCX rendering, e-sign wiring — all P-045+.
- Query hooks (`proposal-query.ts`) — added alongside the builder in P-045.

### Files touched
- `supabase/migrations/0016_proposals.sql` (via migration tool; Cloud auto-prefixes timestamp).
- `src/lib/proposal.functions.ts` (new).