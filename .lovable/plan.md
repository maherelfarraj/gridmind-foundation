## P-091 — NCRs, submittals, transmittals

### 1. Migration `0043_ncr_submittals_transmittals.sql`

Ship the SQL exactly as specified, wrapped so it is idempotent (twice-clean):
- `do $$ ... exception when duplicate_object ...` for all 5 enums.
- `create table if not exists` for `ncrs`, `submittals`, `transmittals` with the columns listed.
- `alter table ... enable row level security` + `drop policy if exists` before each `create policy` (select + write per table with the exact role gates).
- GRANT select/insert/update to `authenticated`, GRANT all to `service_role`.
- Indexes as specified.
- `trg_updated_at` trigger on each of the three tables using existing `public.set_updated_at()`.
- Numbering uniqueness comes from the specified UNIQUE constraints (`company_id, ncr_number`; `company_id, project_id, submittal_number, revision`; `company_id, transmittal_number`).

Note: the existing project already has `0043_qaqc_punch.sql` (P-090). Migration files are timestamped, so this file will land as a new timestamped migration and coexist without conflict.

### 2. Domain rules — `src/lib/ncr.rules.ts`, `src/lib/submittals.rules.ts`, `src/lib/transmittals.rules.ts`

Pure helpers, split from `.functions.ts` per tss-serverfn-split rule:
- Enum arrays + label maps for `ncr_source`, `ncr_disposition`, `ncr_status`, `submittal_status`, `transmittal_direction`.
- Zod schemas: `ncrCreateInput`, `ncrDispositionInput` (custom refinement: `disposition = 'use_as_is'` requires non-empty `rootCause` + `correctiveAction`), `ncrCloseInput`, `submittalCreateInput`, `submittalReviewInput`, `submittalReviseInput`, `transmittalCreateInput` (items array with `document_id`, `description`, `revision`, `copies`), `transmittalSendInput`, `transmittalAckInput`.
- `nextSeq(existing, prefix)` helper for `NCR-####`, `SUB-####`, `TRN-####`.
- Role guards: `canWriteNcr(roles)`, `canWriteSubmittal(roles)`, `canWriteTransmittal(roles)`.
- Semantic tint helpers for status badges (semantic tokens + amber/emerald/destructive tints already in use — no raw hex).
- `daysBetween(a, b)` + `avgTurnaround(rows)` + `daysOpen(row)` for KPI math (pure, unit-testable).

### 3. Server functions

Each in its own file to keep handlers thin:

**`src/lib/ncr.functions.ts`**
- `listNcrs({ projectId?, status?, disposition?, source?, search? })` — company-scoped, joined project name.
- `getNcr({ id })` — includes source linkage summary (inspection number / punch number / observation id) when available.
- `createNcr({ projectId, source, sourceId?, discipline?, area?, description, costImpact?, currencyCode? })` — allocates `NCR-####` with retry on 23505; role gate `canWriteNcr`; audit `ncr.raise`.
- `setNcrDisposition({ id, disposition, rootCause?, correctiveAction? })` — validation refinement enforces `use_as_is` requirements; audit `ncr.disposition`.
- `closeNcr({ id })` — sets `status='closed'`, `closed_by`, `closed_at`; audit `ncr.close`.
- `voidNcr({ id, reason })` — status=void; audit `ncr.void`.

**`src/lib/submittals.functions.ts`**
- `listSubmittals`, `getSubmittal`.
- `createSubmittal({ projectId, title, specSection?, dueDate?, filePath? })` — starts at `R0`, status `draft`, allocates `SUB-####`.
- `submitSubmittal({ id })` — status → `submitted`, sets `submitted_at`; audit `submittal.submit`.
- `reviewSubmittal({ id, status: approved|approved_as_noted|revise_resubmit|rejected, reviewNotes? })` — sets `reviewed_by/at`; audit `submittal.review`.
- `reviseSubmittal({ id, filePath?, title?, dueDate? })` — inserts NEW row: same `submittal_number`, incremented `revision` (`R0`→`R1`), status `draft`; audit `submittal.revise`.
- `signSubmittalUpload({ projectId, fileName })` — signed upload URL under `documents` bucket at `{company_id}/submittals/{project_id}/{uuid}-{safeName}`.

**`src/lib/transmittals.functions.ts`**
- `listTransmittals`, `getTransmittal`.
- `createTransmittal({ projectId, direction, fromParty, toParty, subject, items[], responseDue? })` — allocates `TRN-####`.
- `sendTransmittal({ id })` — status timestamp; audit `transmittal.send`.
- `ackTransmittal({ id })` — sets `acknowledged_at`; audit `transmittal.ack`.
- `listProjectDocuments({ projectId })` — read-only picker source from the existing `documents` table for the compose step.

