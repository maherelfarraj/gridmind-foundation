# P-113 — Project export locks (real gate)

## Current state (verified)

- `approval_rules.blocks_export` already exists and is editable from the rules admin UI.
- `approval_instances.metadata` is a free-form jsonb (`start_approval_instance` accepts `p_metadata`); callers do not yet stamp `project_id` in there consistently.
- `src/lib/export-guard.ts` already exists as a **forward-compatible stub**: it queries a `project_export_locks(active, reason)` shape that does NOT match the P-113 schema, ignores 42P01, and takes `{ companyId, projectId }` (no `exportType`). All call sites use this shape.
- `assertExportAllowed` is already wired in: proposal PDF/PPTX server fns + buttons, weekly report, O&M report, turnover pack (crm/opportunity list exports and proposal buttons). We only need to add the `exportType` argument and re-check each site.
- No turnover-pack export **button** yet — server fn only. Same for weekly/O&M PDFs, which are triggered from their own dialogs.
- Roles `company_admin`, `project_admin`, `finance_admin` all exist in the `app_role` enum.

## Migration

Create `supabase/migrations/0053_project_export_locks.sql` with the exact SQL from the spec:

- `project_export_locks` table with `export_type` check, `approval_instance_id` FK, `locked_by`, `locked_at`, `unlocked_at`, standard timestamps.
- Deferred FK on `project_id → projects(id)` via `do $$ ... $$` guard.
- Partial unique index on `(project_id, export_type) WHERE unlocked_at IS NULL` (one active lock per type per project).
- RLS: SELECT for members and non-external-viewers; INSERT/UPDATE gated to `company_admin | project_admin | finance_admin`.
- GRANT SELECT, INSERT, UPDATE to `authenticated`; `set_updated_at` trigger.
- SECURITY DEFINER functions: `is_export_locked(project_id, export_type)`, `assert_export_unlocked(...)`, `sync_export_locks(project_id)`. `is_export_locked` combines active manual locks + any pending/in_progress approval instance whose rule has `blocks_export = true` and whose `metadata->>'project_id'` matches. Fails closed when caller has no company.
- Grants on all three functions to `authenticated`.

## Rewrite the guard — `src/lib/export-guard.ts`

Replace the stub with a typed helper:

```ts
export type ExportType =
  | "proposal_pdf" | "proposal_pptx" | "weekly_client_report"
  | "om_report"   | "turnover_pack"  | "audit_pack" | "csv";

export async function assertExportAllowed(
  supabase: SupabaseClient,
  projectId: string | null,
  exportType: ExportType,
): Promise<void>
```

- If `projectId == null` (e.g. CRM CSV, opportunity export) → no-op (no project scope to lock).
- Otherwise: `await supabase.rpc('sync_export_locks', { p_project_id: projectId })` (best-effort; ignore error), then `await supabase.rpc('assert_export_unlocked', { p_project_id: projectId, p_export_type: exportType })`.
- Map any `export_locked:*` error (Postgres `raise exception`) to a typed throw: `{ statusCode: 423, message: 'Export blocked: approval pending', exportType }`. Preserve 42P01 no-op for local dev.

Also export a small client hook `useIsExportLocked(projectId, exportType)` (thin `useQuery` wrapper around `rpc('is_export_locked')`) and an `ExportLockBadge` component (`bg-accent`, lock icon, "Exports locked: <types>").

## Update every call site to pass `exportType`

Existing calls (all must be edited — signature change is breaking):

| File | exportType |
| --- | --- |
| `src/lib/proposal.functions.ts` (PDF export fn ~L1546) | `proposal_pdf` |
| `src/lib/proposal.functions.ts` (PPTX export fn ~L1711) | `proposal_pptx` |
| `src/components/proposals/ExportPdfButton.tsx` | `proposal_pdf` |
| `src/components/proposals/ExportPptxButton.tsx` | `proposal_pptx` |
| `src/lib/field-reports.functions.ts` (weekly ~L579) | `weekly_client_report` |
| `src/lib/om-reports.functions.ts` (~L203) | `om_report` |
| `src/lib/opportunity.functions.ts` (~L820) | `csv` (project-less → no-op) |
| `src/lib/crm.functions.ts` (~L325) | `csv` (project-less → no-op) |
| Turnover pack fn (in commissioning/turnover functions) | `turnover_pack` — locate + wire |

Each call becomes `await assertExportAllowed(context.supabase, projectId ?? null, "<type>")`. Buttons pass `supabase` (browser client) with the same shape.

## Manual lock server fns

Add to a new `src/lib/export-locks.functions.ts`:

- `listExportLocks({ project_id })` — SELECT active locks for badge/UI.
- `lockExport({ project_id, export_type, reason })` — role check via `has_company_role('company_admin'|'project_admin'|'finance_admin')`, INSERT row, `writeAuditLog('export.locked', 'project_export_locks', id, { project_id, export_type, reason })`.
- `unlockExport({ lock_id })` — same role gate, UPDATE `unlocked_at = now()`, audit `export.unlocked`.

Zod schemas alongside. Idempotency: attempting to lock a type that is already active returns the existing lock (surface via unique index conflict).

## UI wiring

- **Every existing export button** (`ExportPdfButton`, `ExportPptxButton`, weekly-report dialog trigger, O&M report generator button, turnover compile button): use `useIsExportLocked(projectId, exportType)` to render disabled state with `<Lock>` icon + tooltip "Export blocked while approvals are pending". Keep server-side guard as the source of truth.
- **`ExportLockBadge`** — mount on project header (find the shared project header/detail layout used by `/projects/$projectId`) via `listExportLocks`. Renders `bg-accent`, lock icon, comma-joined export types. Hides itself when array empty. Skip if no shared header exists — add to project overview page instead.
- **Manual lock/unlock UI** — a small admin card on the project overview: "Export governance" listing active locks with an Unlock button (role-gated), and a "Lock exports" dialog (type + reason). Kept minimal; full admin surface can come later.

## Stamp `project_id` in approval metadata

For the auto-release path (approval → export unlock) to work, `metadata.project_id` must be set on any `blocks_export` instance. Update callers that start such approvals (proposal pricing, project phase gate, contract, change_order in current code) to include `project_id` in the metadata payload. This is a small edit at each `startApprovalInstance({ ... metadata: { project_id, ... } })` call — locate and update.

## Verification (matches spec)

1. Run migration → re-run → clean.
2. Start a `blocks_export` proposal pricing approval with `metadata.project_id` set → PDF export throws 423 + button disabled + badge on header.
3. Approve the instance → `sync_export_locks` fires on next export attempt → export succeeds.
4. `lockExport` with reason → audit row `export.locked`; `unlockExport` → `export.unlocked`.
5. Sign in as a `client_viewer` and query `project_export_locks` → 0 rows (RLS + `is_external_viewer` guard).
6. `bunx tsgo --noEmit` clean.

## Out of scope

- No changes to the approval engine RPCs themselves.
- No CSV export button badge wiring (project-less exports; guard is a no-op).
- Full "audit_pack" export type is reserved; nothing consumes it yet.
