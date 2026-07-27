# GridMind EPC — Operations Runbook (Day 2)

This runbook governs on-call operations after go-live. It complements `docs/launch-checklist.md`,
`docs/operator-env.md`, and `docs/pitr-runbook.md`. Use it during incidents and for weekly on-call handoff.

---

## 1 — On-Call Overview & Severity Definitions

On-call rotates weekly. The on-call engineer owns triage and initial response for all alerts routed
from `/admin/ops-alerts`, `/admin/health`, `/admin/performance`, and `/admin/slo`.

| Severity | Definition | Examples | Initial Response Target |
| -------- | ---------- | -------- | ------------------------ |
| **SEV-1** | Full or near-full outage; data integrity at risk; customer-facing breakage across all tenants | DB unreachable, public hooks failing 100%, auth down | Acknowledge in 5 min, engage Engineering Lead |
| **SEV-2** | Major degradation for a subset of tenants or a critical workflow | Cron fleet stalled, SCADA ingestion gap > 1h, finance alert storm masking a real issue | Acknowledge in 15 min |
| **SEV-3** | Minor degradation, workaround available, single feature impacted | Slow queries on one dashboard, non-critical cron delayed | Acknowledge in 1 business hour |
| **SEV-4** | Cosmetic or informational, no user impact | Threshold noise, stale but non-critical metric | Track in backlog, no page |

---

## 2 — Escalation Contacts

Fill in before go-live; keep current. Do not store secrets here.

| Role | Name | Contact | Timezone |
| ---- | ---- | ------- | -------- |
| On-Call Engineer (primary) |  |  |  |
| On-Call Engineer (secondary) |  |  |  |
| Engineering Lead |  |  |  |
| Security Owner |  |  |  |
| Operations Owner |  |  |  |
| Database Owner |  |  |  |
| Customer Success Lead |  |  |  |

---

## 3 — Incident Response Workflow

1. **Detect** — alert fires via `/admin/ops-alerts`, `/admin/health`, `/admin/slo`, or a customer report.
2. **Acknowledge** — claim the incident within the severity's response target; open an incident channel.
3. **Assess severity** — assign SEV-1..4 using §1; escalate per §2 if SEV-1/2.
4. **Mitigate** — apply the relevant playbook in §4. Prefer config-only rollback (§5) before code rollback.
5. **Communicate** — status update every 30 min for SEV-1, hourly for SEV-2, on resolution for SEV-3/4.
6. **Resolve** — confirm signal returns to baseline on `/admin/health` / `/admin/performance` / `/admin/slo`.
7. **Record** — log the incident in `audit_logs` context if applicable, and complete the post-incident
   review (§6) within 2 business days for SEV-1/2.

---

## 4 — Playbooks

### 4.1 Public Hook 401/403 Spike

**Signal:** `/admin/health` shows a spike in `public_hook.ip_denied` or `public_hook.signature_failed`.

1. Check `/admin/health` for the affected integrator/IP pattern.
2. Cross-reference `audit_logs` for the denial reason:
   ```sql
   select created_at, action, metadata
     from public.audit_logs
    where action like 'public_hook.%'
      and created_at > now() - interval '1 hour'
    order by created_at desc;
   ```
3. If a known integrator: confirm `PUBLIC_HOOK_IP_ALLOWLIST` contains their CIDR, or that their signing
   key hasn't been rotated without notice.
4. If traffic looks hostile (unknown IP, malformed signatures, high volume): leave denied, monitor for
   escalation, consider tightening `PUBLIC_HOOK_IP_ALLOWLIST` further.
5. If this follows a warn→block promotion, temporary rollback: set `PUBLIC_HOOK_ENFORCE=warn` in the
   Lovable Cloud secret store and redeploy (see `docs/launch-checklist.md` §2). No code change required.
6. Do not disable signature verification entirely except as a last-resort SEV-1 mitigation with
   Security Owner sign-off.

### 4.2 Cron Fleet Stale or Missing Runs

**Signal:** `/admin/health` or `/admin/ops-alerts` shows a cron job with no recent run.

1. Confirm the expected schedule against `docs/operator-env.md` (`escalations */5 * * * *`,
   `pm-work-orders */15 * * * *`, `scheduled-reports */15 * * * *`, `audit-retention 17 3 * * *`,
   `webhook-dispatch */5 * * * *`).
2. Check the last successful run:
   ```sql
   select job_name, max(created_at) as last_run
     from public.audit_logs
    where action like 'ops.cron_%'
    group by job_name
    order by last_run;
   ```
3. Verify `CRON_APIKEY` / `SUPABASE_ANON_KEY` used by pg_cron has not expired or rotated without
   updating the scheduler.
4. Manually trigger the affected endpoint once (e.g. `/api/public/cron/audit-retention`) to confirm the
   handler itself is healthy, then re-check pg_cron's schedule registration.
5. If the handler errors, check application logs for the specific `src/routes/api/public/cron/*.ts` handler.
6. Re-register the pg_cron schedule if it was dropped; do not change job intervals without Operations
   Owner approval.

