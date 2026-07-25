## P-098 — Turnover / As-built Pack

### Migration `supabase/migrations/0046_turnover_packages.sql`
Idempotent SQL exactly as specified: `turnover_packages` (unique `project_id`) + defensive `export_packages` (no prior owning migration), RLS enabled, SELECT via `is_company_member`, writes gated by `construction_admin`/`project_admin`/`company_admin`, GRANTs to `authenticated` (+ `service_role`), `set_updated_at()` trigger, project index. `drop policy if exists` before each `create policy` for repeat-run safety.

### `src/lib/turnover.rules.ts`
- `TURNOVER_SECTIONS` — ordered list: `as_builts`, `warranties`, `om_manual`, `test_reports`, `certificates` (all `required: true`, labels use plain ampersand "O&M").
- `computeSectionsComplete(sections)` → boolean.
- Zod schemas for compile/deliver payloads.

### `src/lib/turnover.functions.ts` (thin — helpers imported from `.server.ts` to satisfy tss-serverfn-split)
- `getTurnoverPack({ project_id })` — returns row + branding + `permissions.canWrite`.
- `compileTurnoverPackage({ project_id })` — `requireSupabaseAuth`, role check, then:
  - **As-builts**: query `drawing_revisions` joined to `drawing_register` for latest per drawing where revision flagged as-built/IFC; copy each file inside `documents`/`drawings` bucket into `closeout/{company_id}/turnover/{project_id}/as-built/` via storage `copy`; record `{label, file_path, source:'drawing_register', revision, document_date}`.
  - **Warranties**: `documents` with `category='warranty'` for the project + any items already present in existing pack row (manual uploads persist).
  - **O&M manual**: manual uploads only (persisted items retained).
  - **Test reports**: `commissioning_tests.witness_file_path` where present + `performance_tests.report_file_path` where set.
  - **Certificates**: `commissioning_certificates` where status='signed' → `signed_pdf_path`.
  - Upsert row; each section `complete = items.length >= 1`; when all required complete → `status='ready'`, `compiled_at=now()`, `compiled_by=userId`, render branded PDF index and set `index_pdf_path`, insert `export_packages` row (`package_type='turnover_pack'`).
  - `writeAuditLog('turnover.compiled', ..., { status, sections_complete })`.
- `addTurnoverItems({ project_id, section_key, items })` — allow manual uploads to `om_manual`/`warranties`; merges into `sections`.
- `markTurnoverDelivered({ project_id, accepted_by? })` — requires `status in ('ready','delivered')`; sets `delivered_at`, optional `accepted_by/accepted_at`; audit `turnover.delivered`.

### `src/lib/turnover.server.ts`
Section definitions, storage-copy helper, DB queries for each section source, and the PDF-index builder invocation wrapper.

### `src/lib/exports/turnover-index-pdf.ts`
`jspdf` + `jspdf-autotable` branded index: header (logo, primary/accent bands, project name), section headings, autoTable columns `Document | Source | Revision | Date`. `sanitize()` from existing helper (normalizes `&amp;` → `&`) applied to every string so "O&M" renders literally — no "O&M;" artifact.

### `src/routes/_authenticated/projects.$projectId.commissioning.turnover.tsx`
- Section checklist cards (5 sections, tick + count + required badge).
- Compile button (role-gated) — disabled while `status='compiling'` and a compile is in-flight; toast on 409 with missing sections.
- Upload dialogs for `om_manual` (multi-file) and `warranties` (multi-file) → upload to `closeout/{company}/turnover/{project}/{section}/…` then `addTurnoverItems`.
- When `status='ready'|'delivered'|'accepted'`: "Download index PDF" (signed URL) + "Mark delivered" dialog (optional `accepted_by`).
- **client_viewer branch**: if role is `client_viewer`, render only the index-PDF download when `status in ('delivered','accepted')`; otherwise empty state "Turnover pack not delivered yet".
- States: skeleton, empty ("Turnover pack not compiled yet"), error with retry.

### Header link
Add "Turnover pack" `Link` in `src/routes/_authenticated/projects.$projectId.commissioning.tsx` next to Certificates.

### Tests
- `tests/unit/turnover.rules.test.ts` — section completion transitions, missing-required detection, ampersand preservation in labels.
- `tests/unit/turnover-index-pdf.test.ts` — smoke render + asserts PDF byte stream contains literal `O&M` and no `O&amp;M` / `O&M;`.

### Governance checks satisfied
- Unique `project_id` (one pack per project) — enforced by migration.
- Status transitions gated server-side (`compiling → ready` only when all required complete; `ready → delivered` requires ready pack).
- All mutations audited; `client_viewer` read is delivered-only (server + UI).
