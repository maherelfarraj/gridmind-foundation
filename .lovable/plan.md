# P-063 — RFQ builder + bid tabulation with TCO leveling

Adds Procurement RFQ authoring, bid capture, and TCO-leveled tabulation on top of the P-062 schema. Mirrors the vendor module's file/pattern conventions.

## 1. Server layer

### `src/lib/rfq.functions.ts` (thin wrapper — helpers in `rfq-rules.ts`)

All handlers `createServerFn` + `.middleware([requireSupabaseAuth])` + zod input, and every mutation calls `writeAuditLog` via `context.supabase.rpc('write_audit_log', ...)`.

Reads:
- `listRfqs({ search?, status?, projectId? })` — RLS-filtered list joined with `projects.name` for the table.
- `getRfq({ rfqId })` — one RFQ + its `rfq_bids` (all statuses) + `vendors` join for names.
- `getRfqWriteAccess()` — returns `{ canAuthor: boolean, canAward: boolean }` from `has_company_role` (author = procurement_admin | procurement_officer | company_admin; award = procurement_admin | company_admin, used later by P-064 but exposed now for UI gating).
- `listRfqEligibleVendors({ search? })` — active vendors in current company for the invite picker.
- `listProjectsForRfq()` — id/name/currency for the project select.

Writes:
- `saveRfqDraft({ id?, title, projectId, currencyCode, issueDate?, dueDate?, terms?, description?, lines })` — upsert while `status='draft'`; lines validated by `rfqLineSchema` (line_no ≥ 1 unique, qty > 0, uom, target_price ≥ 0 nullable). Audit `rfq.create` on insert, `rfq.update` on edit.
- `inviteRfqVendors({ rfqId, vendorIds })` — insert `rfq_bids` rows `status='invited'`; conflict-safe on `(rfq_id, vendor_id)`; audit `rfq.invite` with `{ vendor_ids }`.
- `removeRfqInvite({ bidId })` — only if bid still `invited`; audit `rfq.uninvite`.
- `issueRfq({ rfqId })` — guards ≥1 line and ≥1 invited bid, generates `rfq_number` via `nextRfqNumber(supabase, companyId)` (SELECT max sequence for `RFQ-####` per company → format zero-padded to 4; retry once on unique violation), sets `status='issued'`, `issue_date = today`. Audit `rfq.issue`.
- `submitBid({ bidId, lines, totalPrice?, currencyCode?, leadTimeDays?, validityDate?, attachments? })` — validates each line's `line_no` exists on the parent RFQ (join integrity), positive prices/qty; sets `status='submitted'`, `submitted_at = now()`. Audit `rfq.bid_submit`.

### `src/lib/rfq-rules.ts` (pure helpers — no `createServerFn` here per `tanstack-serverfn-splitting`)

- `RfqLine`, `BidLine`, `RfqStatus`, `BidStatus` types + zod schemas.
- `nextRfqNumber(supabase, companyId)` — reads existing `rfq_number` values, extracts numeric suffix, returns `RFQ-XXXX`.
- `formatRfqNumber(n)` / `parseRfqNumber(s)`.
- `computeTco({ bidLines, rfqLines, minLeadDays, config })` where `config = { delayCostPctPerDay, logisticsPct, defectRiskPct }` — returns `{ perLine: [{ line_no, extended, tco, priceVarianceVsTarget, compliant }], vendorTotal, missingLines[], expired }`.
- `RfqComplianceIssue` union used by the tabulation UI.
- Vitest at `tests/unit/rfq-rules.test.ts` covering: TCO winner flips as delay cost varies, missing-line detection, target-variance signs, RFQ number generation edges (empty, gap, malformed rows).

### `src/lib/rfq-query.ts`

TanStack Query wrappers mirroring `vendors-query.ts`: `rfqsListQueryOptions`, `rfqDetailQueryOptions`, `rfqWriteAccessQueryOptions`, `rfqEligibleVendorsQueryOptions`, `rfqProjectsQueryOptions`, plus `useSaveRfqDraft`, `useInviteVendors`, `useRemoveInvite`, `useIssueRfq`, `useSubmitBid` — each with sonner success/error toasts and invalidation of `["rfqs"]` list + detail keys.

## 2. Routes (dot-separated files under `_authenticated`, matching vendor module)

