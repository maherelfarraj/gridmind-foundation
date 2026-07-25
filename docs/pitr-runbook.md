# PITR Verification Runbook

GridMind EPC runs on Lovable Cloud, which retains a rolling point-in-time-recovery (PITR) window on the managed Postgres. This runbook is the **monthly drill** that proves we can actually restore from it.

- **Cadence:** first business Monday of each month.
- **Operator:** on-call platform engineer (see escalation).
- **Duration budget:** ≤ 60 minutes end-to-end.
- **Exit criterion:** a signed row appended to the drill log at the bottom of this file.

## 1 — Pick a restore timestamp

Use **yesterday at 03:00 UTC** as the target. That timestamp is inside the retention window, before the nightly cron sweep at 03:17 UTC, and after peak write hours, so the snapshot is stable.

Record the ISO timestamp you'll use (e.g. `2026-07-24T03:00:00Z`) — you'll need it verbatim in step 5.

## 2 — Trigger the restore in the Lovable Cloud console

1. Open the project in Lovable Cloud → **Advanced settings** → **Point-in-time recovery**.
2. Click **Restore to timestamp**, paste the ISO timestamp from step 1.
3. Choose **"Restore into a new branch/staging project"** — never restore in place. Name the branch `pitr-drill-YYYY-MM-DD`.
4. Wait for the branch to reach **Healthy**. Typical time is 8–20 minutes for our current data volume.

> If the console reports the timestamp is outside the retention window, the drill fails immediately — jump to the escalation section.

## 3 — Connect to the restored branch

The branch appears as a separate project in Lovable Cloud. Open its **SQL editor** (or, if you have local `psql` credentials for it, connect directly). All subsequent queries run **against the restored branch**, never production.

## 4 — Run the verification queries

Paste all four; capture the output verbatim into the drill log.

```sql
-- 4a. Tenant count (must be within ±1% of production baseline)
select count(*) as project_count from public.projects;

-- 4b. Audit trail cardinality (must be ≥ 95% of production count for the same window)
select count(*) as audit_count from public.audit_logs;

-- 4c. Recency check — most recent audit row must be within a few minutes of the restore timestamp
select max(created_at) as latest_audit from public.audit_logs;

-- 4d. Row hash spot-check — pick any known-good project id from production
--     and confirm the same content survived the restore.
select
  encode(
    digest(
      coalesce(name,'') || '|' ||
      coalesce(status::text,'') || '|' ||
      coalesce(company_id::text,'') || '|' ||
      coalesce(created_at::text,''),
      'sha256'
    ),
    'hex'
  ) as row_hash
from public.projects
where id = '<PROD_PROJECT_ID>';
```

Compare `4d` against the hash of the same row in production. They MUST match — mismatch means the restore did not reach the requested timestamp.

## 5 — Record the drill

Append one row to the log table at the bottom of this file. If any query in step 4 failed acceptance, mark **Result = FAIL** and open an incident.

## 6 — Tear down

Delete the `pitr-drill-YYYY-MM-DD` branch from Lovable Cloud → Branches once the drill is logged. Restored branches count against the workspace's project quota and, if left running, will accept writes that nobody reviews.

## Rollback note (real incident, not a drill)

For a real recovery, restore into a **staging branch first**, verify with steps 4a–4d against a known-good production snapshot, and only then promote via the Lovable Cloud console's **Promote branch → production** action. Never restore in place — an in-place restore is destructive and cannot itself be rolled back.

If the failure blast radius is limited to a single table or company, prefer:
1. `audit_logs` reconstruction: pull the missing entities from the restored branch via CSV export → import back into production.
2. Company-scoped restore: use the RLS-scoped export from Cloud → Advanced → Export data on the restored branch, then re-insert into production under the correct `company_id`.

## Escalation

| Failure mode | First contact | Backup |
| --- | --- | --- |
| Restore window unavailable | Platform on-call (PagerDuty rotation `gridmind-platform`) | Cloud vendor support (ticket, P1) |
| Restored branch never reaches Healthy | Platform on-call | Cloud vendor support (ticket, P1) |
| Verification query mismatch | Platform on-call | Data-eng lead |
| Cannot delete branch after drill | Workspace admin | — |

## Drill log

Append newest-first. Never edit an existing row — corrections go in a new row that references the mistaken one.

| Drill date (UTC) | Restore timestamp (UTC) | Operator | Branch name | Result (PASS/FAIL) | Notes |
| --- | --- | --- | --- | --- | --- |
| _yyyy-mm-dd_ | _yyyy-mm-ddThh:mm:ssZ_ | _name_ | _pitr-drill-yyyy-mm-dd_ | _PASS/FAIL_ | _link to incident, deltas, timing_ |
