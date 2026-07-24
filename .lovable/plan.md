# P-059 — RFI Module

Adds Request For Information (RFI) tracking to the Engineering workspace with tenant-scoped schema, role-gated transitions, KPI analytics, and full audit coverage.

## 1. Migration `0022_rfis.sql`

Single migration containing:

- `create table public.rfis` with columns per spec:
  - Identity: `id`, `company_id`, `project_id → projects`, `rfi_number text`
  - Content: `subject`, `question`, `discipline drawing_discipline default 'general'`, `priority` (`low|normal|high|urgent`), `status` (`open|in_review|answered|closed|void`)
  - Routing: `raised_by`, `routed_to`, optional `drawing_id → drawing_register`, `due_date`
  - Resolution: `answer`, `answered_by`, `answered_at`, `closed_at`
  - Impact flags: `cost_impact`, `schedule_impact`
  - Standard: `created_by`, `created_at`, `updated_at`
  - `unique(project_id, rfi_number)`
- Grants: `select, insert, update, delete` to `authenticated`; `all` to `service_role`
- Enable RLS + policies:
  - `select`: `is_company_member(company_id)`
  - `insert`: member AND `raised_by = auth.uid()` AND `created_by = auth.uid()`
  - `update`: `has_role(auth.uid(),'engineering_admin')` OR `has_role(auth.uid(),'project_admin')` OR `routed_to = auth.uid()` OR `raised_by = auth.uid()` (raiser needed for close)
  - `delete`: engineering_admin or project_admin only
- Indexes: `(project_id, status)`, `(routed_to, status)`, `(company_id, created_at desc)`
- `update_updated_at` trigger reusing existing `set_updated_at()`

## 2. Server functions — `src/lib/rfi.functions.ts`

All wrapped with `requireSupabaseAuth`. Errors use existing `httpError` helper for 403/409 codes.

- `listRfis({ projectId, status?, discipline?, assignee?, search? })` — RLS-scoped select with joins to `profiles` (raised_by, routed_to, answered_by) and drawing number
- `getRfi({ rfiId })` — full row + joined display names
- `listRoutableMembers({ projectId })` — company members that can receive RFIs (any authenticated member)
- `raiseRfi({ projectId, subject, question, discipline, priority, routedTo, drawingId?, dueDate })`
  - Auto-generate `rfi_number` as `RFI-####` from `max(number) + 1` scoped to project
  - Server sets `raised_by = context.userId`, `status='open'`
  - Insert; on `23505` (unique violation) → `httpError(409, 'rfi_duplicate_number', …)` with retry hint (returns fresh next number)
  - `writeAuditLog('rfi.raised', 'rfis', id, { rfi_number, routed_to })`
- `answerRfi({ rfiId, answer })`
  - Load row; must be `routed_to = userId` OR engineering_admin/project_admin; else 403 `rfi_not_authorized_to_answer`
  - Status must be `open|in_review`; else 409 `rfi_not_answerable`
  - Update `answer`, `answered_by = userId`, `answered_at = now()`, `status='answered'`
  - Audit `rfi.answered`
- `closeRfi({ rfiId })`
  - Must be `raised_by = userId` OR engineering_admin/project_admin
  - Status must be `answered`; else 409 `rfi_not_closable`
  - Set `status='closed'`, `closed_at=now()`; audit `rfi.closed`
- `voidRfi({ rfiId, reason })` — admin only, audit `rfi.voided`
- `getRfiKpis({ projectId })` — computed from last 90 days:
  - `turnaround_days_avg` = avg(`answered_at - created_at`) where answered
  - `open_count`, `overdue_count` (`status in ('open','in_review')` and `due_date < today`)
  - `pct_on_time` = answered where `answered_at::date <= due_date` / total answered × 100
  - `by_month` = last 6 months → `{ month, raised, answered }` for the mini bar chart

## 3. Query layer — `src/lib/rfi-query.ts`

- `rfiListQueryOptions(projectId, filters)`
- `rfiDetailQueryOptions(rfiId)`
- `rfiKpiQueryOptions(projectId)` (staleTime 60s)
- `routableMembersQueryOptions(projectId)`
- `useRaiseRfiMutation`, `useAnswerRfiMutation` (optimistic on detail cache), `useCloseRfiMutation` — each invalidates list + detail + KPI keys

## 4. Route — `src/routes/_authenticated/projects.$projectId.engineering.rfis.tsx`

- Loader primes list + KPI via `ensureQueryData`
- Layout:
  - Header row: title + "Raise RFI" button
  - `RfiKpiCard` (turnaround, open, overdue, % on-time, Recharts `BarChart` monthly raised vs answered)
  - Filter toolbar: status Select, discipline Select, assignee Select, search input, "Export CSV"
  - `RfiTable` — columns: number, subject (click to open), discipline, priority badge, status badge, routed to, due date (overdue rows highlighted with `text-destructive`), age (days since created)
  - Empty state ("No RFIs raised yet"), skeleton state, error state
- URL search params for filters (typed via `zod` validateSearch)
- Detail opens `RfiDetailDrawer` (sheet) with query/answer thread, answer textarea (visible only to authorized), close button (visible only to raiser/admin), audit-friendly timestamps
- CSV export builds client-side from current filtered rows

## 5. Components — `src/components/engineering/rfis/`

- `RfiKpiCard.tsx` — 4 KPI tiles + Recharts monthly bar (semantic tokens `--chart-*`)
- `RfiTable.tsx` — presentational table with row click
- `RfiFiltersToolbar.tsx`
- `RaiseRfiDialog.tsx` — react-hook-form + zod (`subject 3-140`, `question 10-4000`, priority, discipline, `routedTo uuid`, optional `drawingId`, `dueDate` default +7d via `date-fns/addDays`). Shadcn Datepicker (`pointer-events-auto`)
- `RfiDetailDrawer.tsx` — sheet with question card, answer thread, answer form, close/void controls (role-gated), status/priority badges
- `RfiStatusBadge.tsx`, `RfiPriorityBadge.tsx`

All styling via semantic tokens — no raw hex.

## 6. Navigation

Add "RFIs" tab to `src/routes/_authenticated/projects.$projectId.engineering.tsx` sub-nav between Reviews and BOM.

## 7. Tests — `tests/unit/rfi-rules.test.ts`

Pure helpers extracted to `src/lib/rfi-rules.ts`:

- `nextRfiNumber(existing: string[]) → 'RFI-0001'` sequencing (gaps + zero-pad)
- `isOverdue({ due_date, status })`
- `canAnswer({ role, userId, routed_to, status })`
- `canClose({ role, userId, raised_by, status })`
- `computeKpis(rows, today)` → turnaround, open, overdue, pct_on_time

## Technical details

- Enum reuse: `discipline` reuses existing `drawing_discipline` enum (from P-051), avoiding a new type
- `drawing_id` FK is `on delete set null` so deleting a drawing doesn't cascade RFI history
- `answered_at`/`closed_at` are the audit truth — no separate status_history table (audit_logs already covers transitions)
- `routed_to` remains nullable to accept unrouted RFIs, but raise dialog requires it
- KPI mini-chart uses existing chart tokens from design system
- Optimistic answer patches the detail cache with `answered_at = new Date()` before server round-trip; rollback on error via sonner toast + `queryClient.setQueryData` restore

## Verification checklist (manual after build)

- Raise RFI-0001 → audit row
- Force duplicate number (concurrent insert simulation) → 409 with `rfi_duplicate_number`
- Non-routed member answer attempt → 403
- Routed user answers → status flips to answered
- Overdue row (`due_date` yesterday, still open) highlighted
- Close audited; KPI card matches manual math on seed data
