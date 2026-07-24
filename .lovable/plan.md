# P-067 — Three-Way Match

Payment gatekeeper: match vendor invoices against PO and GRN totals; block payment when variance exceeds tolerance; allow finance-admin override with mandatory note.

## 1. Migration — `0029_three_way_match.sql`

Note: numbering as `0029` since `0028_goods_receipts.sql` was used in P-066 (spec's "0028" name is superseded by this project's sequence).

- Guarded `do $$` block creating `match_status` enum: `pending | matched | variance_blocked | approved_with_variance`.
- `public.three_way_matches` table per spec (company_id, po_id, goods_receipt_id nullable, `invoice_id uuid` with **no FK** — Batch 08/P-080 will add it, vendor_invoice_number, invoice_date, invoice_amount `numeric(14,2)`, invoice_currency_code → `currencies(code)`, invoice_file_path, status, `qty_variance_pct/price_variance_pct` numeric(6,2), `amount_variance` numeric(14,2), `variance_threshold_pct` numeric(5,2) default 5.00, `payment_release_blocked` bool, resolution_note, matched_by/matched_at, created_by, created_at/updated_at).
- Ordered exactly: CREATE TABLE → GRANT select/insert/update to authenticated + ALL to service_role → ENABLE RLS → policies `twm_select` (any company member) and `twm_write` (member AND `procurement_admin | finance_admin | company_admin`).
- Indexes `(po_id, status)` and `(company_id, status)`.
- Attach existing `set_updated_at()` BEFORE UPDATE trigger.

## 2. Pure logic — `src/lib/match-rules.ts`

Unit-testable, no I/O.
- Types: `MatchStatus`, `MatchInputs { poTotal, poQtyByLine, poUnitPriceByLine, grnQtyByLine, invoiceAmount, invoiceQtyByLine?, invoiceUnitPriceByLine? }`.
- `computeVariances(inputs)` → `{ qty_variance_pct, price_variance_pct, amount_variance }`. Uses max abs line-level pct across lines for qty & price; amount_variance = `invoiceAmount − poTotal`.
- `deriveMatchStatus({ variances, thresholdPct })` → `matched` when all abs pcts ≤ threshold, else `variance_blocked`.
- Zod schemas: `matchCreatePayload` (vendor_invoice_number required non-empty ≤ 120, invoice_date optional ISO, invoice_amount > 0, currency ISO 4217 ≤ 8, threshold 0–100, optional line invoice qty/price arrays), `matchOverridePayload` (`resolution_note` trimmed min 5, max 2000).

## 3. Server fns — `src/lib/match.functions.ts`

All with `requireSupabaseAuth`, role checks via `context.supabase` + `has_company_role`, `writeAuditLog` for every mutation. Currency defaults to PO's `currency_code`.

- `listMatches({ status?, poId?, search? })` — joined with PO number, vendor name, GRN number.
- `getMatch({ matchId })` — full row + PO snapshot + GRN snapshot + signed invoice URL.
- `getMatchContextForPo({ poId })` — returns PO lines/totals + summed confirmed GRN qty by line for pre-filling the form.
- `createMatch({ poId, grnId?, payload })` — role: `procurement_admin | finance_admin | company_admin`. Server recomputes variances from PO + GRN, ignores any client-supplied variance fields, derives status, sets `payment_release_blocked = (status === 'variance_blocked')`, stores `invoice_file_path` when provided. Audit `match.create`; add `match.block` when blocked.
- `uploadInvoiceFile` helper path guard: enforce prefix `{company_id}/invoices/{match_id}/…`. Actual upload uses existing client-side storage helper; server persists the path only after validation. Draft-first pattern: `createMatch` returns id so client can upload then call `attachInvoiceFile({ matchId, path })`.
- `overrideMatchVariance({ matchId, resolution_note })` — role: `finance_admin | company_admin` only; requires non-empty note; only valid when `status = variance_blocked`; sets `status = approved_with_variance`, `payment_release_blocked = false`, `matched_by/matched_at`. Audit `match.override` with `{ from_status, note }`.
- `updateMatchThreshold({ matchId, threshold_pct })` — `finance_admin | company_admin`; recomputes status & block from stored variances. Audit `match.threshold_update`.
- `getMatchVarianceKpi()` — avg absolute `amount_variance / po_total` % for matches created in current quarter (company-scoped). Returned as `{ avgPct, count }`.

