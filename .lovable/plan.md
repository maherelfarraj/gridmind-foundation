## P-089 — QA/QC inspections + heatmap

Follows the P-088 pattern (rules → functions → query → components → routes → tests).

### 1. Migration `supabase/migrations/0042_qaqc.sql`

Applied as specified. Notes:
- Enums `qaqc_discipline`, `qaqc_result` via guarded do-blocks.
- Table `qaqc_inspections` with `unique (company_id, inspection_number)`.
- RLS: SELECT `is_company_member`; write role gate `construction_admin | foreman | field_technician | company_admin`.
- GRANT SELECT / INSERT / UPDATE to `authenticated`.
- Indexes on `(company_id, project_id, discipline, area)` and `(company_id, project_id, result, rework_required)`.
- Attach `trg_updated_at` trigger using existing `set_updated_at()`.
- (P-090 will append punch items to the same file later — this migration only contains part 1.)

### 2. Rules — `src/lib/qaqc.rules.ts`

Pure logic + Zod schemas (no server imports so it stays test-safe):
- Enums: `QAQC_DISCIPLINES`, `QAQC_RESULTS`, labels.
- `inspectionInput` schema — `.superRefine` enforces "rework_required ⇒ non-empty rework_notes".
- `nextInspectionNumber(existing)` → `QA-0001…` (mirror `nextIncidentNumber`).
- `heatmapCellTint(failRate, count)` → returns semantic token class (`bg-muted`, `bg-destructive/10 → /70`).
- `computeHeatmap(rows, areas, disciplines)` → matrix + totals + rework %.

### 3. Server functions — `src/lib/qaqc.functions.ts`

Thin file, all handlers wrapped in `requireSupabaseAuth`. Helpers live in `qaqc.rules.ts` (no sibling declarations, per `tanstack-serverfn-splitting`):
- `listInspections({ projectId, discipline, result, reworkOnly, search, area, from, to })` — server-side filters.
- `getInspection({ id })` — detail + permissions.
- `createInspection(input)` — allocates `inspection_number` with retry on unique conflict, writes audit `qaqc.inspection_create`.
- `updateInspection(input)` — audit `qaqc.inspection_update`.
- `signInspectionAttachment({ path })` — signs from `documents` bucket after company membership check.
- `getHeatmap({ projectId, from, to })` — one SELECT, groups client-side; returns rows, distinct areas, KPI (rework %, total, pass, fail, conditional, pending).
- `getQaqcProjects()` + `getInspectorOptions()` for pickers.

### 4. Query options — `src/lib/qaqc-query.ts`

`queryOptions` factories: `qaqcProjectsQueryOptions`, `inspectionListQueryOptions(filters)`, `inspectionDetailQueryOptions(id)`, `qaqcHeatmapQueryOptions(projectId, range)`. Also re-export a shared `errorMessage`.

### 5. Components

- `src/components/qaqc/result-badge.tsx` — semantic tinted badge per `qaqc_result`.
- `src/components/qaqc/heatmap-grid.tsx` — presentational grid; props: cells matrix, areas, disciplines, `onCellClick`. Uses tint helper only; no hex.
- `src/components/qaqc/attachment-list.tsx` — thumbnail rows with signed-URL open.

### 6. Routes

All under `_authenticated/`, each with its own `head()` metadata.

**`/qaqc/inspections`** — `qaqc.inspections.index.tsx`
- Filters: project, discipline, result, rework-only toggle, area, date range, search.
- Data table (number, date, discipline, area, ITP ref, result badge, rework flag). Skeleton, empty ("No inspections recorded yet"), error retry.
- CSV export via existing `objectsToCsv` helper.

**`/qaqc/inspections/new`** — `qaqc.inspections.new.tsx`
- react-hook-form + zod. Project → discipline → area → ITP ref → WBS item (optional) → inspection date → inspector → result → rework toggle + notes → attachments.
- Attachments upload to `documents/{company_id}/qaqc/{project_id}/…` then referenced in the JSON column.
- Sticky bottom action bar (mobile-safe).

**`/qaqc/inspections/$id`** — `qaqc.inspections.$id.tsx`
- Read-only summary + editable fields for writers. Attachments open via signed URL.

**`/qaqc/heatmap`** — `qaqc.heatmap.tsx`
- Project picker, date range (default trailing 90 days).
- KPI tiles: total inspections, rework %, pass rate, open (pending+conditional).
- Grid: rows = areas, columns = civil / mechanical / electrical. Cell shows inspection count; tinted by fail+rework rate using `heatmapCellTint`; `bg-muted` when zero. Tooltip: pass / fail / conditional / rework counts. Click a cell → `navigate({ to: "/qaqc/inspections", search: { projectId, discipline, area, from, to } })`.
- Skeleton grid, empty ("No inspection data for this period"), error retry.

Search params typed via `Route.validateSearch` on `/qaqc/inspections` so heatmap deep-links work with type safety.

### 7. Nav

Update `src/lib/nav-map.ts` — add QA/QC entries under `field_qaqc`:
- Inspections → `/qaqc/inspections`
- Heatmap → `/qaqc/heatmap`

### 8. Tests — `tests/unit/qaqc-rules.test.ts`

- `nextInspectionNumber` (empty, increment, malformed).
- `inspectionInput.superRefine` rejects rework_required=true with empty notes; accepts with notes.
- `heatmapCellTint`: zero-count → `bg-muted`; increasing fail rate steps through `/10 → /70`.
- `computeHeatmap`: totals, per-cell counts, and rework % across a fixture of 4–5 rows.

### 9. Manual verification checklist

- Apply migration twice — second run is a no-op.
- Cross-tenant SELECT returns 0 rows (RLS).
- Submit form with `rework_required` and empty notes → client zod error; direct RPC call rejected server-side.
- Seed 4–5 inspections across 2 areas × civil/electrical (mixed pass/fail/rework) → heatmap tints scale; empty cells muted.
- Click hot cell → list pre-filtered to area+discipline; count matches; header rework % matches.
- Audit rows present for each mutation.
- Skeleton, empty, and error states visible on both pages.

### Technical notes

- Attachments column is `jsonb` array `[{ file_path, label }]`. Upload path prefix uses `company_id` first per storage RLS convention.
- `inspection_number` allocation: `select max(nullif(regexp_replace(inspection_number, '\\D', '', 'g'), '')::int)` scoped to company, format with `padStart(4, "0")`, retry once on 23505.
- Semantic tokens only — tints use `bg-destructive/{10..70}` and `bg-muted`; no raw hex anywhere.
- Server fn module keeps zero sibling helpers (all logic imported from `qaqc.rules.ts`) to avoid `?tss-serverfn-split` `ReferenceError`.
- Query key roots: `["qaqc","inspections",…]`, `["qaqc","heatmap",…]` — invalidated on every mutation.
