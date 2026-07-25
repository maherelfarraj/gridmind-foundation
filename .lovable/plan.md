## P-110 — Monthly O&M Report PDF

### Migration `supabase/migrations/0051_om_reports.sql`
- Guarded enums: `om_report_type` (monthly/quarterly/annual), `om_report_status` (draft/generated/sent).
- Table `om_reports` per spec (unique `project_id, report_type, period_start`).
- RLS enabled: `is_company_member` SELECT; writes gated by `om_admin`/`company_admin`.
- GRANTs to `authenticated`; `set_updated_at()` trigger; index `(company_id, period_start desc)`.

### Server logic — `src/lib/om-reports.functions.ts` + `.server.ts` + `.rules.ts`
`generateOmReport({ projectId, periodStart, periodEnd })` with `requireSupabaseAuth`:
1. `assertExportAllowed` (graceful 42P01 fallback).
2. Aggregate `data` jsonb — five sections:
   - **availability**: `1 − downtime_hours / period_hours`, downtime = critical `scada_alarms` open-window + corrective `work_orders` labor hours.
   - **performance_ratio**: energy from `scada_telemetry` vs irradiance-expected; null-safe "insufficient data".
   - **alarms**: counts by severity, top 5 recurring rules, mean acknowledge time.
   - **work_orders**: opened/closed, MTTR hours, PM:CM ratio.
   - **spend**: Σ `work_orders.total_cost` grouped by type, currency-formatted via `Intl`.
3. UPSERT `om_reports` on `(project_id, report_type, period_start)` → `status='generated'`, `generated_at`, `generated_by`.
4. Render PDF (see below), upload to `documents` bucket at `{company_id}/om-reports/{project_id}/{YYYY-MM}.pdf`; save `pdf_path`.
5. Best-effort `insert into export_packages` — swallow `42P01`.
6. `writeAuditLog('om_report.generate', ...)`.
7. TODO comment: `// TODO(B12/P-117): register with scheduled_reports for monthly email delivery`.

List/query fn `listOmReports({ projectId? })` for the UI; `getOmReportDownloadUrl({ id })` returns a signed URL.

### PDF — `src/lib/exports/om-report-pdf.ts`
- Reuse P-047 (`certificate-pdf.ts` / `weekly-report-pdf.ts`) branding pattern.
- Fetch `company_branding` (logo signed URL → data URL, skip on error); `primary_color` header band + `autoTable` header fill.
- Sections mirror `data` jsonb; use `jspdf-autotable` for alarms/WO/spend tables.
- Footer: company legal name + "Page X of Y".
- Filename: `GridMind_OM_Report_<project-slug>_<YYYY-MM>.pdf`.
- Text sanitizer: render `"O&M"` as plain ampersand — assert no `&;` artifacts.

### UI — `src/routes/_authenticated/om.reports.tsx`
- Table: period, type, status badge, `generated_at`, Download button (signed URL).
- "Generate monthly report" dialog: project select + month picker (default = last month); spinner during generation; `sonner` toast on result.
- Skeleton/empty/error states; nav entry added to `src/lib/nav-map.ts` under O&M.

### Tests — `tests/unit/om-reports.test.ts`
- Availability math (downtime clamp, zero-period guard).
- PR "insufficient data" branch.
- Spend currency formatting; PM:CM ratio + MTTR calc.
- Filename + O&M sanitizer.

### Verification
- Migration applied; typecheck + unit tests green.
- Generate for a project → row upserted, PDF at expected path, five sections in `data` jsonb.
- Re-run same period → single row (upsert).
- Audit log written; `export_packages` insert (or graceful skip).