Payment release integration: exposes `payment_release_blocked` for Batch 08 to consume — no code from this batch touches invoice/pay flows.

## 4. Query hooks — `src/lib/match-query.ts`

`useMatchList`, `useMatch`, `useMatchContextForPo`, `useMatchVarianceKpi`, mutations `useCreateMatch`, `useAttachInvoiceFile`, `useOverrideMatch`, `useUpdateMatchThreshold`. Invalidate `["matches"]`, `["match", id]`, `["po", poId]`, `["match-kpi"]`. Sonner toasts, `errorMessage` helper reused from GRN pattern.

## 5. UI routes

- `src/routes/_authenticated/procurement.matches.tsx` — `<Outlet />`.
- `procurement.matches.index.tsx` — KPI tile (avg variance % this quarter), table (PO#, GRN#, vendor invoice #, invoice amount, PO amount, variance % badge — semantic `default/warning/destructive` via existing Badge variants, status badge, blocked indicator), status filter, search, CSV export, skeleton/empty ("No invoices matched yet")/error+retry.
- `procurement.matches.new.tsx` — accepts `?po=<id>`; PO picker if missing. Loads context, pre-fills PO total & GRN qty summary, form: vendor invoice #, date, amount (with currency read-only from PO), optional invoice PDF upload (creates match first for `{match_id}` path), threshold override input gated to `finance_admin/company_admin`. On submit shows live client-side variance preview using `computeVariances`; server is source of truth. Sticky action bar.
- `procurement.matches.$matchId.tsx` — detail view: PO/GRN summary cards, invoice card with signed PDF link, variance breakdown (qty/price/amount with tolerance line), status stepper `pending → matched | variance_blocked → approved_with_variance`, destructive banner "Payment release blocked" when `payment_release_blocked`, "Approve with variance" dialog (finance-admin only, mandatory `resolution_note` textarea min 5 chars), threshold editor (finance-admin), audit trail excerpt.

## 6. `MatchStatusBadge` component

`src/components/procurement/match-status-badge.tsx` — semantic variant map: matched=default, pending=secondary, variance_blocked=destructive, approved_with_variance=outline.

## 7. Nav

`src/lib/nav-map.ts`: add "Invoice Matching" under Procurement with a suitable lucide icon (e.g. `Scale`).

## 8. Storage

Reuse `documents` bucket. Path prefix `{company_id}/invoices/{match_id}/{uuid}.pdf` — server validates prefix before persisting. Signed URL generated server-side.

## 9. Tests

- `tests/unit/match-rules.test.ts` — variance math (exact match → 0/0/0 → matched; +8% amount → variance_blocked; per-line qty/price pcts; threshold edge cases), zod rejects empty invoice # / negative amount / short override note.
- `tests/rls/three-way-match.rls.test.ts` — stub: non-member blocked; `procurement_officer` cannot insert; `finance_admin` can override.

## Acceptance verification

- Invoice = PO total → `matched`.
- Invoice 8% above PO → `variance_blocked`, destructive banner, `payment_release_blocked = true`.
- Override without note → server rejects (zod); with note as `finance_admin` → `approved_with_variance`, block cleared, `match.override` audited.
- Variance math verified in unit tests (qty vs GRN, price vs PO, amount = invoice − PO).
- `procurement_officer` write denied by RLS; `match.create/block/override` all in audit_logs.
- KPI tile renders avg abs amount-variance % for current quarter.

## Technical notes

- No `invoice_id` FK yet — column is `uuid` nullable; Batch 08/P-080 will add `references invoices(id)` in its own migration.
- Currency: single-currency match keyed to PO currency; cross-currency variance out of scope for this batch.
- All numeric formatting via `Intl.NumberFormat` using PO's `currency_code`.
- Design tokens only; badges via existing variant map (no raw colors).
- No changes to `po.functions.ts`; downstream payment flow reads `payment_release_blocked` in P-080.
