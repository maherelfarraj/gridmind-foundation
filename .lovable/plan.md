## P-073 — Gantt, baseline lock, variance tracking

Schema is already in place from P-071 (`schedule_tasks`, `baseline_snapshots` with `snapshot` jsonb + `locked/locked_by/locked_at`, append-only via absent DELETE grant). No new migration required.

### Server (`createServerFn` + zod + `requireSupabaseAuth`)

- `src/lib/schedule.rules.ts` — pure helpers + zod schemas:
  - `scheduleTaskCreateSchema`, `scheduleTaskUpdateSchema` (partial patch: `name`, `discipline`, `start_date`, `end_date`, `progress_pct 0–100`, `status`, `is_milestone`, `sort_order`, `wbs_item_id`, `predecessor_ids uuid[]`).
  - `baselineCreateSchema`, `baselineLockSchema`, `deleteBaselineSchema` (all zod-validated).
  - `isOverdue(row, today)`, `daysBetween(a,b)`, `barColorForStatus(status, overdue)` → semantic token class (`bg-primary`, `bg-muted-foreground`, `bg-destructive`, `bg-secondary`).
  - `wouldCreateCycle(taskId, newPreds, allTasks)` — DFS over `predecessor_ids`; rejects self-reference and A→B→A chains.
  - `computeVariance(current, baselineSnapshotRow)` → `{ start_var_days, finish_var_days }` (positive = late).
  - `avgFinishVariance(tasks, snapshot)` for KPI.
  - `weightedProgress(tasks)` — Σ(progress×duration)/Σ(duration).
- `src/lib/schedule.functions.ts` (thin — helpers via imports):
  - `getScheduleAccess` (returns `{ canWrite, canLockBaseline }` from `has_company_role`).
  - `listScheduleTasks({projectId})`.
  - `createScheduleTask`, `updateScheduleTask`, `deleteScheduleTask` (write roles: `project_admin`, `construction_admin`, `company_admin`). `updateScheduleTask` runs the cycle check against the current task list and rejects with `{error:'predecessor_cycle'}` on violation.
  - `listBaselines({projectId})`, `createBaseline({projectId, name?})` (auto-name "Baseline N"; snapshots current tasks into `snapshot` jsonb).
  - `lockBaseline({id})` — `project_admin`/`company_admin` only; sets `locked, locked_by=auth.uid(), locked_at=now()`.
  - `deleteBaseline({id})` — refuses when `locked=true` (returns error) even though RLS also blocks writes/deletes on locked rows.
  - Every mutation calls `write_audit_log` with `schedule_task.create|update|delete` or `baseline.create|lock|delete`.
- `src/lib/schedule.query.ts` — `queryOptions` wrappers + `scheduleErrorMessage(err)`.

### UI

- `src/routes/_authenticated/projects.$projectId.planning.schedule.tsx` — leaf route with `head()` metadata, `pendingComponent` skeleton, `errorComponent` (retry via `router.invalidate()`), `component` = orchestrator.
- Adds "Schedule" sub-tab in `projects.$projectId.planning.tsx` (alongside WBS).
- `src/components/planning/schedule-kpi-strip.tsx` — 4 cards: total tasks, weighted % complete, overdue count, schedule variance (colored amber `text-amber-500-ish token`/destructive against selected locked baseline; grey "No baseline selected" when none).
- `src/components/planning/schedule-toolbar.tsx` — "New task", baseline picker (`Select` listing locked + draft baselines with 🔒 / draft badges), "Create baseline", "Lock" button (role-gated), "Compare to baseline" switch, CSV export button.
- `src/components/planning/gantt-view.tsx` — main workspace:
  - Left grid columns: name, discipline, start, end, progress %, status. When compare active + baseline selected, add **Start var** + **Finish var** columns (positive = destructive text, negative = muted-foreground).
  - Right timeline: SVG-free div-based grid. Header scales unit to weeks (project span ≤ 90 days) or months (larger). Row bar `absolute` positioned by (offset days / total span) × 100%, colored via `barColorForStatus` (in_progress→`bg-primary`, completed→`bg-muted-foreground`, overdue in_progress→`bg-destructive`, not_started→`bg-secondary`). Milestones render as rotated `bg-primary` diamonds. Ghost baseline overlay = 40% opacity outlined bar underneath current bar.
- `src/components/planning/task-inline-editor.tsx` — popover per row: name/discipline inputs, two shadcn date pickers with `pointer-events-auto`, progress `<Slider>` (0–100), status `<Select>`, milestone `<Checkbox>`, predecessors multi-select (checklist of sibling tasks; excludes self; excludes descendants to help avoid cycles client-side too). All changes call `updateScheduleTask`; server cycle check is the authority.
- `src/components/planning/baseline-manager.tsx` — small dialog listing baselines with created_at, lock state, task count; lock button; delete button disabled when locked.
- Empty state ("No tasks yet — build the WBS first" with link back to /planning/wbs).
- CSV export (`src/lib/schedule.csv.ts`) — Blob download containing task name, discipline, current start/end, progress, baseline start/end, start_var_days, finish_var_days.

### Verification (in build mode)

1. `tests/unit/schedule-rules.test.ts` — cycle detection (self-ref + A→B→A + long chain), `barColorForStatus`, `computeVariance`, `weightedProgress`, `avgFinishVariance`, `isOverdue`. Run with `bun run test:unit`.
2. `bunx tsgo --noEmit` clean.
3. Smoke via preview: create 6 tasks per acceptance list, verify colors + milestone diamond, force a cycle (server should reject), create/lock Baseline 1, push a task +10d, verify variance columns + amber/destructive KPI + ghost bar, verify CSV export.

### Non-goals

- No baseline editing UI (append-only + lock is spec).
- No drag-to-resize on bars (spec says popover date pickers).
- Predecessor arrows on the timeline are out of scope for P-073 (kept as inline chips in the row editor).

### Follow-ups after green

P-074 — risk register with P×I heat scoring.
