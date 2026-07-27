Day 2 — Health & Observability is green. Now we expand from "is it alive?" to "is it operational, performant, secure, and ready for users?".

Goal: Deliver a production-ready operational layer covering operations readiness, performance/capacity, security/audit hardening, user acceptance polish, expanded observability, and consolidated runbooks.

Scope
- Build on existing Day 1 assets: `/admin/health`, `finance/alerts`, `om/scada/ingestion-health`, cron routes, `docs/operator-env.md`, `docs/launch-checklist.md`, `docs/pitr-runbook.md`.
- Use existing stack: TanStack Start, createServerFn, Supabase/Lovable Cloud, Tailwind v4 semantic tokens.
- Keep the public-hook guard untouched; only add observability around it.

Phases

Phase 1 — Operations readiness
1. On-call rotation & ownership model
   - Add `on_call_rotations` table (optional) or document the current owner roster in `docs/ops-runbook.md`.
   - Define severity levels (SEV-1/2/3/4) and response-time SLAs.
2. Alert routing layer
   - Extend `finance_alert_rules` / `finance_alerts` pattern to a generic `ops_alert_rules` table (rule_type, threshold, notify_role, enabled).
   - Build `/admin/ops-alerts` UI for triage, ack, dismiss, rule config.
   - Add server functions: `getOpsAlerts`, `actOnOpsAlert`, `saveOpsAlertRule`.
3. Health dashboard extensions
   - Add `/admin/health` signals: DB rolled-back transaction rate, PgBouncer saturation, public-hook 401/403/429 trends, ingestion dead-letter queue depth, cron staleness per job.
   - Add a "today's incidents" card sourced from a new `ops_incidents` table (or manual rows via UI).
4. Cron fleet observability
   - Ensure every cron route writes a structured `audit_logs` row on start/success/failure with `duration_ms`.
   - Add `/admin/health` cron grid with last-run status, next-run ETA, failure count.

Phase 2 — Performance & capacity
1. Performance cockpit
   - Add `/admin/performance` route with KPIs: slow query count, p95 query time, rolled-back tx rate, connection saturation, top N tables by size.
2. Slow-query review & indexes
   - Use `supabase--slow_queries` output; target the recurring DELETE patterns (likely RLS test cleanup) and heavy SELECTs used by dashboards.
   - Add targeted `CREATE INDEX` migrations where EXPLAIN confirms benefit.
3. Capacity thresholds
   - Define warn/crit thresholds (memory >80%, disk >70%, connections >45, WAL >1GB, rolled-back tx >100/hour).
   - Surface them as signals on `/admin/health` and as ops alert rules.
4. Load test strategy
   - Add `tests/load/README.md` with a k6/Playwright-based smoke script for the golden path (login → project wizard → PO approve → proposal PDF).
   - Do not run production load tests from the plan; document the harness and a safe staging procedure.

Phase 3 — Security & audit hardening
1. Security-finding triage
   - Load `security--run_security_scan` results (currently 67 findings, mostly SECURITY DEFINER warnings).
   - Categorize: true positives to fix, expected behavior to document/ignore, false positives to record in security memory.
2. Function hardening
   - For each `SECURITY DEFINER` function that must stay callable, ensure it has `set search_path = public` and an explicit `GRANT EXECUTE` only to required roles.
   - Move helper-only functions out of the public schema or revoke `EXECUTE` from `anon`/`authenticated`.
3. Access certification
   - Add `/admin/access-review` UI listing active users, roles, and company memberships; allow export CSV.
   - Add server function `getAccessReview` (super-admin scoped).
4. Audit coverage gaps
   - Verify `audit_logs` writes on: role grants, API key rotation, webhook endpoint enable/disable, finance period open/close, export lock/unlock.
   - Add missing triggers/RPC wrappers where absent.

Phase 4 — User acceptance & feature polish
1. UAT checklist
   - Create `docs/uat-checklist.md` covering core personas: EPC admin, project manager, procurement, finance, field engineer, vendor, client.
