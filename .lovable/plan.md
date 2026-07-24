## P-068 — Expediting Log

Delivery tracking workbench chasing PO items against site-need dates, with Stage-3 exit-gate KPI.

### 1. Database — migration `0030_expediting.sql`

Note: numbering as `0030_` since `0029_three_way_match.sql` already exists (spec's `0029_expediting.sql` collides).

- `expediting_status` enum via guarded `do` block: `on_track | at_risk | delayed | delivered`.
- `public.expediting_logs` per spec (company_id, po_id, project_id, po_line_no, item_description, is_long_lead, promised_delivery_date, delivery_window_start/end, site_need_date, current_eta, eta_confirmed, status, last_vendor_contact_at, notes, created_by, timestamps).
- GRANT to `authenticated` + service_role, then RLS + policies (`exp_select`, `exp_write` gated on `procurement_admin | procurement_officer | company_admin`).
- Indexes on `(company_id, project_id, status)` and `(po_id)`.
- Unique guard `(po_id, po_line_no)` where `po_line_no is not null` to prevent duplicate imports.
- Attach `set_updated_at()` trigger.

### 2. Server logic

**`src/lib/expediting-rules.ts`** (pure, tested)
- `deriveStatus({ current_eta, site_need_date, delivery_window_start/end, last_vendor_contact_at, fully_received })`:
  - `fully_received` → `delivered`
  - `current_eta > site_need_date` → `delayed`
  - ETA inside window AND `last_vendor_contact_at` > 14 days old → `at_risk`
  - else `on_track`
- `daysUntilNeed(site_need_date)` (UTC-safe).
- `computeLongLeadKpi(rows)` → `{ total, ready, pct, band: 'green'|'amber'|'destructive' }` (≥95 / 85–94 / <85).
- Zod schemas for create/update payloads.

**`src/lib/expediting.functions.ts`** (`createServerFn` + `requireSupabaseAuth`)
- `listExpediting({ projectId? })` — RLS-scoped select joined with PO number + project name.
- `importFromPo({ poId, longLeadLineNos[] })` — pulls open PO lines from `purchase_orders.lines`, upserts rows (skip existing `(po_id, po_line_no)`), marks selected lines long-lead, defaults `site_need_date` from PO `required_by_date` / line need date.
- `updateExpediting({ id, patch })` — updates ETA/eta_confirmed/notes/window/long-lead; recomputes status server-side by loading `goods_receipts` for the PO line to determine `fully_received`; writes audit log `expediting.update`.
- `logVendorContact({ id })` — stamps `last_vendor_contact_at = now()`, recomputes status, audits.
- `getLongLeadKpi({ projectId? })` — returns KPI numbers for the tile.
- All mutations require `procurement_admin | procurement_officer | company_admin` (verified via `context.supabase` role check); reads open to any company member (RLS handles).

### 3. UI — `/procurement/expediting`

Route file `src/routes/_authenticated/procurement.expediting.tsx` (add nav entry with `Truck` icon).

- **Header KPI strip**: Open items, Delayed count, and the long-lead exit-gate progress tile (green ≥95 / amber 85–94 / destructive <85) with tooltip "Procure → Plan exit gate".
- **Board/table hybrid** grouped by project (collapsible groups); rows show PO link, item, long-lead badge, promised date, delivery window, site-need date, ETA input (inline edit) with confirmed toggle, status badge, days-until-need countdown chip (color by sign/threshold), "Log contact" button.
- **"Add from PO" dialog**: pick a PO, list its open lines with checkbox for long-lead flag, submit → `importFromPo`.
- Optimistic mutations via TanStack Query with `sonner` toasts; skeleton, empty ("No items being expedited"), and error+retry states.
- **CSV export** client-side from current filtered rows.
- Semantic tokens only (status colors via existing badge variants; no raw hex).

### 4. Tests

- `tests/unit/expediting-rules.test.ts`: status derivation matrix (delivered wins, delayed vs at_risk, contact-age boundary at 14d), `daysUntilNeed`, KPI band thresholds (exact 95 / 94.9 / 85 / 84.9), import de-dup.

### 5. Acceptance checks

- Import from PO: no duplicates on re-import; long-lead flags persist.
- ETA past site-need → `delayed`; ETA in window with 15-day-old contact → `at_risk`.
- Full GRN on the linked line → `delivered` on next update/refresh.
- KPI tile color thresholds correct.
- `foreman` read-only (write blocked by role check); every mutation audited.

### Out of scope
- Automatic status recompute on GRN insert (handled lazily on read/update this iteration; a trigger can come later if needed).
- Push notifications for at-risk items.
