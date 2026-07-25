# P-084 — Mobilization Checklist Module

Per-project site mobilization checklist proving readiness before field work starts.

## 1. Migration — `supabase/migrations/0040_mobilization_checklists.sql`

Run the exact SQL from the request:
- Enums `mobilization_category` (6 values) and `mobilization_status` in guarded `do $$ ... $$` blocks.
- Table `public.mobilization_checklists` with `company_id`, `project_id`, `name`, `status`, `items jsonb` (default `[]`), `started_at`, `completed_at`, `created_by`, timestamps, unique `(company_id, project_id, name)`.
- RLS enabled: SELECT via `is_company_member`, ALL via role check (`construction_admin` / `foreman` / `company_admin`) using `has_company_role`.
- GRANT `select, insert, update` to `authenticated` (no delete, per convention).
- Index `mobilization_project_idx (company_id, project_id, status)`.
- Attach existing `trg_updated_at` trigger for the `updated_at` column.

## 2. Server functions — `src/lib/mobilization.functions.ts`

All wrapped with `createServerFn` + `requireSupabaseAuth`, Zod-validated, and each mutation calls the existing `write_audit_log` RPC.

- `listMobilizationChecklists({ projectId })` — company-scoped list ordered by `created_at desc`.
- `getMobilizationChecklist({ checklistId })` — single fetch.
- `createMobilizationChecklist({ projectId, name? })` — seeds default items spanning the six categories:
  - cabins_facilities: site cabins & welfare, laydown area
  - fencing_security: perimeter fencing & gates, security & lighting
  - hse_induction: HSE induction for all site personnel (item carries `roster: []` array of `{name, company, inducted_at}`)
  - utilities_comms: water, power, comms
  - access_logistics: site access roads & signage
  - permits_licenses: permits & licenses
  Each item: `{key, label, category, required, status:'not_started', evidence_path:null, completed_by:null, completed_at:null, notes:null}`. Audit `mobilization.create`.
- `toggleMobilizationItem({ checklistId, itemKey, status, notes? })` — mutates the item within `items`, sets `completed_by`/`completed_at` on completion, recomputes overall status (`not_started` / `in_progress`), and audits `mobilization.item_complete`.
- `updateInductionRoster({ checklistId, itemKey, roster })` — replaces the induction roster array; item status auto-updates if roster length > 0.
- `attachEvidence({ checklistId, itemKey, evidencePath })` — sets `evidence_path` (path relative to `documents` bucket).
- `completeMobilizationChecklist({ checklistId })` — server-enforced guard: throws if any `required` item is not `complete`; sets `status='complete'`, `completed_at=now()`. Audit `mobilization.complete`.

Storage: uploads go to the private `documents` bucket under `{company_id}/mobilization/{project_id}/{checklistId}/{itemKey}-{filename}` (company UUID first — matches existing `storage_company_id` policy). Client uses the existing `supabase` storage helper; server stores only the returned `path`.

## 3. UI routes (Tailwind semantic tokens only — no raw hex)

Both routes are pathless siblings of the existing `_authenticated/` tree since no `/field` routes exist yet.

### `src/routes/_authenticated/field.mobilization.tsx`
- Project picker (reuses existing company-scoped project query pattern).
- Checklist grid with status badge, progress bar = `requiredComplete / requiredTotal`, updated timestamp.
- "New checklist" button → calls `createMobilizationChecklist`.
- Loading skeleton, empty state ("No mobilization checklist yet — create one to begin site setup"), error state with retry button.

### `src/routes/_authenticated/field.mobilization.$checklistId.tsx`
- Header: name, status chip, overall progress.
- Amber banner while any required item is incomplete ("Site not yet ready for field work").
- Sections grouped by the six categories, each collapsible.
- Per item: checkbox / status toggle, notes textarea, evidence upload (input → storage → `attachEvidence`), download link if `evidence_path` set.
- HSE induction card: inline roster editor (add/remove attendees, name + company + inducted_at date) calling `updateInductionRoster`.
- "Mark checklist complete" button — disabled client-side until required items done; server still enforces.
- All mutations use `useServerFn` + `useMutation` with `queryClient.invalidateQueries`.

## 4. Project header chip integration (P-038)

In `src/routes/_authenticated/projects.$projectId.tsx` header, fetch the latest mobilization checklist for the project and render a read-only chip:
- `Mobilization: not started` (muted) if no rows or all not_started.
- `Mobilization: in progress` (amber semantic token) while any exist and none complete.
- Hide chip once at least one checklist is complete (spec: "until complete").

Adds one lightweight query keyed on `['mobilization-header', projectId]`.

## 5. Navigation

Add "Field → Mobilization" entry to `src/lib/nav-map.ts` visible to roles: `construction_admin`, `foreman` (write), plus `field_technician`, `project_admin`, `hse_admin` (read). RLS in DB still enforces write authorization.

## 6. Tests

- `tests/rls/mobilization.rls.test.ts` — stub verifying: cross-tenant SELECT denial, field_technician write denial, `has_company_role` write acceptance, unique constraint on `(company_id, project_id, name)`.
- `tests/unit/mobilization-progress.test.ts` — pure helper `computeProgress(items)` returning `{requiredComplete, requiredTotal, allRequiredDone}`; assert the complete-guard math.

## Technical notes

- Items live inside the `items` jsonb column (single-row semantics). All mutations do `select ... for update` semantics by reading-then-updating within one server fn call using the authenticated `context.supabase`.
- Overall status transitions computed server-side after every item mutation: any `in_progress|complete` → `in_progress`; none touched → `not_started`; explicit complete only via `completeMobilizationChecklist`.
- Evidence upload uses signed URLs from the existing documents-bucket helpers (matches drawings/pay-app pattern).
- No delete grant → checklists are archived by convention, not removed.

## Verification steps

1. Apply migration; run `supabase--linter` and fix any warnings tied to this migration only.
2. With Prairie Winds project: create checklist → confirm 6 categories seeded with HSE roster item.
3. Complete items → progress bar reflects required-only math; attempt to complete with one required item open → server throws.
4. Upload a fencing photo → confirm path `{company}/mobilization/{project}/...` and persistence.
5. Project header shows "Mobilization: in progress" chip until complete.
6. Confirm `field_technician` read-only; audit rows written per mutation.
