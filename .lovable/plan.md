## P-064 — Award Flow, PO Generation & CFO Approval Gate

### 1. Migration `0026_purchase_orders.sql`
- Guarded `create type po_status as enum (...)`.
- `alter table companies add column if not exists po_approval_threshold numeric(14,2) not null default 50000`.
- Create `public.purchase_orders` per spec (jsonb `lines`, totals, `share_token`, `pdf_path`, approval fields, `unique(company_id, po_number)`).
- GRANTs → `authenticated` (select/insert/update), `service_role` (all).
- Enable RLS + policies:
  - `pos_select`: `is_company_member(company_id)`
  - `pos_write` (ALL): company member AND role ∈ {procurement_admin, procurement_officer, finance_admin, company_admin}
- Indexes: `pos_company_project_idx`, unique `pos_share_token_idx`.
- Attach `set_updated_at()` trigger.

### 2. Server modules (splitting-safe: helpers in `.server.ts`, RPCs in `.functions.ts`)

**`src/lib/po-rules.ts`** (pure helpers, unit-tested):
- `formatPoNumber(n)` / `parsePoNumber(s)` / `nextPoNumber(existing)` (mirrors RFQ pattern).
- `buildPoLinesFromAwards(rfqLines, awards)` → merges award qty/price with RFQ spec/description/uom.
- `computePoTotals(lines, taxPct)` → `{subtotal, tax_amount, total_amount}` with rounding at 2 dp.
- `PO_STATUSES` const + `PoStatus` type.

**`src/lib/po.functions.ts`**:
- `getPoWriteAccess` → `{ canAuthor, canApprove }` via `has_company_role` for the four roles.
- `awardRfqLine({ rfqId, lineNo, bidId, awardedQty?, awardNote? })`: procurement_admin/company_admin only. Validates bid belongs to RFQ, line exists on RFQ, computes `awarded_amount = qty * unit_price` from the bid line, inserts with `unique(rfq_id, line_no)` → 23505 mapped to `line_already_awarded`. Audit `rfq.award`.
- `unawardRfqLine({ awardId })`: same roles, only allowed while no PO has been generated yet for that vendor/rfq (i.e. no purchase_orders row references the rfq for this vendor). Audit `rfq.unaward`.
- `generatePosFromAwards({ rfqId })`: requires every RFQ line awarded; groups awards by `rfq_bid.vendor_id`; for each vendor creates one `purchase_orders` row with:
  - `po_number = PO-####` per company (single retry on 23505),
  - `lines` built via `buildPoLinesFromAwards`,
  - totals via `computePoTotals` (default `tax_pct = 0`),
  - vendor payment_terms/incoterms/currency copied from vendors table,
  - `project_id`, `currency_code`, `required_by_date` = max(site_need_date),
  - status `draft`.
  - Idempotent: skips vendor if a PO already exists for this rfq+vendor.
  - Audit `po.create` per PO.
- `listPos({ projectId?, status?, search? })` + `getPo({ poId })`.
- `submitPoForApproval({ poId, note? })`: procurement roles; if `total_amount > companies.po_approval_threshold` → `pending_approval`; else auto-set `approved` with system note "Auto-approved (below threshold)" and stamps `approved_at`. Audit `po.submit`.
- `approvePo({ poId, note })`: finance_admin/company_admin only; requires `pending_approval`; note trimmed non-empty; sets `approved`, `approved_by`, `approved_at`, `approval_note`. Audit `po.approve`.
- `rejectPo({ poId, note })`: same roles; requires `pending_approval`; note mandatory; sets back to `draft` with `approval_note`. Audit `po.reject`.
- `setPoApprovalThreshold({ threshold })`: company_admin only, updates `companies.po_approval_threshold`. Audit `company.po_threshold_update`.

### 3. TanStack Query wrappers `src/lib/po-query.ts`
- `posListQueryOptions`, `poDetailQueryOptions`, `poWriteAccessQueryOptions`.
- Mutations: `useAwardLine`, `useUnawardLine`, `useGeneratePos`, `useSubmitPoForApproval`, `useApprovePo`, `useRejectPo`, `useSetPoThreshold`.
- All invalidate `["pos"]`, `["po", id]`, and the parent `["rfq", rfqId]` cache.

### 4. UI

**Tabulation tab (`procurement.rfqs.$rfqId.tsx`)**
- Add per-line "Award" button (icon in the winning highlighted cell) opening a small popover: preselect current TCO winner bid, editable awarded qty (defaults to RFQ line qty), optional note, submit.
- Show award badge on cells that are awarded (line locked; "Unaward" for procurement_admin when no PO yet).
- Header banner: "3 / 3 lines awarded — Generate POs" button when all lines awarded and no POs yet. On success toasts count + navigates to `/procurement/pos`.
- All controls gated on `canAward` from existing RFQ access + `canAuthor` PO access.

**New routes**
- `src/routes/_authenticated/procurement.pos.tsx` (Outlet).
- `src/routes/_authenticated/procurement.pos.index.tsx`: list POs (columns: PO #, project, vendor, status badge, total, created, issued). KPI strip: **Total POs**, **Pending approval**, **Avg PO cycle time (days created→issued)**. Search + status filter, CSV export, skeleton, empty state.
- `src/routes/_authenticated/procurement.pos.$poId.tsx`: minimal detail (P-065 delivers PDF/share). Shows header (PO #, vendor, project, status badge, totals), lines table, threshold banner, and action bar:
  - `Submit for approval` (draft → pending_approval|approved based on threshold),
  - `Approve` / `Reject` (both open a dialog with required `approval_note`) for finance_admin/company_admin when `pending_approval`,
  - `Issue` (approved → issued, stamps `issued_at`) so KPI has data.
- `src/routes/_authenticated/settings.procurement.tsx`: PO approval threshold form (company_admin only). Adds nav entry under Administration.
- Add `Procurement > POs` nav item (icon `Receipt`).

**Reusable components** under `src/components/procurement/`:
- `po-status-badge.tsx`
- `award-line-dialog.tsx`
- `po-approval-dialog.tsx`
- `po-cycle-time-kpi.tsx` (computes on the client from list rows: avg of `issued_at - created_at` in days across POs where both stamps exist; excludes null).

### 5. Unit tests
`tests/unit/po-rules.test.ts` covers:
- PO numbering (`PO-0001`, increments, ignores malformed).
- `computePoTotals` — subtotal + tax rounding, zero tax.
- `buildPoLinesFromAwards` merges spec/desc/uom and preserves qty/price from award; sorts by `line_no`.

### 6. Manual verification checklist (money chain)
1. Award all 3 lines split across 2 vendors → **Generate POs** → 2 POs with correct per-vendor totals.
2. Attempt double-award same line → server returns `line_already_awarded`, toast surfaces, UI stays clean.
3. PO with total > $50k → status `pending_approval`, Issue disabled; approve as finance_admin with note → `approved`; below-threshold PO auto-approves.
4. Reject dialog blocks submit until note filled; verify audit rows for `rfq.award`, `po.create`, `po.approve`, `po.reject` via `audit_logs` read query.
5. Confirm PO cycle-time KPI tile renders on `/procurement/pos` (with two issued POs of differing durations to show non-zero average).

### 7. Notes / forward-compat
- Approval fields (`approved_by`, `approved_at`, `approval_note`) match the eventual `approval_instances` schema names so the Batch-12 engine can shim in without a rename.
- `share_token` and `pdf_path` are populated in P-065; this batch leaves them null but preserves the columns and unique index.

When green, respond with **next → P-065**.
