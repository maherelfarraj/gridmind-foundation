# P-075 — Budgets, cost codes, PO commitment import

Adds the finance backbone: hierarchical cost codes mapped to WBS, versioned budgets with a generated `current_amount`, and a PO commitment import that snapshots issued POs into `budgets.po_commitments`. Follows the same rules-and-server-fn pattern used for schedule/risks.

## Migration — `supabase/migrations/0033_budgets_cost_codes.sql`

Filename bumped to `0033_` because `0032_planning_baseline.sql` already exists (P-071 renumbered). SQL body is exactly the spec block, plus:
- `create trigger set_updated_at_cost_codes before update on public.cost_codes for each row execute function public.set_updated_at();`
- Same trigger on `public.budgets`.
- `service_role` gets `all` on both tables (matches project convention; the spec grant block covers `authenticated` and deliberately omits DELETE on budgets for the 7-year retention rule).

Financial immutability rule: no DELETE grant on `budgets` — new versions supersede. `cost_codes` keeps DELETE (they're metadata, not financial ledger rows).

## Server layer

- `src/lib/budget.rules.ts` — pure logic + zod:
  - `costCodeCreateSchema`, `costCodeUpdateSchema` (code regex `^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$`, name, description, parent_id, wbs_item_id).
  - `budgetUpsertSchema` (project_id, cost_code_id, original_amount ≥ 0, approved_changes, currency_code, notes, wbs_item_id).
  - `poAssignmentSchema` — array of `{ po_id, cost_code_id }`.
  - `variance(current, committed, actual)` and `varianceBand(v)` → `ok | warning | destructive` for color tokens.
  - `sumSnapshot(entries)` and `buildPoSnapshotEntry(po)`.
  - `groupCostCodesByParent(rows)` — tree builder for the UI.
- `src/lib/budget.functions.ts` (`createServerFn` + `requireSupabaseAuth`):
  - `getBudgetAccess` → `{ canWriteCostCodes, canWriteBudgets }` via `has_company_role` (`finance_admin`/`project_admin`/`company_admin` for cost codes; `finance_admin`/`company_admin` for budgets).
  - `listCostCodes({ projectId })`, `createCostCode`, `updateCostCode`, `deleteCostCode` (soft-guard: refuse when a budget row references it).
  - `listBudgets({ projectId })` returning cost code join + wbs code/name.
  - `upsertBudget` — writes version 1 on first save; when `original_amount`/`currency_code` change on an existing row, insert new `version = max+1` (supersede) rather than mutating; simple `notes`/`wbs_item_id` edits update in place.
  - `listProjectPurchaseOrders({ projectId })` — POs in `issued`/`approved`/`acknowledged` states, projected to `{ id, po_number, vendor_name, total_amount, currency_code }`.
  - `importPoCommitments({ projectId, assignments })` — groups assignments per cost code, replaces `po_commitments` snapshot, recomputes `committed_amount = sum(amount)` on each affected budget row, `write_audit_log('budget.import_commitments', 'budgets', budget.id, { po_ids, total })` per row.
  - Every mutation audit-logs: `cost_code.create|update|delete`, `budget.create|update|supersede`, `budget.import_commitments`.
- `src/lib/budget.query.ts` — `queryOptions` wrappers + `budgetErrorMessage`.
- `src/lib/budget.csv.ts` — CSV export: cost code, name, WBS, current, committed, actual, variance, currency.

## UI

- `src/routes/_authenticated/projects.$projectId.finance.tsx` — new pathless finance layout with sub-tabs (Budget for now; future EVM/change orders slot in). Follows the planning sub-tab pattern.
- `src/routes/_authenticated/projects.$projectId.finance.budget.tsx` — orchestrator route with `head()`, `pendingComponent` skeleton, `errorComponent` (retry via `router.invalidate()`).
- `src/components/finance/budget-kpi-strip.tsx` — 4 cards: total budget (current), total committed, total actual, total variance (colored via `varianceBand`). Intl currency formatter locked to project's dominant currency (falls back to first budget row).
- `src/components/finance/budget-tree-table.tsx` — tree-table grouped by `parent_id`. Columns: code, name, WBS select (inline `wbs_item_id` update via `updateCostCode`), original, approved changes, current (generated, read-only, muted), committed, actual, variance (signed with band color). Expand/collapse parents. Empty state ("No cost codes yet — start with a standard EPC breakdown"). Role-gated inline edits.
- `src/components/finance/cost-code-dialog.tsx` — create/edit cost code (react-hook-form + zod).
- `src/components/finance/import-commitments-dialog.tsx` — the money moment: lists POs from `listProjectPurchaseOrders`, each row has a cost-code `Select`; running-sum preview per cost code; "Import" calls `importPoCommitments` and toasts committed totals. Skeleton while POs load, empty state when no eligible POs.
- Toolbar: "New cost code", "Import PO commitments", "Export CSV".

## Verification

1. Migration runs twice cleanly; `supabase--linter` clean for new tables.
2. `supabase--read_query` checks: RLS enabled; DELETE not granted to authenticated on `budgets`; generated column `current_amount = original_amount + approved_changes`.
3. `tests/unit/budget-rules.test.ts` — variance/band, snapshot sum, tree grouping, schema rejects (negative amount, bad code).
4. `bunx tsgo --noEmit` clean.
5. Preview smoke: create the three cost codes, map WBS, import Batch 07 POs → committed matches PO totals, variance updates live, audit log entries present, CSV export works, non-finance user is blocked from writes.

## Non-goals

- No change-order approval UI (P-081 owns `approved_changes` mutation).
- No actual-invoice ingestion (P-080).
- No EVM math or S-curve (P-076).
- Multi-currency conversion out of scope — budgets stored in their own `currency_code`; KPIs sum per currency; mixed-currency projects show per-currency subtotals rather than an FX-converted grand total.

## Follow-ups

P-076 — EVM snapshots (PV/EV/AC, SPI/CPI) reading from these budget rows.
