## P-106 — Work Orders + PM/CM KPIs

### Migration: `supabase/migrations/0049_work_orders_pm.sql`

- Enums via guarded `do $$ ... $$` blocks: `work_order_type`, `work_order_priority`, `work_order_status`.
- Table `public.work_orders` per spec (company_id, project_id, equipment_id, wo_number, title, description, type, priority, status, assigned_to, scheduled_date, due_date, parts jsonb, labor jsonb, total_cost, currency_code, failure_cause, resolution_notes, source, completed_at, closed_at, created_by, timestamps, `unique(company_id, wo_number)`).
- RLS enabled with three policies: `wo_select` (member), `wo_write` (om_admin/company_admin FOR ALL), `wo_technician_update` (assignee-only UPDATE).
- GRANT select/insert/update/delete to `authenticated`; service_role ALL.
- Indexes: `(company_id,status,priority)`, `(project_id,type,status)`, `(assigned_to,status)`.
- Attach `set_updated_at()` BEFORE UPDATE trigger.

### Server layer

Split per `tanstack-serverfn-splitting` — helpers in `.server.ts`, thin `createServerFn` wrappers in `.functions.ts`.

- `src/lib/work-orders.rules.ts` — pure schemas + math:
  - `partLineSchema`, `laborLineSchema`, `workOrderCreateSchema`, `workOrderAssignSchema`, `workOrderStatusSchema`, `workOrderCloseSchema` (requires `resolution_notes`; `failure_cause` required when `type='corrective'`).
  - `computeTotalCost(parts, labor)` = Σ qty×unit_cost + Σ hours×rate (Decimal-safe, 2dp).
  - Allowed status transition map (open→assigned→in_progress↔on_hold→completed→closed; cancelled from any non-closed).
- `src/lib/work-orders.server.ts` — helpers: `generateWoNumber(admin, companyId)` (`WO-YYYY-NNNN` with per-company sequence via SELECT max + insert; retry on unique conflict), `assertCanTransition`, `assertCanCloseCorrective`.
- `src/lib/work-orders.functions.ts` — `requireSupabaseAuth`-gated:
  - `listWorkOrders({ projectId?, status?, assignee?, q? })`
  - `getWorkOrder({ id })`
  - `createWorkOrder(input)` → mints wo_number, audits `work_order.create`.
  - `assignWorkOrder({ id, assigned_to })` — om_admin/company_admin only; audits `work_order.assign`.
  - `updateWorkOrderStatus({ id, status })` — RLS enforces technician-only-own; server also re-checks role vs transition; sets `completed_at`/`closed_at`; audits `work_order.status`.
  - `captureParts({ id, parts })` / `captureLabor({ id, labor })` — recompute `total_cost` server-side; techs can update own row via RLS.
  - `closeWorkOrder({ id, resolution_notes, failure_cause? })` — validates required fields, transitions completed→closed, audits `work_order.close`.
  - `getWorkOrderKpis({ projectId? })` — PM:CM ratio (closed trailing 90d) + MTTR (avg completed_at−created_at hrs over closed corrective).

All mutations call `writeAuditLog`.

### UI

- `src/routes/_authenticated/om.work-orders.tsx` — landing with KPI header strip + view toggle (Kanban / Table).
  - KPI tiles: **PM:CM ratio** (preventive ÷ (prev+corr), target ≥80%, progress bar, destructive when <80%) and **MTTR** (hours, 1dp). Null-safe empty states ("No closed work orders in the last 90 days").
  - Kanban: six columns (open, assigned, in_progress, on_hold, completed, closed) using existing dnd primitive (or lightweight HTML5 DnD if none present — will confirm during build). Cards show WO#, title, priority badge (emergency = destructive), assignee avatar (initials), due date (destructive when overdue). Optimistic status update + sonner toast + rollback on error.
  - Table view: search, filter chips, CSV export (`src/lib/csv.ts` if present, else inline).
  - Card click → detail drawer route param `?wo=<id>`.
- `src/components/work-orders/work-order-drawer.tsx` — react-hook-form + zod:
  - Header: WO#, status, priority, assignee.
  - Sections: Details, Assign (om_admin only), Parts (line editor with spare_parts combobox → prefills description + unit_cost), Labor (user picker, hours, rate, date), Close (resolution_notes + failure_cause when corrective).
  - Total cost read-only, refreshed from server response.
- `src/components/work-orders/create-work-order-dialog.tsx` — project, equipment, type, priority, title, description, scheduled/due dates.
- Nav entry in `src/lib/nav-map.ts` under O&M: "Work orders" → `/om/work-orders` (module `om_scada`, roles: om_admin, scada_admin, field_technician, company_admin, project_admin).
- All colors via semantic tokens; priority/status → existing badge variants (destructive/warning/success/muted).

### Tests

- `tests/unit/work-orders.test.ts`:
  - `computeTotalCost` — parts+labor, empty, decimals.
  - Close-flow zod: rejects missing resolution_notes; rejects corrective without failure_cause; accepts valid.
  - Transition guard: valid + invalid arcs.
- `tests/rls/work-orders.rls.test.ts` (stub, existing pattern): member SELECT, non-member denied, technician UPDATE own only, om_admin full write.

### Acceptance checklist mapping

- Create corrective WO for INV-01-01 → create dialog + drag through kanban ✅
- Technician-only-own updates via `wo_technician_update` policy ✅
- Parts+labor capture recomputes total_cost server-side (1×fan cost + 3×$45 = +$135) ✅
- Close blocked without notes; requires failure_cause for corrective; audited ✅
- KPI tiles with null-safe empty states ✅

### Out of scope (for later batches)

- Alarm→WO auto-creation (P-105 hook) and PM plan auto-generation are P-107.
- Spare parts stock decrement on parts capture — flagged as TODO in `captureParts`; wired in P-108 (inventory).
