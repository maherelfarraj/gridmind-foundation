## P-107 — Preventive maintenance plans + auto-WO generation

Wires the ≥80% PM ratio (P-106 KPI) into the product by default: PM plans schedule themselves, a cron endpoint auto-creates preventive WOs on their due date, and a manual "Generate now" runs the same logic for testing.

### 1. Migration (append) — `supabase/migrations/0049_work_orders_pm.sql`

Guarded `pm_frequency` enum + `preventive_maintenance_plans` table exactly as specified (company/project/equipment scoped, checklist JSONB, next_due_date, interval_days, auto_generate, active). Order per template: CREATE → GRANT → ENABLE RLS → policies. Attach `set_updated_at()` trigger. Index `(company_id, active, auto_generate, next_due_date)` for the cron scan.

### 2. Rules — `src/lib/pm-plans.rules.ts` (pure)

- `PM_FREQUENCIES` const + type.
- `frequencyToDays()` mapping (weekly=7, monthly=30, quarterly=90, semiannual=180, annual=365).
- `pmChecklistStepSchema` `{ step: string, required: boolean }`.
- `pmPlanUpsertSchema` (create + update via optional `id`) with `superRefine`: `interval_days` positive, checklist ≤ 50 steps, `next_due_date` ISO date, `estimated_hours` ≥ 0.
- `pmPlanToggleSchema` `{ id, active }`.

### 3. Server helpers — `src/lib/pm-plans.server.ts`

`generatePmWorkOrders({ supabase, companyId, actorId, planId? })`: shared idempotent engine used by BOTH the cron route (with service-role client) and the "Generate now" server fn (with authed client). Returns `{ generated, skipped, plans: [{plan_id, wo_id?, reason?}] }`.
- Selects `preventive_maintenance_plans` where `active AND auto_generate AND next_due_date <= current_date` (scoped by `companyId` when passed; cron passes null to scan all).
- Idempotency guard: skip if any `work_orders` row exists with `source='pm_plan'`, same `equipment_id` (or null), same `title`, and `due_date = plan.next_due_date`, in statuses `('open','assigned','in_progress','on_hold','completed')`.
- Otherwise: generate `wo_number` via existing `generateWoNumber(supabase, companyId)`; insert WO (type='preventive', source='pm_plan', description = plan.description + newline-joined `- [ ] step (required)` checklist), then `update` plan `next_due_date = next_due_date + interval_days*day`, `last_generated_at = now()`.
- Wrapped in per-plan try/catch so one failure doesn't halt the batch.

### 4. Server functions — `src/lib/pm-plans.functions.ts`

All use `attachSupabaseAuth` + `requireSupabaseAuth`, `currentCompanyId()`, `assertWriter()` (om_admin | company_admin), and `audit()` helper — same pattern as `work-orders.functions.ts`.

- `listPmPlans({ project_id? })` — SELECT with joins to `equipment_registry(tag)`, `projects(name)`, `profiles!default_assignee(full_name,email)`; also computes `days_until_due` client-side.
- `getPmPlan({ id })`.
- `upsertPmPlan(input)` — insert or update; audits `pm_plan.create` / `pm_plan.update`.
- `togglePmPlan({ id, active })` — audits `pm_plan.toggle`.
- `deletePmPlan({ id })` — audits `pm_plan.delete` (om_admin only).
- `generateNowPmPlans({ plan_id? })` — runs the shared engine using `context.supabase` (RLS as caller — company_admin/om_admin only); audits `pm.generate` with `{ generated, plan_id? }`.

### 5. Cron route stub — `src/routes/api/cron/pm-generate.ts`

POST-only server route. `// TODO(B13/P-123): wrap in guardPublicHook + register pg_cron schedule (daily 05:00 UTC).` Minimal auth: `apikey` header must equal `process.env.SUPABASE_SERVICE_ROLE_KEY` (temporary, will move to `guardPublicHook`); otherwise `401`. Loads `supabaseAdmin` inside the handler (`await import('@/integrations/supabase/client.server')`), invokes the shared engine with a null companyId (all tenants), records a summary via `write_audit_log` per company that generated ≥1 WO, and returns `{ generated }`.

### 6. UI

**Route** `src/routes/_authenticated/om.maintenance-plans.tsx`:
- Header: "PM plans" + "Generate now (all due)" button (calls `generateNowPmPlans()`) + `<CreatePmPlanDialog />`.
- KPI strip: "N due today", "N due in 7d", "N inactive".
- Table: plan title, project · equipment tag (or "Project-wide" badge), frequency, `next_due_date` with countdown Badge (destructive if overdue, warning if ≤7d), `last_generated_at`, `default_assignee`, active `Switch` (calls `togglePmPlan`), row actions (Edit, Generate this plan, Delete).
- Skeleton/empty ("No preventive plans — schedule your first plan")/error-with-retry states per existing pattern.
- Head metadata: unique title, description, og:title, og:description.

**Dialog** `src/components/pm-plans/pm-plan-dialog.tsx` (create + edit):
- Project + equipment (equipment optional; blank = project-wide).
- Frequency Select → auto-populates `interval_days` (still editable in advanced input).
- `next_due_date` date input.
- Checklist editor (useFieldArray): step text + `required` switch, add/remove.
- Estimated hours, default assignee (reuses `listAssignees`).
- Auto-generate + active toggles.
- On save → `upsertPmPlan` → invalidates `["pm-plans"]` + `["wo-kpis"]`.

**Nav** — add `{ moduleKey: "om_scada", label: "PM plans", url: "/om/maintenance-plans", icon: CalendarClock }` in `src/lib/nav-map.ts` (after Work orders).

### 7. Tests

- `tests/unit/pm-plans.test.ts`:
  - `frequencyToDays` mapping.
  - `pmPlanUpsertSchema`: rejects empty title, rejects >50 checklist steps, accepts a minimal plan.
  - Pure idempotency-key builder (extracted small helper `pmWoLookupKey(plan)` → object) so we can test the shape.
- `tests/rls/pm-plans.rls.test.ts`: skipped stub in same shape as `work-orders.rls.test.ts` — tenant isolation, om_admin write, non-writer roles blocked, technician read-only, unique WO-number under retry.

### 8. Acceptance walk-through (manual, after ship)

1. Create "Inverter quarterly inspection" for INV-01-01, quarterly (auto-fills 90d), 4-step checklist, next due yesterday.
2. Click "Generate now" → preventive WO appears in `/om/work-orders`, source='pm_plan', checklist rendered in description; next_due advances +90d; `last_generated_at` populated. Second click generates 0 (idempotent).
3. Generated WO closed → counts toward P-106 PM:CM ratio.
4. Non-writer role: buttons hidden, direct RPC returns `forbidden_role`.
5. Every create/update/toggle/delete + generation appears in `audit_logs`.

### Technical notes

- No new secrets; the cron stub uses `SUPABASE_SERVICE_ROLE_KEY` (already available server-side) — the B13/P-123 follow-up replaces it with the shared `guardPublicHook` middleware and registers the `pg_cron` schedule.
- Engine is a plain helper (not a `.functions.ts` export) so it can accept either the authed or admin Supabase client, keeping cron/service-role logic OUT of `.functions.ts` module-scope.
- `default_assignee` FK is `on delete set null` implicitly via cascade rules? No — it's an FK without ON DELETE, so the plan blocks profile deletion. That matches other tables in this schema and is fine.
- No mutation to P-106 files beyond the nav-map insert.
