## P-069 — Vendor Scorecards (OTD / Quality / Responsiveness)

Auto-compute vendor performance from live PO/GRN/expediting data. Table `vendor_scorecards` already exists (P-061) with the exact columns and unique constraint we need — no migration required.

### Server layer

**`src/lib/scorecard-rules.ts`** (pure, unit-tested)
- Zod schemas: `recomputeSchema { periodStart, periodEnd, projectId? }`, `listSchema { periodStart, periodEnd }`.
- `computeOtdPct(grns, poDueMap)` → on-time GRNs ÷ confirmed GRNs × 100.
- `computeQuality(grns)` → 100 − (defective ÷ total × 100). Defective = `status='has_defects' || defects_count>0`.
- `computeResponsiveness(expLogs, now)` → 100 − 10 × (logs with `status='delayed'` OR `last_vendor_contact_at` older than 14d). Floor 0. Returns `null` when no expediting rows.
- `trend(current, prior)` → `{delta, direction: 'up'|'down'|'flat'}` for each metric.
- Status band: OTD ≥ 95 green, 80–94 amber, <80 destructive.

**`src/lib/scorecard.functions.ts`** (`requireSupabaseAuth`)
- `listScorecards({ periodStart, periodEnd })` — RLS-scoped rows for the period + prior-period rows keyed by `(vendor_id, project_id)` for trend.
- `getVendorHistory({ vendorId })` — all stored periods for chart + contributing PO/GRN summary for the current period.
- `recomputeScorecards({ periodStart, periodEnd, projectId? })` — role-gated (`procurement_admin`/`procurement_officer`/`company_admin` via `has_company_role`). Steps:
  1. Load POs (issued_at in period, optional project filter) with `required_by_date`, joined vendors.
  2. Load confirmed GRNs for those POs (`received_at` in period).
  3. Load expediting_logs for those POs in period.
  4. Group per `(vendor_id, project_id?)`, compute three metrics + counts.
  5. UPSERT into `vendor_scorecards` on `(vendor_id, project_id, period_start, period_end)` with `computed_at = now()`.
  6. `writeAuditLog('scorecard.recompute','vendor_scorecards', null, { period, vendor_count, project_id })`.
  - Returns `{ upsertedCount }`.

**`src/lib/scorecard-query.ts`** — `queryOptions` for list + history.

### UI

**`/procurement/scorecards`** (`src/routes/_authenticated/procurement.scorecards.tsx`)
- Header: period picker (trailing 90d default, presets 30/90/180/365d + custom range via existing `Popover` + `Calendar`), optional project filter, "Recompute" button (role-hidden via `useCurrentRoles`), CSV export.
- KPI strip: portfolio avg OTD, avg quality, count of vendors below 80% OTD.
- Table (design-token semantic classes): Vendor · OTD % · Quality · Responsiveness (or "Insufficient data") · POs · Defects · Trend chips vs prior period · status badge. Sortable by OTD.
- Row click → `VendorScorecardDrawer` with Recharts `LineChart` of three metrics across stored periods and a contributing-list panel (recent GRNs with received_at vs required_by, defective flag; recent POs).
- Skeleton, empty-state copy: "No scorecard data — receipts will populate scores automatically."; error state with retry; sonner toasts.

**Components**
- `src/components/procurement/scorecard-status-badge.tsx`
- `src/components/procurement/vendor-scorecard-drawer.tsx`
- `src/components/procurement/trend-chip.tsx`

**Nav** — `src/lib/nav-map.ts` add "Scorecards" under Procurement (icon `Gauge`).

### Tests

`tests/unit/scorecard-rules.test.ts`:
- OTD math with mixed on-time/late GRNs, no receipts → null.
- Quality: defects_count>0 and status='has_defects' both count; all clean = 100.
- Responsiveness: stale contact and delayed status penalty, floor at 0, empty logs → null.
- Trend direction: up/down/flat, no prior → null.
- Status band thresholds at 79.99, 80, 94.99, 95.

### Acceptance checklist
- Upsert idempotent on repeat recompute (unique constraint enforces it).
- OTD math verifiable against `received_at` vs `required_by_date`.
- P-066 defect flows through to quality; P-068 stale contact/delayed → responsiveness penalty.
- Trend column + per-vendor history chart.
- `scorecard.recompute` audited; recompute button hidden/blocked for non-procurement roles; empty state clean.

### Out of scope
- No schema change (table already exists).
- No changes to P-063 award logic (feedback loop noted, not wired).
- Vendor drawer uses live query for contributing GRNs/POs; not stored snapshots.