# P-095 — PR test workspace, comparison, PDF report

Adds the performance-ratio workflow at `/projects/$projectId/commissioning/performance`: list existing PR tests, create a new one with server-computed PR, compare vs contract PR, and generate a branded PDF report saved to the `closeout` bucket with a `documents` row.

## Schema discoveries + one small migration

Verified against live schema:
- `performance_tests` already has: `test_type, status, contract_value, measured_value, unit, period_start, period_end, metered_energy_mwh, plane_of_array_kwh_m2, results jsonb, report_file_path, notes`. Capacity has no column — it goes into `results.capacity_mwp` (as the spec says).
- `project_pv_config.dc_capacity_mwp` — capacity prefill source.
- `project_yield_config` does NOT currently have a `contract_pr` column. Add one small migration:
  ```
  0046_yield_contract_pr.sql
  alter table public.project_yield_config
    add column if not exists contract_pr numeric(6,3);
  comment on column public.project_yield_config.contract_pr is 'Contracted PR (percent, 0–100)';
  ```
  No new RLS/grants — existing table policies cover it.

## Formula (STC-normalized PR)

Server-only:
```
pr_percent = metered_energy_mwh / (plane_of_array_kwh_m2 × capacity_mwp) × 100
```
Dimensionally: `MWh / (kWh/m² · MWp)` — the MWh/MWp cancels to hours, divided by kWh/m² and implicitly normalised by G_STC = 1 kW/m², giving a dimensionless ratio (× 100 for percent). This matches the user's `metered_kwh × 1000 / (POA × capacity_kWp × 1000)` phrasing when both `×1000` factors cancel.

Sanity fixture (documented + used in unit test):
- Metered = 25,000 MWh; POA = 178.5 kWh/m² (30-day month); capacity = 175 MWp → `25000 / (178.5 × 175) × 100 ≈ 80.03%` ✓
- The spec's earlier fixture (9,850 MWh) yields ~31.5%, which is physically low; the plan uses the realistic 25,000 MWh fixture so a passing test proves STC normalisation is right (result lands in 70–90%, not 3 or 300).

Zod input rules: `metered_energy_mwh > 0`, `plane_of_array_kwh_m2 > 0`, `capacity_mwp > 0`, `contract_value` 0–100 with 3-decimal precision, `tolerance ≥ 0` (default 1.0 PR points), `period_end > period_start`. `client_id` idempotency key.

Verdict: `passed` iff `measured_pr ≥ contract_pr − tolerance`.

## Backend — `src/lib/performance-tests.functions.ts` (new)

All server fns use `createServerFn` + `.middleware([attachSupabaseAuth])` + `.inputValidator(zod)`; every mutation writes `writeAuditLog`.

- `computePerformanceRatio(inputs)` — **pure** exported helper (used by handler and unit tests).
- `listPerformanceTests({ projectId })` → RLS-scoped list ordered by `period_end desc`.
- `getPerformanceTestDefaults({ projectId })` → returns `{ capacity_mwp, contract_pr }` from `project_pv_config.dc_capacity_mwp` and `project_yield_config.contract_pr`.
- `completePerformanceTest({ projectId, period_start, period_end, metered_energy_mwh, plane_of_array_kwh_m2, capacity_mwp, contract_value, tolerance, notes?, daily?[], clientIdempotencyKey })`:
  - Role gate: `engineer | construction_admin | project_admin`.
  - Server computes `measured_pr`; ignores any client-sent `measured_value`.
  - Inserts row with `test_type='pr'`, `status='complete'`, `unit='%'`, `measured_value=measured_pr`, `contract_value`, and `results = { capacity_mwp, formula_inputs, formula: 'metered_MWh / (POA_kWh_m2 × capacity_MWp) × 100', delta_vs_contract, tolerance, verdict, daily? }`.
  - `writeAuditLog('commissioning.pr_test_completed', 'performance_tests', id, { contract_pr, measured_pr, verdict })`.
- `generatePrTestReport({ testId, reportBase64, fileName, clientIdempotencyKey })`:
  - Role gate as above; loads the test (RLS), uploads PDF to `closeout/{company_id}/pr-reports/{project_id}/{uuid}-{safeName}.pdf` via `supabaseAdmin` (server upload, mirrors DPR/witness pattern), inserts `documents` row (`category='commissioning'`, `tags=['pr_test']`, metadata `{ test_id, verdict, measured_pr, contract_pr }`), updates `performance_tests.report_file_path`.
  - `writeAuditLog('commissioning.pr_report_generated', 'performance_tests', id, { path })`.

PDF is built **client-side** with jspdf + jspdf-autotable, then sent as base64 to the server so upload + `documents` row + audit stay atomic under the service role.

## Frontend

### `src/routes/_authenticated/projects.$projectId.commissioning.performance.tsx` (new)

