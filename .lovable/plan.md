# P-105 — Alarm rules engine

## 1. Migration (new timestamped file, P-103 domain)

Migrations are timestamped, so this is a new file (spec's "append to 0048" is naming intent). Creates:

- Enums (guarded do-blocks): `alarm_severity`, `alarm_condition`, `alarm_status`.
- `alarm_rules` — company_id, project_id (nullable = company-wide), name, metric, condition, threshold, dead_band, duration_seconds, severity, escalation_route jsonb, enabled, created_by, timestamps.
- `scada_alarms` — company_id, project_id, scada_asset_id, rule_id, severity, message, value, status, raised_at, acknowledged_{by,at,note}, cleared_at, escalation_level, timestamps.
- Indexes: `(company_id, status, severity, raised_at desc)` and `(project_id, raised_at desc)`.
- RLS on both. Policies exactly per spec. GRANTs: SELECT on both to authenticated; INSERT/UPDATE/DELETE on `alarm_rules` to authenticated; UPDATE only on `scada_alarms` to authenticated (raises are service-side via `service_role`); `GRANT ALL ... TO service_role` on both.
- `set_updated_at` trigger on both.

## 2. Server: rules + evaluator

- `src/lib/alarms.rules.ts` — pure: `evaluateCondition(condition, value, threshold)`, `hasCleared(condition, value, threshold, deadBand)` (hysteresis: value must move past threshold ∓ dead_band in the safe direction), `escalationRouteSchema` (zod: array of `{after_minutes:int>=0, notify_role:app_role}`).
- `src/lib/alarms.functions.ts` (`requireSupabaseAuth`):
  - `listAlarmRules({project_id?})`, `upsertAlarmRule(input)`, `deleteAlarmRule({id})` — role-gated (om_admin | scada_admin | company_admin), zod-validated, audited (`alarm_rule.{created,updated,deleted}`).
  - `listAlarms({status?, severity?, project_id?})` — RLS-scoped.
  - `acknowledgeAlarm({id, note})` — note required (min 3 chars); sets status/acknowledged_{by,at,note}; audit `alarm.acknowledge`.
- `src/lib/alarms.server.ts` — `evaluateAlarmRules(companyId, readings, supabaseAdmin)`:
  - Load enabled rules for company (project_id null OR matching reading's project).
  - For each reading × matching-metric rule: find existing `active` alarm for `(rule_id, scada_asset_id)`.
    - If none and condition breaches: check `duration_seconds` — if 0, raise immediately; else look up prior telemetry rows for asset+metric within window and only raise if all sampled points also breach (simple duration guard using existing telemetry). Insert new alarm via admin client.
    - If exists and `hasCleared`: set `status='cleared'`, `cleared_at=now()`.
    - Else: no-op (no duplicate).
  - `// TODO(B13/P-123): escalation cron advances escalation_level and notifies notify_role.`
- Wire fire-and-forget from `src/routes/api/public/hooks/scada/telemetry.ts` — after batch upsert, call `evaluateAlarmRules(...).catch(logErr)`; do not await response on it (still awaited within request so worker doesn't cancel, but wrapped so failure never fails ingest).

## 3. UI

Both under `_authenticated/`, gated in nav to om_admin/scada_admin/company_admin (read for om_admin/scada_admin; rules CRUD for the three roles). Design tokens only, Recharts unused here, sonner for toasts, TanStack Query.

- `src/routes/_authenticated/om.scada.alarms.tsx` — list with filters (status, severity, project), severity badges (info muted / warning amber / major orange / critical destructive via semantic tokens), columns: raised_at, project, asset, rule, message, value, severity, status, ack meta. Row action "Acknowledge" opens dialog (react-hook-form + zod, mandatory note) → `acknowledgeAlarm`. Skeleton / empty ("No active alarms — plant healthy") / error+retry.
- `src/routes/_authenticated/om.scada.alarm-rules.tsx` — table + create/edit sheet. Form (rhf+zod): name, project (optional), metric (select from known metrics), condition, threshold, dead_band, duration_seconds, severity, enabled, and an escalation-route repeatable list (`after_minutes` int + `notify_role` select from app_role enum). Delete confirm. All mutations audited server-side.
- `src/lib/nav-map.ts` — add "Alarms" and "Alarm rules" entries under om_scada.

## 4. Tests

`tests/unit/alarms.test.ts` — `evaluateCondition` all 6 ops, `hasCleared` hysteresis for lt/gt with dead_band (breach at 90 vs threshold 100 → active; value 105 inside dead_band 20 → not cleared; value 125 past → cleared), `escalationRouteSchema` accepts/rejects.

## 5. Verification checklist (post-approval)

- Create rule `ac_power_kw lt 100`, severity major, dead_band 20, duration 60s, escalation `[{after_minutes:30, notify_role:om_admin}]`.
- Push breaching telemetry → single active alarm; repeat push → no duplicate.
- Push 105 → still active; push 125 → cleared.
- Ack without note rejected; with note → audited row in `audit_logs` action `alarm.acknowledge`.
- Attempt direct INSERT into `scada_alarms` as authenticated → denied (grant is UPDATE only).
- Confirm TODO(B13/P-123) marker present.

## Technical notes

- Duration guard is best-effort using existing telemetry samples (no per-rule scheduler yet); documented alongside the escalation TODO.
- `evaluateAlarmRules` uses `supabaseAdmin` loaded inside the hook handler (already imported there) so RLS doesn't block service-side raises.
- Nav gating uses existing `nav-map.ts` role predicates; no new role plumbing.