### 4.3 Database Saturation / Slow Queries

**Signal:** `/admin/performance` shows memory > 80%, disk > 70%, connections > 45 (warn) / 60 (critical),
or WAL > 1GB.

1. Check `/admin/performance` for the specific resource and trend (spike vs. sustained).
2. Identify long-running or blocking queries:
   ```sql
   select pid, now() - query_start as duration, state, query
     from pg_stat_activity
    where state != 'idle'
    order by duration desc
    limit 20;
   ```
3. For connection saturation, check for connection leaks in recently deployed code paths; consider
   killing idle-in-transaction sessions older than 10 minutes:
   ```sql
   select pg_terminate_backend(pid)
     from pg_stat_activity
    where state = 'idle in transaction'
      and now() - state_change > interval '10 minutes';
   ```
4. For WAL growth, check replication slots and PITR archiving are not stalled (see `docs/pitr-runbook.md`).
5. For disk > 70%, check `/api/public/cron/storage-check` results and audit log retention job status; do not
   manually delete data outside retention policy.
6. If sustained saturation persists after mitigation, escalate to Database Owner and consider a
   maintenance-window scale-up.

### 4.4 SCADA Telemetry Gap

**Signal:** SCADA ingestion cron stale, or `/admin/health` shows a telemetry freshness alert.

1. Confirm the ingestion cron (`/api/public/cron/ingestion-retry` or equivalent) last ran successfully.
2. Check for a gap in telemetry timestamps:
   ```sql
   select site_id, max(recorded_at) as last_reading
     from public.telemetry_readings
    group by site_id
    order by last_reading;
   ```
3. Determine if the gap is source-side (SCADA/gateway offline) or platform-side (ingestion handler
   failing). Check ingestion retry logs and dead-letter entries if present.
4. If source-side, notify the field engineering team to check gateway connectivity on affected sites.
5. If platform-side, re-run `/api/public/cron/ingestion-retry` manually and monitor for backfill.
6. Once resumed, verify no duplicate or out-of-order readings were introduced.

### 4.5 Finance Alert Storm

**Signal:** A burst of finance alerts (budget overrun, invoice mismatch, cash-flow threshold) fires in
a short window, often from a single upstream cause.

1. Check `/admin/ops-alerts` for the common root cause (e.g. a bulk import, a currency/rate update, or
   a bad batch job).
2. Confirm whether this is a real financial event or a data-quality issue:
   ```sql
   select company_id, action, count(*)
     from public.audit_logs
    where action like 'finance.%alert%'
      and created_at > now() - interval '1 hour'
    group by company_id, action
    order by count(*) desc;
   ```
3. If caused by a bad batch/import, pause the source job and coordinate with the Finance Controller
   persona before reprocessing.
4. If it is a genuine spike (e.g. multiple budgets crossing threshold together), let it stand and
   notify Operations Owner — do not suppress alerts to "clear the noise."
5. Do not bulk-dismiss alerts without recording the reason in `audit_logs` context.

---

## 5 — Rollback Procedures

### Config-only rollback (preferred, no deploy)
Used for: `PUBLIC_HOOK_ENFORCE`, `PUBLIC_HOOK_IP_ALLOWLIST`, cron schedule intervals, feature flags.

1. Change the value in the Lovable Cloud secret store / environment config.
2. Redeploy is only required if the value is read at build time; most guard/env values are read at
   runtime and take effect immediately or on next request.
3. Verify the change took effect via `/admin/health` or a live curl check (see `docs/launch-checklist.md` §2).

### Full redeploy rollback
Used for: a bad code deploy causing SEV-1/2 impact.

1. Identify the last known-good release/commit.
2. Redeploy that commit through the standard deploy pipeline.
3. Confirm `bun run test:all` passed on that commit before it originally shipped (check CI history).
4. After rollback, re-verify `/admin/health`, `/admin/performance`, and the E2E smoke golden path
   (login → project wizard → phase gate → PO approve → proposal PDF → audit verification).
5. Do not roll back a database migration as part of an application rollback without Database Owner
   sign-off; migrations are generally forward-only. If schema rollback is unavoidable, follow
   `docs/pitr-runbook.md`.

---

## 6 — Post-Incident Review Template

Complete within 2 business days of SEV-1/SEV-2 resolution; optional for SEV-3, skip for SEV-4.

```
## Incident: <short title>
Date/Time (UTC):
Severity: SEV-
Duration (detect → resolve):
Detected by: (alert / customer report / on-call)

### Summary
What happened, in 2-3 sentences.

### Impact
Tenants/users affected, data integrity impact (if any), customer communication sent (Y/N).

### Timeline
- HH:MM — event
- HH:MM — event

### Root Cause

### Mitigation Applied
(link to playbook used, config or code changes)

### What Went Well

### What Went Poorly

### Action Items
| Action | Owner | Due Date |
| ------ | ----- | -------- |
|        |       |          |
```
