## P-072 — WBS builder UI

Adds the first Planning sub-route: `/projects/$projectId/planning/wbs`. Uses TanStack Query loaders, `createServerFn` + zod + `requireSupabaseAuth`, and semantic tokens throughout.

### 1. Server functions — `src/lib/wbs.functions.ts`

Role gate: `project_admin | finance_admin | company_admin` for writes (read is company-member via RLS).

- `listWbsTree({ projectId })` — returns `{ items: WbsItem[] }` sorted by `parent_id, sort_order`. Client builds the tree.
- `createWbsItem({ projectId, parent_id, code, name, item_type, discipline?, description?, sort_order?, budgeted_amount?, currency_code?, ifc_package_ref? })` — audits `wbs.create`.
- `updateWbsItem({ id, patch })` — same schema (partial). Audits `wbs.update`.
- `reparentWbsItem({ id, parent_id, sort_order })` — audits `wbs.reparent` (prevents self/descendant cycles server-side by walking ancestors).
- `deleteWbsItem({ id })` — blocks with `wbs.has_children` when the node has direct WBS children OR any `schedule_tasks.wbs_item_id = id`. Returns a typed `{ error: "has_dependencies", counts: { children, tasks } }` shape so the UI can toast a friendly message. Audits `wbs.delete` on success.
- `importIfcPackages({ projectId, packages: [{ code, name, discipline, ifc_package_ref }] })` — inserts selected packages in one call under a single "Engineering" root (auto-created if missing), audits `wbs.import_ifc` with `{ project_id, count, source: "ifc_release" }`.
- `proposeIfcPackages({ projectId })` — reads released `ifc_releases` for the project + their `revision_snapshot` and `drawing_register` (discipline, drawing_number, title) and returns dedupe-by-discipline proposals (code suggestion like `1.<n>` unused-in-project, name from `package_name`, `ifc_package_ref = release.id`). Also flags packages already imported (existing `wbs_items.ifc_package_ref = release.id`).

Split rule: file contains only `createServerFn` + imports; helpers (cycle check, next-code, proposal builder) live in `src/lib/wbs.server.ts`. Pure rules (code regex, discipline enum, zod schemas) live in `src/lib/wbs-rules.ts` — imported by both.

### 2. Schedule-task alignment — extend `src/lib/schedule-tasks.functions.ts`

New file (schedule task work fully lands in P-073; this batch adds just what the align panel needs):
- `listScheduleTasksForAlign({ projectId })` → `{ tasks: [{ id, name, discipline, wbs_item_id, status }] }`.
- `assignScheduleTask({ id, discipline, wbs_item_id })` — role gate: `project_admin | construction_admin | company_admin`. Audits `schedule_task.assign` with `{ from: {...}, to: {...} }`.

### 3. Query helpers — `src/lib/wbs-query.ts`

`wbsTreeQueryOptions(projectId)`, `wbsIfcProposalsQueryOptions(projectId)`, `scheduleTasksAlignQueryOptions(projectId)`.

### 4. Route — `src/routes/_authenticated/projects.$projectId.planning.tsx` (layout) + `.planning.wbs.tsx` (leaf)

Layout mirrors `projects.$projectId.engineering.tsx`: subnav shell with `Outlet`, only "WBS" tab active this batch (Gantt/Baselines/Risks appear in P-073/P-074). Adds "Planning" to the department tabs by extending `DEPT_TABS` in `projects.$projectId.tsx` **only when** the project's `departments` contains `finance` or a new synthetic `planning` mapping — safer to keep it separate: append a static "Planning" tab visible on every project (planning is not gated per project department). Confirmed acceptable — this matches how `gates` is always shown.

Leaf `planning.wbs.tsx`:
- Two-pane grid (`lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]`, stacks on mobile).
- **Left tree** (`components/planning/wbs-tree.tsx`): recursive collapsible list, indent-per-depth, per-row shows `code` (mono), name, `item_type` badge, discipline chip, budget `Intl.NumberFormat`. Row actions (kebab): Add child, Add sibling, Delete. Includes "Unassigned tasks" virtual node fed by `scheduleTasksAlignQueryOptions` (unassigned count badge).
- **Right editor** (`components/planning/wbs-detail-form.tsx`): react-hook-form + zod. Client-side sibling-uniqueness check against loaded tree; DB unique is backstop. Reparent via parent-picker `Select` (excludes self + descendants). Discipline `Select` from fixed vocab. Currency `Select` from `currencies` query. Save → mutation → invalidate tree.
- **Header actions**: "Import IFC packages" opens `IfcImportDialog` (uses `proposeIfcPackages`), rows with checkboxes + editable code/name; "Already imported" rows disabled. Confirm → `importIfcPackages` → toast + invalidate.
- **Lower panel** (`components/planning/task-alignment-panel.tsx`): table of schedule tasks with inline discipline + WBS `Select`s, optimistic update via `useMutation` (`onMutate` patches cache, rollback on error), sonner toast per save.
- **States**: `pendingComponent` skeleton, empty state ("No WBS yet — import IFC packages or add your first phase" with two CTAs), `errorComponent` with retry (`router.invalidate()` + `reset()`).
- **Read-only mode**: query `has_company_role` results via a `wbsAccessQueryOptions` (mirrors pattern used in price-alerts) — hides all write controls when the user lacks a write role.

### 5. Nav — `src/lib/nav-map.ts`

No change (Planning & Budget already listed under Lifecycle → `/planning`). This batch surfaces WBS inside the project cockpit, not the global nav. A future batch can add a top-level `/planning` index if needed.

### 6. Tests — `tests/unit/wbs-rules.test.ts`

Pure-rule coverage:
- Code regex + sibling uniqueness helper (`isCodeUniqueAmongSiblings`).
- Cycle detector (`wouldCreateCycle(tree, id, newParent)`).
- Zod schemas reject: empty name, invalid discipline, negative sort_order, negative budget.
- Next-code suggestion for imports (`suggestNextRootChildCode`).

### 7. Verification

- Typecheck; `bun run test:unit tests/unit/wbs-rules.test.ts`.
- Manual on Prairie Winds: build 1 → 1.1 → 1.1.1, unique code rejection surfaces, IFC import proposes from released set + audits `wbs.import_ifc`, delete blocked while a task references the node, align panel decrements unassigned badge, skeleton/empty/error visible, read-only role sees no controls.

### Technical notes

- `.functions.ts` files stay handler-only per `tanstack-serverfn-splitting`.
- IFC proposal reads `ifc_releases.revision_snapshot` (Json) and joins to `drawing_register` for discipline. If a release lacks a snapshot, fall back to listing the release itself as one package.
- Optimistic task assignment uses `queryClient.setQueryData` + rollback on `onError`.
- No changes to migration 0032; all constraints already in place.
