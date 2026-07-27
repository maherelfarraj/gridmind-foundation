# GridMind EPC — Day 2 Operational Decisions

This log records the operational defaults chosen for Day 2 readiness (capacity thresholds, alert
severity mapping, and SLO targets). These values back the alerts surfaced on `/admin/health`,
`/admin/performance`, `/admin/ops-alerts`, and `/admin/slo`.

**These are operational defaults, not fixed contracts.** They may be tuned by the Operations Owner
as real production load data accumulates. Any change should be recorded as a new dated entry below —
do not silently edit historical entries.

---

## Capacity Thresholds

| Metric | Warn | Critical | Notes |
| ------ | ---- | -------- | ----- |
| Memory usage | > 80% | — | Sustained over a rolling window, not instantaneous spikes |
| Disk usage | > 70% | — | Correlate with `/api/cron/storage-check` results |
| DB connections | > 45 | > 60 | See `docs/ops-runbook.md` §4.3 for mitigation |
| WAL size | > 1 GB | — | Correlate with PITR archiving health (`docs/pitr-runbook.md`) |
| Rollback rate | > 100 / hr | — | Application-level transaction rollbacks; investigate query patterns |

## Alert Severity Mapping

| Alert Source | Condition | Mapped Severity |
| ------------ | --------- | ---------------- |
| `/admin/health` | DB unreachable, auth failure across all tenants | SEV-1 |
| `/admin/health` | Public hook denial spike, cron fleet stalled fleet-wide | SEV-2 |
| `/admin/performance` | DB connections > 60, WAL > 1GB sustained | SEV-2 |
| `/admin/performance` | Memory > 80% or disk > 70%, single-tenant slow query | SEV-3 |
| `/admin/ops-alerts` | Finance alert storm with unclear root cause | SEV-2 |
| `/admin/ops-alerts` | Individual finance/budget threshold alert | SEV-3/SEV-4 |
| `/admin/slo` | SLO breach on a critical path (see below) | SEV-2 |
| `/admin/slo` | SLO breach on a non-critical path | SEV-3 |

See `docs/ops-runbook.md` §1 for full severity definitions and §4 for playbooks.

## SLO Targets

| Service / Path | Target | Window |
| --------------- | ------ | ------ |
| Public hook API availability | 99.9% | 30-day rolling |
| Public hook API p95 latency | < 500ms | 30-day rolling |
| Core app availability (auth, dashboards) | 99.9% | 30-day rolling |
| Cron job success rate | 99.5% | 7-day rolling |
| SCADA telemetry freshness | < 15 min gap | 24-hour rolling |
| Database query p95 (transactional paths) | < 300ms | 7-day rolling |

---

## Decision Log

| Date | Decision | Rationale | Owner |
| ---- | -------- | --------- | ----- |
| Day 2 launch | Adopted thresholds and SLOs above as initial operational defaults | Establish a baseline before real production traffic patterns are known | Operations Owner |

_Add new rows above for future tuning decisions; never edit existing rows._
