# P-066 — Goods Receipts (GRN)

Build goods receiving against issued POs with lot tracking, defects, and photo capture. Mobile-friendly for site crews. All mutations through `createServerFn + zod + requireSupabaseAuth`, RLS-scoped via `is_company_member` + role checks in `user_roles`, every state change audited.

## 1. Migration — `goods_receipts` table

New migration creating:

- `grn_status` enum (`draft`, `confirmed`, `has_defects`, `closed`) — guarded `do $$ ... $$` block so re-runs are safe.
- `public.goods_receipts` per the spec: `company_id`, `po_id` (cascade), `project_id`, `grn_number`, `status`, `lines jsonb` (`[{po_line_no, description, qty_ordered, qty_received, lot_ids[], condition, defect_notes}]`), `defects_count`, `photos jsonb` (paths in `photos` bucket), `notes`, `received_by/at`, `created_by/at`, `updated_at`, unique `(company_id, grn_number)`.
- Grants: `select, insert, update` to `authenticated`; `all` to `service_role`.
- RLS enabled + policies:
  - `grn_select` — any company member.
  - `grn_write` — company member AND one of `procurement_admin | procurement_officer | foreman | field_technician | company_admin`.
- Indexes: `(po_id)`, `(company_id, project_id, status)`.
- Attach existing `set_updated_at()` BEFORE UPDATE trigger.

## 2. Server logic

**`src/lib/grn-rules.ts`** (pure, unit-testable)
- Zod schemas for GRN line, confirm payload (`qty_received >= 0` and `<= qty_ordered - previously_received`).
- `nextGrnNumber(existing: string[])` → `GRN-0001` sequence.
- `computePoStatusAfterGrn(poLines, allConfirmedGrnLines)` → returns `partially_received | received` (or unchanged).
- `deriveGrnStatus(lines)` → `has_defects` if any `condition !== 'ok'` or short-ship, else `confirmed`.

**`src/lib/grn.functions.ts`** (server fns w/ `requireSupabaseAuth`)
- `listGrns({ projectId?, poId?, status?, search? })` — server-filtered list joined with PO number + vendor name.
- `getGrn({ grnId })` — full row + PO lines + photo signed URLs.
- `getReceivableLinesForPo({ poId })` — PO lines with `qty_ordered - sum(previously_received)` remaining.
- `createDraftGrn({ poId })` — role-gated; requires PO status in `issued | partially_received`; returns id.
- `updateGrnDraft({ grnId, lines, notes, photos })` — validates qty ≤ remaining, sanitizes lot_ids.
- `confirmGrn({ grnId })`:
  - Re-validate against fresh PO totals (server-side over-receipt guard).
  - Generate `grn_number` via row lock on company sequence.
  - Set `received_by`, `received_at`, derived `status` + `defects_count`.
  - Update PO status via `computePoStatusAfterGrn`.
  - `writeAuditLog('grn.confirm', ...)` and additional `grn.defect` when defects present.
- `addGrnPhoto({ grnId, path })` / `removeGrnPhoto` — enforce path prefix `{company_id}/grn/{grn_id}/…` server-side before persisting to `photos` jsonb.

**Query hooks:** `src/lib/grn-query.ts` — `useGrnList`, `useGrn`, `useReceivableLines`, and mutations wired to `useServerFn` with sonner toasts + `queryClient.invalidateQueries` on PO detail keys.

## 3. UI

**`/procurement/receipts` (list)** — `src/routes/_authenticated/procurement.receipts.tsx` + `.index.tsx`
- Table: GRN #, PO # (link), project, status badge, defects count, received_at.
- Search, status filter, CSV export, skeleton, empty ("No goods receipts yet"), error+retry.
- "New receipt" CTA (opens PO picker if no `?po=`).

**`/procurement/receipts/new?po=<id>`** — `procurement.receipts.new.tsx`
- Loads receivable lines. Pre-fills a form line per open PO line with `qty_remaining`.
- Per-line inputs: `qty_received` (numeric, zod ≤ remaining), lot/serial IDs as chip input (`Enter` to add, optional camera button using `getUserMedia` + `BarcodeDetector` when available, graceful manual fallback), condition select (`ok | damaged | partial`), defect notes (textarea, required when condition ≠ ok).
- Photo capture panel: up to 10 photos → upload to `photos` bucket at `{company_id}/grn/{grn_id}/{uuid}.jpg` (creates draft GRN first so `{grn_id}` exists), thumbnails with remove.
- Sticky footer with "Save draft" and "Confirm receipt" actions; disabled while over-receipt errors exist.
- Mobile-first layout: single-column, large tap targets, bottom-anchored actions.

**`/procurement/receipts/$grnId`** — detail view for confirmed/draft GRNs; read-only after confirm; shows lot IDs, photos gallery (signed URLs), audit trail excerpt.

**Nav update:** add "Receipts" under Procurement in `AppShell`.

## 4. Storage

Reuse existing `photos` bucket. Server functions require path prefix `{company_id}/grn/{grn_id}/…` (matches storage RLS policy using `storage_company_id`). Signed URLs generated server-side for display.

## 5. Tests

- `tests/unit/grn-rules.test.ts` — `nextGrnNumber`, `computePoStatusAfterGrn` (partial → full lifecycle), `deriveGrnStatus` (defect + short-ship cases), zod over-receipt rejection.
- `tests/rls/grn.rls.test.ts` — stub asserting non-member is blocked and non-privileged roles cannot insert.

## Acceptance verification

- Receive full qty on line 1 + partial line 2 → PO flips `partially_received`; complete rest → `received`.
- Over-receive attempt blocked client + server.
- 3 lot IDs + 2 photos → thumbnails + paths under `{company}/grn/{grn_id}/…`.
- Damaged pallet defect → `has_defects`, `defects_count++`, `grn.defect` audited.
- Mobile viewport (390px): form usable, no horizontal scroll.

## Technical notes

- No changes to `po.functions.ts` PO transitions API — GRN confirm calls a small internal helper that updates PO status via `supabaseAdmin` inside a transaction after role check via `context.supabase`.
- All colors via semantic tokens; status badges use existing `Badge` variants map.
- `getUserMedia` behind capability check; SSR-safe (`useEffect`).
- Currency N/A on GRN; qty formatting via `Intl.NumberFormat` with PO's UoM label.