2. Bug bash workflow
   - Add `/admin/feedback` lightweight issue capture (category, severity, screenshot URL) writing to `ops_feedback` table.
   - Define triage labels and owner assignment.
3. Final UX gaps
   - Review mobile-first pages (`/timesheets`, vendor portal) for offline queue visibility and error retry states.
   - Add empty-state illustrations and loading skeletons where missing.

Phase 5 — Expanded observability
1. SLO/SLI dashboard
   - Add `/admin/slo` route: availability (uptime proxy via cron probe success), p95 auth/login latency, SCADA ingestion freshness, finance alert triage time.
2. Dead-letter & retry monitoring
   - Surface `ingestion_dead_letter` and `ingestion_retry_queue` counts on `/admin/health` and `/om/scada/ingestion-health`.
   - Add retry-all / purge buttons for authorized roles.
3. Telemetry quality
   - Add SCADA tag heartbeat checks (last received per connector) and staleness alerts.
4. Synthetic checks
   - Add a `/api/public/healthz` unauthenticated endpoint returning core dependencies (DB, cron probe timestamp). Avoid PII.

Phase 6 — Runbook documentation
1. Consolidate existing docs
   - Keep `docs/operator-env.md`, `docs/launch-checklist.md`, `docs/pitr-runbook.md`, `docs/public-api-signing.md`.
   - Add `docs/ops-runbook.md` as the central index: on-call, incident response, escalation contacts, rollback procedures.
2. Incident response playbooks
   - Public hook 401/403 spike: check `PUBLIC_HOOK_ENFORCE`, allowlist, signing secret, API key status.
   - Cron fleet stale: check `pg_cron` launcher, job schedules, route handler logs.
   - DB saturation: check slow queries, connection count, PgBouncer pool, rollback rate.
   - SCADA telemetry gap: check connector status, ingestion dead letter, HMAC secret.
3. Decision records
   - Add a `docs/ops-decisions.md` log for every Day 2 configuration choice (thresholds, retention, escalation policy).

Deliverables
- New routes: `/admin/ops-alerts`, `/admin/performance`, `/admin/access-review`, `/admin/slo`, `/admin/feedback`, `/api/public/healthz`.
- New tables/migrations: `ops_alert_rules`, `ops_alerts`, `ops_incidents`, `ops_feedback`, `ops_slo_snapshots` (or reuse existing `audit_logs` + materialized views where possible).
- New server functions: `getOpsAlerts`, `actOnOpsAlert`, `saveOpsAlertRule`, `getPerformanceSignals`, `getAccessReview`, `getSloDashboard`, `submitFeedback`, `getHealthz`.
- Updated docs: `docs/ops-runbook.md`, `docs/ops-decisions.md`, `docs/uat-checklist.md`, updates to `docs/launch-checklist.md`.
- Updated `/admin/health` with new signal cards and cron grid.
- Tests: unit tests for new pure logic, RLS tests for new tables, API tests for `/api/public/healthz`.

Success criteria
- `/admin/health` loads with no errors and shows all new signal cards.
- Every cron route writes structured `audit_logs` with duration.
- `/admin/ops-alerts` can create a rule, raise an alert (via seed or cron), and mark it ack/dismiss.
- `security--run_security_scan` true positives are reduced or documented with accepted-risk reasoning.
- `docs/ops-runbook.md` contains incident response playbooks for the five critical scenarios above.
- `bun run test` and `bun run test:all` remain green (current baselines: 1800+ tests).

Risks & dependencies
- Lovable Cloud scheduled functions vs `pg_cron`: keep cron routes unchanged; observability only reads `audit_logs` so the clock source does not matter.
- Security scan findings may include acceptable warnings (e.g., intentionally public helper functions); we will document accepted risks rather than blindly revoke access.
- Performance work may expose that some slow queries are test-suite artifacts; we will confirm with EXPLAIN before adding indexes.
- Rollback transactions at 5,480 since boot need investigation; we will add a signal to track whether this is sustained or a test artifact.