### 4. Query options — `src/lib/ncr-query.ts`, `src/lib/submittals-query.ts`, `src/lib/transmittals-query.ts`
Standard `queryOptions` factories following the `qaqc-query.ts` shape (list, detail, and picker options).

### 5. Routes (mobile-friendly, semantic tokens only)

All list routes share the same skeleton: header + KPI chips, `Card` filter bar with project/status/search + CSV export, then `Skeleton` while loading, `Alert` with retry on error, empty state with primary CTA, then a `Table`.

- `src/routes/_authenticated/qaqc.ncrs.index.tsx` — deep-linkable search params (`projectId`, `status`, `disposition`, `source`, `search`). KPI chips: open NCRs, avg days-open (from `daysOpen`), total `cost_impact` via `Intl.NumberFormat` per currency. CSV export via existing `objectsToCsv`/`downloadCsv`. "New NCR" button.
- `src/routes/_authenticated/qaqc.ncrs.new.tsx` — accepts optional `source`, `sourceId`, `projectId` search params for deep-link prefills (from inspection/punch/observation pages).
- `src/routes/_authenticated/qaqc.ncrs.$id.tsx` — detail page: source link back to originating record when present, disposition form with zod-enforced `use_as_is` guard (client-side error + disabled submit until root cause + corrective action are filled), corrective action textarea, close/void actions, cost impact display.
- `src/routes/_authenticated/field.submittals.index.tsx` — list + KPI avg turnaround days (only rows with both `submitted_at` and `reviewed_at`). "New submittal" button.
- `src/routes/_authenticated/field.submittals.$id.tsx` — detail: current revision row header, revision history table (all rows sharing `submittal_number`), file link (signed URL), Submit → Review (reviewer-only select + notes) → Bump revision actions with confirmation dialogs; file upload via signed URL.
- `src/routes/_authenticated/field.transmittals.index.tsx` — list; overdue = `direction='outgoing' AND response_due < today AND acknowledged_at IS NULL` gets a `text-destructive` badge.
- `src/routes/_authenticated/field.transmittals.$id.tsx` — detail with items table; Send / Acknowledge actions.
- `src/routes/_authenticated/field.transmittals.new.tsx` — compose page: pick project → multi-select from `listProjectDocuments`, edit description/revision/copies per row, save.

Cross-linking: from the QA inspection detail (`qaqc.inspections.$id.tsx`), when `result = 'fail'`, add a "Raise NCR" button linking to `/qaqc/ncrs/new?projectId=…&source=inspection&sourceId=…`. Same on punch item detail (`source=punch_item`) and any observation detail we have.

### 6. Nav

Extend `src/lib/nav-map.ts` under `field_qaqc`: add "NCRs" → `/qaqc/ncrs`, "Submittals" → `/field/submittals`, "Transmittals" → `/field/transmittals` using existing `lucide-react` icons already imported (`ClipboardCheck`, `AlertTriangle`, `FileText` — verify at edit time).

### 7. Head metadata

Every new route gets its own `head()` with unique title/description/og:title/og:description/og:type/twitter:card (no og:image — these are internal ops screens with no meaningful hero).

### 8. Cross-link + tsgo

After writing routes, run `bunx tsgo --noEmit` and fix any type issues before finishing.

### Verification checklist (from the spec)
- Migration re-runs cleanly (idempotent enums + `if not exists` + `drop policy if exists`).
- RLS on all three tables; the existing RLS test harness will catch cross-tenant leakage; no dedicated new SQL test is required by the spec but I'll extend `tests/rls/` with a stub covering the three tables.
- Deep-link prefill works: `/qaqc/ncrs/new?source=inspection&sourceId=…` populates the form; `use_as_is` disposition is blocked (client + server) without root cause + corrective action.
- Revision bump creates a new row with the same `submittal_number` and `R1`.
- Overdue transmittal shows `text-destructive` badge; ack sets timestamp.
- `field_technician` can write NCRs but cannot write submittals (enforced by RLS write policies).
- Every mutation calls `writeAuditLog` with the specified action strings.

### Not in scope (out per instructions)
- No email/notification hook on submittal review or transmittal send.
- No PDF export (that's P-092).
- No changes to existing punch/inspection functionality beyond the two "Raise NCR" deep links.
