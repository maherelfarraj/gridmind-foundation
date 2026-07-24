# P-047 — Proposal PDF export

Adds "Export PDF" to the proposal builder and proposals list. Uses `jspdf` + `jspdf-autotable` (already installed), pulls branding from `company_branding`, and audits every export. Gated by the shared `assertExportAllowed` helper (`src/lib/export-guard.ts` already exists with 42P01 fallback).

## 1. Server function — `getProposalPdfData`

Added to `src/lib/proposal.functions.ts` (reuses `attachSupabaseAuth` + `requireSupabaseAuth`, member-only read via RLS).

Input: `{ proposalId: uuid }`. Steps:
1. Load proposal (all columns) + line items ordered by `sort_order`.
2. Load opportunity via `proposal.opportunity_id`: `name, account_name, expected_decision_date`.
3. Load `companies` row (`name, legal_name, contact_email, phone, address`) for the caller's company.
4. Load `company_branding` (`logo_url, primary_color, accent_color, footer_text`).
5. Logo signed URL: `logo_url` in this schema stores either a full URL or a bucket object path. If it looks like a path (no `://`), call `supabase.storage.from('documents').createSignedUrl(logoPath, 300)` and return `logoSignedUrl`. On any error (missing file, bucket missing), return `logoSignedUrl: null` — never throw.
6. Return plain DTO: `{ proposal, lineItems, opportunity, company, branding: {primaryColor, accentColor, footerText, logoSignedUrl}, yieldResult }`. `margin_pct` is NOT included in the DTO (defence-in-depth so the client PDF can't leak it).

No audit here — audit fires on the export mutation (`recordProposalExport` below).

## 2. Audit-only server fn — `recordProposalExport`

Small POST fn: writes `writeAuditLog('proposal.export_pdf', 'proposal', proposalId, { opportunity_id, version })`. Called from the client after PDF generation succeeds so we don't audit failed exports.

(Rationale: PDF generation runs in the browser with jspdf; the server just supplies data + logs the event.)

## 3. Client PDF generator — `src/lib/exports/proposal-pdf.ts`

Pure function `buildProposalPdf(data): Promise<{ blob, filename }>` using `jspdf` + `autoTable`. Structure:

- **Helpers**:
  - `sanitize(text)`: collapse HTML-escape artifacts (`&amp;` → `&`, strip `&;`), used on every string drawn.
  - `hexToRgb(hex)`: parse `#rrggbb`; fallback to `#1e40af` when branding color is missing/invalid.
  - `fetchLogoDataUrl(url)`: `fetch(url)` → `blob()` → `FileReader` data URL; wrap in try/catch and return `null` on failure (skip logo gracefully).
  - `filenameOf(company, title, version)`: `GridMind_Proposal_<account>_<title>_v<version>.pdf` with `[^A-Za-z0-9_-]` → `_` and length cap.

- **Layout** (A4 portrait, 40pt margins):
  1. **Cover page** — logo top-left (48pt tall, aspect-preserved) or empty gutter; brand-color header band; proposal title (Space Grotesk-ish sans, jspdf built-in `helvetica bold`); "Prepared for: <account>"; date (`format(now, 'PP')`); "Valid until: …"; `v<version>` badge.
  2. **Executive summary** — archetype, capacity MW, P50 kWh/yr, P90 kWh/yr, specific yield kWh/kWp (from `yieldResult`; if absent render "—").
  3. **Scope & pricing** — `autoTable` with columns Category / Description / Qty / Unit / Unit price / Total; header row filled with branding `primary_color`. Below: subtotal, contingency (% + amount), **total** rows right-aligned. Explicitly no margin row.
  4. **Yield summary** — small table: Engine "gridmind-stub-v1 (placeholder)", P50, P90, specific yield, PR, monthly kWh (12 columns wrapping).
  5. **Terms** — validity (from `valid_until`), currency (`currency_code`), free-text `proposal.notes`.

- **Footer on every page** (autoTable `didDrawPage`): left = `company.legal_name ?? company.name`, right = `Page X of Y` using `doc.getNumberOfPages()` in a final pass.

- Return `{ blob: doc.output('blob'), filename }`.

## 4. UI wiring

### Proposal builder — add "Export PDF" button

`src/components/proposals/ProposalHeaderForm.tsx` already renders header actions in `proposals.$proposalId.tsx`. Add a new small component `src/components/proposals/ExportPdfButton.tsx`:

```
<Button variant="outline" onClick={run} disabled={pending}>
  {pending ? <Loader2 spin/> : <FileDown/>} Export PDF
</Button>
```

`run()`:
1. Fetch caller's `company_id` via the existing `getMyProfile`/context (we already have it on the proposal — `proposal.company_id`). No extra fetch.
2. Call new `getProposalPdfData({ proposalId })`.
3. Call `assertExportAllowed(supabase, { companyId: proposal.company_id, projectId: proposal.project_id })`. On thrown 409 or any lock error → `toast.error('Exports locked by governance')` and abort.
4. `buildProposalPdf(data)` → trigger download via existing `downloadCsv` pattern (create tiny `downloadBlob(filename, blob)` in `src/lib/exports/proposal-pdf.ts` — Blob URL + anchor click).
5. On success: `recordProposalExport({ proposalId })` then `toast.success('Proposal PDF exported')`.
6. Errors surface as `toast.error(err.message)`.

Mounted in the builder header action row (next to "New version" / "Refresh") — always visible (no role gating; members can export their own company's proposals since read is already RLS-gated).

### Proposals list — add row-level action

In `src/routes/_authenticated/proposals.index.tsx`, add a trailing "Actions" column with the same `ExportPdfButton` (compact `size="icon"` variant flag) per row. Same flow — passes `proposalId`, resolves data server-side.

## 5. Verification

- Typecheck (`bun run build:dev` / tsgo path used previously) — clean.
- Manual: open a proposal with line items + a yield run, click Export PDF → downloads `GridMind_Proposal_<account>_<title>_v<version>.pdf`.
- `psql -c "select action from audit_logs where entity='proposal' order by created_at desc limit 3"` → shows `proposal.export_pdf`.
- Grep generated code: no reference to `margin_pct` inside `proposal-pdf.ts` or the PDF data DTO.
- `project_export_locks` doesn't exist → export helper's 42P01 branch is exercised (already covered).

## Files

Created:
- `src/lib/exports/proposal-pdf.ts` — PDF builder + `downloadBlob` helper + filename sanitizer.
- `src/components/proposals/ExportPdfButton.tsx` — reusable button.

Modified:
- `src/lib/proposal.functions.ts` — `getProposalPdfData` + `recordProposalExport`.
- `src/lib/proposal-query.ts` — expose `useServerFn` wrappers if needed (thin).
- `src/routes/_authenticated/proposals.$proposalId.tsx` — mount button in header actions.
- `src/routes/_authenticated/proposals.index.tsx` — add Actions column with export button.

## Notes / assumptions

- `company_branding.logo_url` today stores a URL/path; both are handled (path → signed URL from `documents` bucket, URL → used directly, missing → skipped). No schema change.
- Fonts: jspdf ships helvetica; we don't embed Space Grotesk to avoid bundle weight — this matches the "branded but pragmatic" tone of P-029 exports.
- PDF is generated client-side; server function only assembles data + audits. Blob download is same-origin.
