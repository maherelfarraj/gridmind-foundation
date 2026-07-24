## P-071 — Planning baseline migration (WBS, schedule, baselines, risks)

Single migration + RLS test stub. No UI, no server functions yet (those land in P-072/P-073).

### 1. Migration `supabase/migrations/0032_planning_baseline.sql`

(0031 is taken by procurement extras; renumber to 0032.)

Idempotent SQL block:
- Guarded `do` blocks creating enums `wbs_item_type`, `schedule_task_status`, `risk_status`.
- `create table if not exists` for `wbs_items`, `schedule_tasks`, `baseline_snapshots`, `risks` — schemas exactly as specified (FKs to `companies`, `projects`, `profiles`, `currencies`; CHECKs on schedule dates/progress and risk P×I; `risks.score` as `generated always as (probability * impact) stored`).
- Attach existing `public.set_updated_at()` BEFORE UPDATE trigger to all four tables (guarded with `drop trigger if exists`).
- `alter table ... enable row level security` for all four.
- Policies exactly as specified: `wbs_select/wbs_write`, `sched_select/sched_write`, `baseline_select/baseline_write`, `risks_select/risks_write` — all using `is_company_member` + `has_company_role(...)` combinations.
- GRANTs: `SELECT` on all four to `authenticated`; `INSERT, UPDATE, DELETE` on `wbs_items` and `schedule_tasks`; `INSERT, UPDATE` only on `baseline_snapshots` and `risks` (no DELETE — append-only guarantee). `GRANT ALL` on all four to `service_role`.
- Indexes: `wbs_project_idx`, `sched_project_idx`, `sched_wbs_idx`, `baseline_project_idx`, `risks_project_idx`.

All `create policy` statements wrapped with `drop policy if exists` so re-running is clean.

### 2. RLS test stub `tests/rls/planning-baseline.rls.test.ts`

Vitest skeleton mirroring `tests/rls/rfq-core.rls.test.ts` — `describe.skip` blocks for cross-tenant SELECT = 0 rows on each of the four tables, so future wiring has a shape to fill in.

### 3. Verification checklist

- Migration runs twice cleanly (guarded enums/policies/triggers).
- `supabase--linter` clean for the new tables.
- Read-query sanity: RLS enabled on all 4; `unique(project_id, code)` on `wbs_items`; no DELETE grant on `baseline_snapshots`/`risks`; `risks.score` is a generated column (insert P=4/I=3 sample → 12, then rollback).
- Types file regenerated after apply.

### Deferred to later prompts (per spec)
- WBS builder UI → P-072.
- Server functions (`createServerFn` + zod + `requireSupabaseAuth` + `writeAuditLog` for `wbs.create`, `schedule_task.update`, `baseline.lock`, `risk.create`), cycle validation for `predecessor_ids`, locked-baseline immutability check → P-073.
