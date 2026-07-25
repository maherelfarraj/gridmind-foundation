# P-079 — Pay applications, invoices, change orders

## 1. Migration `supabase/migrations/0036_financial_commitments.sql`

- Guarded `do $$ begin ... exception when duplicate_object then null; end $$` for each of the 4 enums (`invoice_direction`, `invoice_status`, `pay_app_status`, `change_order_status`).
- Create `invoices`, `pay_applications`, `change_orders` exactly as specified (columns, defaults, uniques, FKs).
- Drop-if-exists then add `three_way_matches_invoice_fk` on `three_way_matches.invoice_id → invoices.id` (Batch 07 debt).
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + policies:
  - SELECT: `is_company_member(company_id)` on all 3.
  - Writes on `invoices`: `finance_admin` or `company_admin`.
  - Writes on `pay_applications` / `change_orders`: `project_admin`, `finance_admin`, `company_admin`.
- `GRANT SELECT, INSERT, UPDATE` to `authenticated` on all 3 (no DELETE — 7-year retention via `rejected`/`cancelled`).
- Indexes: `inv_company_idx`, `pa_contract_idx`, `co_project_idx`.

## 2. Shared rules — `src/lib/pay-app.rules.ts`

- Enum constants + zod schemas: `PayAppLineSchema`, `PayAppUpsertSchema`, `PayAppCertifyInputSchema` (per-line `this_period` map), `ReconciliationResult` type.
- `computePayAppTotals(lines, retention_pct)`: rounds via cents to avoid float drift; returns `{total_scheduled, total_certified, retention_amount, net_amount, lines_with_totals}` where each line gets `total_certified = prev_certified + this_period` and `pct_complete`.
- `validateCertifyInput(lines)`: throws with offending `sov_line_no[]` when any `this_period < 0` or `prev_certified + this_period > scheduled_amount`.
- `reconcilePayApp({contract_status, contract_value, lines, totals})`: pure function returning `{ok, failures: {rule, sov_line_nos?}[], checked_at}`. Rules:
  1. contract status ∈ `signed`/`active`.
  2. per-line `total_certified <= scheduled_amount` (collect overrun line_nos).
  3. `total_certified <= contract_value`.
  4. `Σ line.total_certified == totals.total_certified` (integrity).
- `nextInvoiceNumber(existing: string[])` → `INV-0001` sequence per company.
- `nextPayAppNumber(existingForContract: number[])` → next integer.

## 3. Shared rules — `src/lib/change-orders.rules.ts`

- `CHANGE_ORDER_STATUSES` + `ChangeOrderUpsertSchema` (title, amount signed number, `budget_impact` array, `schedule_impact_days`, optional `wbs_item_id`).
- `nextChangeOrderNumber(existing: string[])` → `CO-YYYY-####` scoped to year.

## 4. Server functions — `src/lib/pay-app.functions.ts`

All `createServerFn` + `.middleware([requireSupabaseAuth])` + zod validators + `write_audit_log`.

- `listPayApplications({project_id})` — RLS-scoped select.
- `getPayApplication({id})` — returns pay app + parent contract SOV/value/status.
- `createPayApplication({project_id, contract_id, period_start, period_end, retention_pct?})`
  - Loads contract; refuses if `status not in (signed,active)`.
  - Loads latest approved pay app for that contract; carries `prev_certified` from its `lines[].total_certified` (0 when none).
  - Pre-fills `lines` from `contract.schedule_of_values` with `this_period = 0, total_certified = prev_certified`.
  - Computes totals, inserts with next `application_number` per contract, status `draft`.
  - Audit `pay_app.create`.
- `updatePayApplicationLines({id, this_period_by_line_no, retention_pct?})`
  - Guards status `draft`.
  - Runs `validateCertifyInput` (server-side ≥0 and ≤scheduled).
  - Recomputes totals.
  - Audit `pay_app.update`.
- `certifyPayApplication({id})`
  - Role gate: `project_admin` | `finance_admin` | `company_admin` via `has_role`.
  - Re-runs line validation; sets `certified_by/at`, `status='certified'`, refreshed totals.
  - Audit `pay_app.certify`.
