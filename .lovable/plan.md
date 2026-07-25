## P-097 — MC + COD certificates with signature capture

### 1. Migration (via migration tool, timestamped filename)

Runs the spec SQL verbatim: `commissioning_certificate_type` enum (`mechanical_completion`, `cod`, `ccc_transfer`), `commissioning_certificates` table with tenant columns, `unique(project_id, certificate_type)` and `unique(company_id, certificate_number)`, `signatures jsonb[]`, `payload jsonb`, `signed_pdf_path`. RLS: `SELECT` via `is_company_member`; writes gated by `construction_admin` / `project_admin` / `company_admin`. GRANT `select, insert, update` to authenticated. Index on `(company_id, project_id, certificate_type)`. `set_updated_at()` trigger. Idempotent (`if not exists`, `do $$` enum guard, `drop policy if exists`).

Note: the spec filename `0045_commissioning_certificates.sql` collides with the already-applied `0045_commissioning_core.sql`; Lovable Cloud stores migrations as timestamped files, so the on-disk name will be the next timestamped file. Content is unchanged.

### 2. Server logic — `src/lib/commissioning-certificates.rules.ts`

Pure helpers, unit-tested:
- `REQUIRED_PARTIES` — MC: `['contractor','client']`; COD: `['contractor','client','utility']`.
- `missingCertParties(type, signatures)` → `SignoffParty[]`.
- `allSigned(type, signatures)` → boolean.
- `suggestCertNumber(type, existingNumbers)` — `MC-0001` / `COD-0001` (zero-padded, per company).
- `isPassingPr(measured, contract)` — `measured >= contract`.

### 3. Server functions — `src/lib/commissioning-certificates.functions.ts`

All use `attachSupabaseAuth` + `requireSupabaseAuth`. Every mutation writes `writeAuditLog` and returns typed DTOs.

- `listCertificates({ projectId })` — rows for MC + COD + (future) CCC; returns `{ rows, permissions: { canIssue, canSign }, companyBranding }`.
- `issueCertificate({ projectId, type, effectiveDate, scopeNotes, certificateNumber })` — insert with `status='pending_signatures'`, `payload.scope_notes`, `created_by=userId`. Audit `certificate.issued`.
- `addSignature({ certificateId, party, name, title, filePath })` — reads current row, validates party is required for the type and not already signed, appends `{party,name,title,signed_at,file_path}` to `signatures`. If `allSigned`:
  - **COD guards** (throw `statusCode: 409` before flipping): call `assertNoOpenCategoryAPunch({projectId})` (409 with item refs); query `performance_tests` for `project_id=X and test_type='performance_ratio' and status='complete'` and require at least one where `measured_value >= contract_value` (409 `no_passing_pr_test` with tests summary); snapshot `payload.punch_summary` (open A/B/C counts at signing) and `pr_at_cod = max(measured_value)`.
  - Update row to `status='signed'` and (COD only) generate branded PDF via a shared helper `renderCertificatePdf` (jspdf, ampersand-safe "O&M"), upload to `closeout/{company_id}/certificates/{project_id}/{cert_id}.pdf`, set `signed_pdf_path`.
  - COD only: look up the `project_phase_gates` row where `project_id=X and phase='cod'`; call `requestGateTransition({ gate_id })` (reuses P-040 engine). Wrap in try/catch — if the gate is not in `open` state (409 `gate_not_open`), surface the message but keep the certificate signed.
  - Audit `certificate.signed`.

### 4. Certificate PDF — `src/lib/exports/certificate-pdf.ts`

