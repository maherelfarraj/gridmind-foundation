# P-092 — Weekly Client Report PDF

Branded weekly construction report built client-side with jspdf, data aggregated in one authenticated server fn. Reuses existing patterns: `assertExportAllowed` (export-guard.ts), branding fetch + `sanitize()` from `po-pdf.ts`, `writeAuditLog`.

## Files to create

**`src/lib/field-reports.functions.ts`** — `getWeeklyReportData` server fn.
- `createServerFn({ method: 'POST' })` + `.middleware([requireSupabaseAuth])` + zod input `{ projectId: uuid, weekStart: iso date (must be Monday) }`.
- Computes `weekEnd = weekStart + 6d` (date-fns `endOfISOWeek`), guards project belongs to caller's company via `context.supabase.from('projects')`.
- Parallel queries (all through `context.supabase`, RLS enforced):
  - project (name, archetype/type, capacity_mw)
  - `construction_daily_reports` in week + nested `manpower_logs`
  - `weather_delays` in week (sum `lost_hours` by `delay_type`)
  - `wbs_items` + planned qty joined with installed rollup from DPR quantity lines (reuse discipline-board logic if extractable; otherwise inline aggregate per discipline/area)
  - daily install rate = installed qty grouped by discipline / distinct reporting days in week
  - latest `evm_snapshots` for project → SPI, CPI
  - HSE: `hse_incidents` in week grouped by `incident_type`, count where `osha_recordable`; TRIR trailing 12 months (recordables × 200000 / total manpower hours). Return `null` when hours=0.
  - QA: `qaqc_inspections` in week (pass rate, rework %), `qaqc_punch_items` open grouped by category A/B/C
  - `site_photos` in week, take up to 6, create signed URLs (`storage.from('photos').createSignedUrl`, 15 min)
  - Next-week lookahead: top 3 open `weather_delays` impacts + planned area names from `schedule_tasks` starting in following week
  - `company_branding` row; if `logo_url` is a storage path, create signed URL from `documents` bucket (match `po-pdf` pattern).
- Returns plain DTO (no Response). No admin client.

**`src/lib/exports/weekly-report-pdf.ts`** — pure builder `buildWeeklyReportPdf(input): jsPDF`.
- Mirrors `po-pdf.ts` shape: `sanitize()` helper (reused inline), `fetchLogoDataUrl` (copy from po-pdf), `hexToRgb`, `DEFAULT_PRIMARY`.
- Layout (A4 portrait, 40pt margins):
  1. Header band in `primaryColor` (~90pt tall) with logo top-left, title "Weekly Construction Report — {project} {YYYY}-W{ww}" and subtitle date range.
  2. KPI row: SPI, CPI, TRIR (12mo), Rework % — 4 boxes.
  3. Daily log table (autoTable): date, shift, manpower, hours, weather notes.
  4. Discipline/area table: discipline, area, planned, installed, %, daily rate.
  5. Weather delays summary (type → hours).
  6. HSE summary block: new incidents by type, recordables count, TRIR sentence.
  7. QA summary: inspections run, pass %, rework %, open punch A/B/C.
  8. Photo strip: up to 6 signed-URL images in 2 rows of 3, skip on load failure.
  9. Next-week lookahead bullet list.
  10. Footer on every page: `company_branding.footer_text` + `Page X of Y` (jspdf `getNumberOfPages`).
- All user text piped through `sanitize()` so "O&M" / "C&I" render correctly.
- Filename convention: `weekly-report_{projectSlug}_{YYYY}-W{ww}.pdf`.

**`src/routes/_authenticated/field.reports.tsx`** — new route.
- Project select (uses existing projects query options), ISO week picker (date-fns `startOfISOWeek(subWeeks(now,1))` default).
- Left panel: live preview cards showing counts (DPRs, manpower total, incidents, inspections, photos) — driven by `useQuery(getWeeklyReportData)` with skeleton/empty/error states. Empty when zero DPRs: message "No field data for this week — submit DPRs first" and disable export.
- Right: "Export weekly report PDF" button (spinner while generating) — role-gated via `useHasCompanyRole(['construction_admin','project_admin','company_admin'])` (check existing hook name; else inline check against session roles).
- Handler: calls server fn → `buildWeeklyReportPdf` → `doc.save(filename)` → sonner success toast → separate `logWeeklyReportExport` server fn that runs `assertExportAllowed` + `writeAuditLog('field.weekly_report_export','projects', projectId, {week_start, week_end})`. Locked → sonner error "Exports locked by governance" and abort.

Alt: guard runs inside `getWeeklyReportData` handler so users can't even preview locked data. Chosen approach: run guard in a dedicated `assertWeeklyReportExport` server fn called just before PDF generation (preview stays available; audit only on actual export), matching the ask ("call shared helper … before generating").

**`src/components/field/ExportWeeklyReportButton.tsx`** — reusable button used by both `/field/reports` and `/field/dpr` header. Takes `projectId`, `weekStart`, gated by role, handles fetch → build → save → guard/audit.

## Files to edit

- `src/routes/_authenticated/field.dpr.index.tsx` — inject the button in header (defaults to last completed week; if a project filter is active use it, otherwise disable with tooltip "Pick a project").
- `src/lib/nav-map.ts` — add `field.reports` entry.
- `src/lib/query-options.ts` (or wherever field query keys live) — add `weeklyReport(projectId, weekStart)` key.

## Verification

- `tsgo --noEmit` clean.
- Manual: pick prior week with data → PDF opens with logo, KPIs, tables, photos, footer pagination; filename correct.
- Zero-DPR week → button disabled, empty state shown, no PDF.
- Simulate lock: insert row in `project_export_locks` (if table exists) → toast + abort. Table missing → export proceeds (42P01 caught in `assertExportAllowed`).
- Audit log row appears with action `field.weekly_report_export`.