- `approvePayApplication({id})`
  - Role gate: `finance_admin` | `company_admin` only (project_admin → 403).
  - Loads contract + current lines; runs `reconcilePayApp`; on failure stores `reconciliation` jsonb, throws typed error `{message, failures}` so UI shows destructive banner listing offending `sov_line_nos`.
  - On success: writes `reconciliation` with `ok:true, checked_at`, sets `approved_by/at`, `status='approved'`.
  - Audit `pay_app.approve` (metadata: reconciliation).
- `rejectPayApplication({id, note})` — role gate finance/company_admin; status → `rejected`; audit `pay_app.reject` with note.
- `generatePayAppInvoice({id})`
  - Guards status `approved`.
  - Role gate finance/company_admin.
  - Loads pay app; creates `invoices` row: direction `receivable`, `status='submitted'`, `amount = net_amount`, `currency_code` from contract, `invoice_number` via `nextInvoiceNumber` (query existing per company).
  - Updates pay app `invoice_id`, `status='invoiced'`.
  - Audit `pay_app.invoice` + `invoice.create`.

## 5. Server functions — `src/lib/change-orders.functions.ts`

Minimal CRUD (P-079 only needs the schema present; full workflow lands in later batch):
- `listChangeOrders({project_id})`, `upsertChangeOrder(input)` (writer role gate, auto-number).
- Audit `change_order.upsert`.

## 6. Server functions — `src/lib/invoices.functions.ts`

`listInvoices({project_id?, direction?})` — SELECT only for P-079; write endpoints land in P-080. Reused by pay-app detail to render the linked invoice.

## 7. Query helpers

- `src/lib/pay-app.query.ts` — `payAppListQueryOptions(projectId)`, `payAppDetailQueryOptions(id)`.
- `src/lib/change-orders.query.ts` — `changeOrdersListQueryOptions(projectId)`.

## 8. Routes

- `src/routes/_authenticated/projects.$projectId.finance.pay-applications.tsx`
  - Loader ensures list query. Table: number, period (`period_start → period_end`), certified, retention, net, status badge, updated. Skeleton / empty / error states. CSV export via `src/lib/pay-app.csv.ts`. "New application" dialog picks a signed/active contract from project.
- `src/routes/_authenticated/projects.$projectId.finance.pay-applications.$payAppId.tsx`
  - Loader for detail. Sections:
    - Header: contract link, status badge, period, timeline (created → certified → approved → invoiced).
    - `PayAppLineGrid`: SOV columns (`sov_line_no`, `description`, `scheduled_amount`, `prev_certified`, `this_period` input, computed `total_certified`, `pct_complete`). Client-side validation mirrors server; live totals footer.
    - `PayAppTotalsCard`: total_scheduled, total_certified, retention (%), net.
    - `ReconciliationBanner`: renders `reconciliation.failures` in destructive tone with sov_line_no chips.
    - Actions bar (role-aware via `useCurrentUserRoles`): Save draft, Certify, Approve, Reject (dialog with note), Generate invoice, Download PDF (skipped for P-079 — mark TODO).
  - Linked invoice section when `invoice_id` set.

## 9. Nav

- Add "Pay applications" under project Finance section in `src/lib/nav-map.ts`.

## 10. CSV

- `src/lib/pay-app.csv.ts` — `toPayAppCsv(rows)`, wired to list toolbar.

## 11. Unit tests — `tests/unit/pay-app-rules.test.ts`

- `computePayAppTotals`: retention math, line totals, no float drift on 3-decimal inputs.
- `validateCertifyInput`: negative `this_period` throws with correct `sov_line_no`; overrun throws.
- `reconcilePayApp`: passes for signed+matching; fails for `draft` contract; fails with correct line_nos on overrun; fails on contract-value overrun.
- `nextInvoiceNumber` / `nextPayAppNumber` sequencing incl. gaps.

## 12. Verification steps in this turn

1. Apply migration; re-run to confirm idempotent (guarded enums, `if not exists`, drop-if-exists FK).
2. `psql` inspection: RLS enabled on 3 tables, 6 policies present, FK `three_way_matches_invoice_fk` targets `invoices.id`, no DELETE grants.
3. Vitest: 12+ tests pass.
4. `bunx tsgo --noEmit` clean.

## Notes & constraints

- `LOVABLE_API_KEY` not used here (no AI).
- All amounts routed through cents-integer math to avoid float drift.
- No DELETE endpoints; rejected/cancelled statuses cover retirement.
- Reconciliation is server-authoritative; client mirrors it for UX only.
- The `reconciliation` jsonb stores last check so audit trail persists even after approval.