`renderCertificatePdf({ type, project, company, branding, certificate, signatures })` → `Uint8Array`. Reuses `sanitize()` from `pr-test-report-pdf.ts` for "O&M" safety. Layout: header with logo (from `company_branding.logo_url` signed URL), title (MECHANICAL COMPLETION / COMMERCIAL OPERATION), certificate number, effective date, project name, scope notes, punch snapshot table (COD), PR-at-COD line (COD), signatures grid with rendered signature PNGs referenced by `file_path` (fetched to data URLs client-side, then passed as arg). PDF generated client-side after `addSignature` reports the final state; upload via `supabase.storage` and posted back with a lightweight `attachSignedPdf({ certificateId, filePath })` server fn.

### 5. UI route — `src/routes/_authenticated/projects.$projectId.commissioning.certificates.tsx`

- Header + "Back to tests" link. Header link added on the commissioning board.
- Layout: forward-compatible cards grid (MC, COD, and a disabled placeholder for CCC "Available in P-099"). Each card:
  - Empty state: "No certificate issued yet" + "Issue" button (requires `canIssue`).
  - Pending: metadata, required parties list with ✓/• per signature, "Sign as …" button per remaining party.
  - Signed: badge, effective date, signed PDF download link (COD).
- **Issue dialog** (react-hook-form + zod): effective date, scope notes, auto-suggested number (editable). On submit → `issueCertificate` → invalidate.
- **Signature dialog**: canvas signature pad (custom lightweight component in `src/components/signature-pad.tsx`, pointer events → PNG data URL) + signer name + title + party select (restricted to remaining required parties). On confirm: upload PNG to `closeout/{company_id}/certificates/{project_id}/signatures/{cert_id}-{party}.png`, call `addSignature`. If server response indicates `allSigned` for COD, render+upload the PDF, then call `attachSignedPdf`.
- Error surfaces (sonner toasts): 409 `open_category_a_punch` → "COD blocked — N category A items open" + link to punch board; 409 `no_passing_pr_test` → "COD requires a passing PR test" + link to performance tests; 409 `gate_not_open` → certificate signed, but a note that the phase-gate could not be requested (opened later from the phase-gate UI).
- States: skeleton, empty, error with retry.
- Read roles enforced by RLS (`om_admin`, `company_admin`, `client_viewer` see rows via `is_company_member`); write actions hidden when `canIssue`/`canSign` false.

### 6. Tests — `tests/unit/`

- `certificates.rules.test.ts` — required parties per type; `missingCertParties`; `allSigned` transitions; `suggestCertNumber` collision handling; `isPassingPr` edge cases (equal, missing values).
- `certificate-pdf.test.ts` — smoke test asserting header text and "O&M" (not "O&amp;M") in output bytes.

### Verification checklist

- Migration applies twice (idempotent enum + `if not exists`).
- Unique constraint blocks a second MC or COD per project.
- MC: 2 canvas PNGs land in `closeout/{company}/certificates/{project}/signatures/…`; row flips to `signed`.
- COD with open category A → 409; close A, no passing PR → 409; add passing PR → COD signs, `pr_at_cod` snapshot present, punch summary in `payload`.
- Signed COD triggers `requestGateTransition` → `project_phase_gates.status='in_review'`, approval instance + approvers rows created.
- Branded PDF at `signed_pdf_path`; "O&M" renders literally.
- `certificate.issued` and `certificate.signed` audit rows written.

### Technical notes

- `assertNoOpenCategoryAPunch` returns `{ ok: true }` or throws `statusCode: 409` with `{ open_count, item_refs }` — we call it via the existing exported server fn (invoked server-to-server through direct helper import, not through the RPC stub, to preserve the 409 body). We'll refactor the assertion body into a shared function `assertNoOpenCategoryAPunchImpl(context, projectId)` in `commissioning-punch.functions.ts` and reuse it here.
- `requestGateTransition` requires the caller be `company_admin` or `project_admin`. The COD workflow already targets those roles as writers, so the caller who signs COD generally holds the role. When they don't, catch the 403 and surface it as a soft warning ("certificate signed; ask a project admin to submit the gate").
- No new storage bucket. `closeout` policy already requires company UUID as first path segment.
- No changes to auto-gen files.