- `procurement.rfqs.tsx` — layout returning `<Outlet />`, `head()` sets "RFQs — GridMind".
- `procurement.rfqs.index.tsx` — server-filtered table: number, title, project name, status badge, due date, actions. Search + status Select + "New RFQ" button + CSV export (client-side from cached rows). Skeleton / empty ("No RFQs yet — draft your first request") / error retry states.
- `procurement.rfqs.new.tsx` — creates a draft then redirects to `$rfqId`.
- `procurement.rfqs.$rfqId.tsx` — detail with header (number, status badge, project, due date, "Issue RFQ" primary action when draft) and shadcn `Tabs`:
  - **Lines** — `RfqLineEditor` (react-hook-form array field). Disabled once `status !== 'draft'`.
  - **Invited Vendors** — `InvitedVendorList` + `InviteVendorDialog` (Command search of active vendors). Remove only when bid still `invited`.
  - **Bids** — per-bid card showing status, submitted_at, `SubmitBidDialog` for procurement to record vendor's per-line prices (line_no locked from RFQ lines), lead time, validity, attachments.
  - **Tabulation** — `BidTabulationTable` (see below).

## 3. Components (`src/components/procurement/`)

- `rfq-status-badge.tsx`, `bid-status-badge.tsx` — semantic-token variants.
- `rfq-line-editor.tsx` — controlled table of line_no/description/spec/qty/uom/target_price/site_need_date; add/remove rows; blocks duplicate line_no; auto-renumbers on delete only via explicit button (line_no is a stable join key).
- `invite-vendor-dialog.tsx` — Command-based vendor picker fed by `listRfqEligibleVendors`, excludes already-invited.
- `submit-bid-dialog.tsx` — react-hook-form with a bid-line row per RFQ line (line_no + description read-only), unit_price, qty (default = RFQ qty), lead_time_days, exceptions; totals computed live; attachment paths captured (upload deferred to a follow-up — dialog accepts existing paths and shows a note).
- `bid-tabulation-table.tsx` — the leveling matrix:
  - Sticky top controls (component state, defaults from spec): delay cost `0.05` %/day, logistics `3` %, defect risk `1` %; number inputs with unit labels.
  - Header row: RFQ lines with `target_price` shown; body rows: vendors × cells `{ unit_price, extended = unit_price × qty, tco, Δ vs target }`.
  - `bg-primary/10` background on the TCO-lowest **compliant** bid per line.
  - Non-compliant vendors get an `AlertTriangle` badge listing issues (missing lines, expired validity, withdrawn/rejected status).
  - Footer row per vendor: vendor total TCO + vendor-level winner highlight.
  - KPI strip on top: overall lowest-TCO vendor, average price variance vs target, count of non-compliant bids.
  - Loading skeleton, empty state "No bids submitted yet", inline error banner + sonner toast on TCO recompute failure.

## 4. Navigation

Add "RFQs" entry under the Procurement section in `src/lib/nav-map.ts` alongside the existing "Vendors" link (`/procurement/rfqs`).

## 5. Design tokens & UX

- Semantic tokens only (`bg-primary/10`, `text-destructive`, `border-border`, etc.).
- Sonner toasts on every mutation success + failure.
- CSV export uses `Blob` + `application/csv;charset=utf-8;`.

## Verification after build

1. Type check: `bunx tsgo --noEmit`.
2. Run `tests/unit/rfq-rules.test.ts` — asserts TCO winner flip and RFQ number generator.
3. Manual flow (matches acceptance list):
   - Draft "PV Modules 175 MWp" with 3 lines → issue blocked with 0 vendors (button disabled + toast) → invite 2 vendors → issue succeeds → confirm `rfq_number` = `RFQ-0001` via `supabase--read_query`.
   - Enter 2 bids with different price/lead-time trade-offs.
   - Toggle delay cost in Tabulation from 0.05% → 0.5% and confirm the highlighted winner flips.
   - Confirm `audit_logs` has rows for `rfq.create`, `rfq.issue`, `rfq.bid_submit`.

## Deferred to P-064

- Line award writes to `rfq_line_awards`.
- CFO approval gate + PO generation.

Award-role detection is exposed via `getRfqWriteAccess` so the Tabulation tab can render "Award" affordances as disabled placeholders now, wired up in P-064.