- Loader-less shell; two `useQuery` calls: list + defaults. Route `head()` unique title/description/OG (per project SEO rule).
- **List panel**: server-filtered table (period, test_type, contract vs measured, verdict badge — `bg-primary/15 text-primary` pass, `bg-destructive/15 text-destructive` fail, `bg-secondary` pending). Skeleton, empty state ("No performance tests yet"), error banner + retry via `router.invalidate()`.
- **New PR test form** (react-hook-form + zod, shared schema with server via `src/lib/performance-tests.schema.ts`):
  - Fields: `period_start`, `period_end`, `metered_energy_mwh`, `plane_of_array_kwh_m2`, `capacity_mwp` (prefilled from defaults), `contract_value` (prefilled from `contract_pr` if present; otherwise manual 0–100 with 3 decimals), `tolerance` (default 1.0), `notes`.
  - Optional "Daily rows" collapsible: paste CSV `date, energy_mwh, poa_kwh_m2` → parsed to `daily[]` and previewed in a Recharts bar chart of computed daily PR.
  - Sticky mobile save bar.
- **Comparison panel** (post-submit / on row select): two large tiles (Contract PR, Measured PR), delta with pass/fail badge, Recharts `BarChart` of `results.daily` daily PR when present.
- **"Generate PR test report"** button on a completed test:
  - Loads `company_branding` via a small server fn `getCompanyBranding()`; builds branded PDF (jspdf + `autoTable`) with logo (embedded as dataURL if present), primary/accent colors from branding, sections: project header, test period, inputs table, formula block, measured vs contract with verdict, weather/notes, signature block.
  - **Ampersand safety**: pass literal strings straight to `doc.text(...)` (jspdf writes text via canvas, no HTML), so "O&M" stays "O&M". Explicitly test the fixture string `"O&M team"` in a jspdf smoke unit test that scans the produced PDF text for `O&amp;`/`O&amp;;` and fails if found. No `dangerouslySetInnerHTML`, no HTML template.
  - Sends base64 to `generatePrTestReport`. Success toast + link to open the file via signed URL.
- Sonner toasts on all mutations. Semantic tokens only.

### Nav wiring

- Add link "Performance" tab under the project Commissioning subnav (`src/lib/nav-map.ts` + commissioning layout).

## Storage / policies

- `closeout` bucket policies already allow `is_company_member` + `storage_company_id(name)`; new path `closeout/{company_id}/pr-reports/{project_id}/…` is covered — no policy migration.

## Tests

- `tests/unit/performance-ratio.test.ts`:
  - 25,000 MWh / 178.5 / 175 MWp → 80.03% (plausibility guard: expects value ∈ [70, 90]).
  - 22,743 MWh / 180 / 175 → ~72.2%.
  - Rejects `POA=0`, negative capacity, `period_end ≤ period_start` (schema tests).
  - Verdict pass/fail with tolerance boundary at exactly `contract − tolerance`.
- `tests/unit/pr-report-pdf.test.ts`: builds a PDF with the strings `"O&M team"` and `"Fault & clearance"`, extracts text via `pdf.internal.getFontList()` + `doc.output('arraybuffer')` → `pdf-parse` (dev-only) or a simpler regex over `doc.output('datauristring')` decoded stream; asserts neither `&amp;` nor `&amp;;` appears.

## Files

New:
- `supabase/migrations/0046_yield_contract_pr.sql`
- `src/lib/performance-tests.schema.ts`
- `src/lib/performance-tests.functions.ts`
- `src/lib/exports/pr-test-report-pdf.ts`
- `src/routes/_authenticated/projects.$projectId.commissioning.performance.tsx`
- `tests/unit/performance-ratio.test.ts`
- `tests/unit/pr-report-pdf.test.ts`

Edited:
- `src/lib/nav-map.ts` — add Performance sub-nav under Commissioning.
- `src/routes/_authenticated/projects.$projectId.commissioning.tsx` — tab link to Performance.
- `src/lib/offline/dispatch.ts` — register `performance:complete` dispatcher for offline capture (report generation stays online-only because it needs storage upload).

## Verification checklist

- [ ] Realistic fixture (25,000 MWh / 178.5 / 175 MWp) → 80.03%; unit test guards 70–90% plausibility band.
- [ ] Contract PR prefills from `project_yield_config.contract_pr`; when absent, manual input is required.
- [ ] Client-submitted `measured_value` is discarded — server always recomputes.
- [ ] Report lands in `closeout/{company_id}/pr-reports/{project_id}/…`; `documents` row inserted with `category='commissioning'`, tag `pr_test`; `report_file_path` updated.
- [ ] "O&M" renders literally in the PDF; unit test forbids `&amp;`.
- [ ] Roles enforced server-side; cross-tenant `testId` → not-found.
