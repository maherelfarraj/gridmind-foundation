## P-048 — Proposal PPTX export (pptxgenjs, branded)

Add a branded `.pptx` export next to the existing PDF button, reusing the same server-side data fetch, export-lock gate, and audit conventions from P-047.

### 1. Server function — rename + extend

In `src/lib/proposal.functions.ts`:

- Rename `getProposalPdfData` → `getProposalExportData` (single data fetcher shared by both formats).
- Extend the return payload to include what PPTX needs but PDF didn't:
  - `branding.fontFamily` (from `company_branding.font_family` if present; fallback `"Arial"`).
  - `salesOwner`: `{ full_name, email }` — look up `profiles` for `proposal.owner_id` (or `opportunity.owner_id` fallback); tolerate missing.
  - `tenderEvents`: upcoming `tender_events` rows for `opportunity_id` (`event_type`, `event_at`, `notes`), ordered by `event_at asc`, filtered to `event_at >= now()`; on `42P01` return `[]`.
  - Keep the `margin_pct` strip (defence-in-depth).
- Keep existing PDF field shape intact (add fields, don't remove).
- Update `ExportPdfButton.tsx` import to the new name (`getProposalExportData`). No behaviour change for the PDF path.

Extend `recordProposalExport` to accept `{ proposalId, format: "pdf" | "pptx" }` (default `"pdf"` for back-compat) and write `p_action` = `proposal.export_pdf` or `proposal.export_pptx` accordingly. Metadata unchanged: `{ opportunity_id, version }`.

### 2. PPTX generator — `src/lib/exports/proposal-pptx.ts`

New client-only module using `pptxgenjs`. Exports `buildProposalPptx(data)` → `{ blob, filename }` plus reuses `downloadBlob` from the PDF module (or re-exports it).

- **Layout**: `LAYOUT_WIDE` (16:9, 13.333 × 7.5 in).
- **Master slide** `GM_MASTER`:
  - Top title bar rectangle filled with `branding.primaryColor` (fallback `#0F172A`), height ~0.6 in.
  - Logo placed top-right, fetched via `fetch(logoSignedUrl)` → base64 data URL (skip on failure).
  - Footer: left = `company.legal_name ?? company.name`, right = slide number via `{ text: "Slide", options: { ... } }` + pptxgenjs slide-number placeholder.
  - Default font: `branding.fontFamily || "Arial"`.
- **Colour helpers**: normalize hex (strip `#`), guard invalid values.
- **XML safety**: helper `clean(str)` that trims and passes plain text (pptxgenjs escapes for XML itself — verify by grepping the output blob in dev; explicitly do NOT pre-encode `&amp;` so "O&M"/"C&I" stay clean).

**Slides** (7):
1. **Title** — proposal title, "Prepared for {account_name}", today's date, `Valid until {valid_until}`, `v{version}`.
2. **About us** — `company.about` / branding blurb (fallback: legal name) + contact block (email, phone, address).
3. **Solution** — 2-column table: archetype, capacity MW / MWh, tracking, tilt, GCR, module, inverter (pulled from `proposal.config` / `yieldResult.inputs`).
4. **Energy yield** — three big-number shapes (P50, P90, specific yield kWh/kWp) using coloured rounded rectangles + text; below: native pptxgenjs `addChart(pptx.ChartType.bar, ...)` with monthly P50 values from `yieldResult.monthly` (fallback: hide chart with "Yield simulation pending" note). Caption: `gridmind-stub-v1 (placeholder)`.
5. **Commercial summary** — table rows: subtotal, contingency, total, currency, validity. Explicitly no `margin_pct`.
6. **Timeline & tender dates** — bullet/milestone list from `tenderEvents` (event type + formatted date + notes). Empty state: "No upcoming tender events".
7. **Terms & contact** — `proposal.notes`, validity line, and `salesOwner.full_name` / `salesOwner.email`.

**Filename**: `GridMind_Proposal_<account>_<title>_v<version>.pptx`; slugify (`[^A-Za-z0-9]+` → `_`, trim, cap length 60 per segment).

### 3. Export button — `src/components/proposals/ExportPptxButton.tsx`

Mirrors `ExportPdfButton`:
- Props identical (`proposalId`, `companyId`, `projectId?`, `size`, `variant`, `label`).
- Icon: `Presentation` from `lucide-react`; label default `"Export PPTX"`.
- Flow: `assertExportAllowed` → toast + silent abort on lock → `getProposalExportData` → `buildProposalPptx` → `downloadBlob` → `recordProposalExport({ format: "pptx" })` → sonner success/error toasts, spinner state.

### 4. Wire button into UI

- `src/routes/_authenticated/proposals.$proposalId.tsx` (~line 129): add `<ExportPptxButton …/>` beside `<ExportPdfButton …/>` in the header actions.
- `src/routes/_authenticated/proposals.index.tsx` (~line 149): add `<ExportPptxButton …/>` beside the row PDF button.

### 5. Verification

- `bun run build:dev` clean (typecheck via tsgo if fast).
- Manual QA in preview: export a seeded proposal → open the file, confirm 7 slides, brand title bar + logo, native editable bar chart, no `margin_pct` anywhere, "O&M"/"C&I" render as plain ampersand (no `&amp;` artefact), filename matches convention.
- Confirm `audit_log` has a `proposal.export_pptx` row after export (via `supabase--read_query`).
- Trigger a `project_export_locks` row and confirm the PPTX button aborts with the same toast as PDF; drop the row and confirm normal export resumes. `42P01` (locks table absent) → export proceeds.

### Technical notes

- pptxgenjs is already installed (`^3.12.0`).
- All server changes stay in `proposal.functions.ts`; no DB migration.
- No new tokens; button uses existing shadcn `Button` variants.
- Renaming `getProposalPdfData` is a breaking symbol change — only one call site (`ExportPdfButton`), updated in the same batch.
