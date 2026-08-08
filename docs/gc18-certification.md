# GC-18 — Consolidation & Certification Record

Canonical checkpoint: `2c2cc02b4432b92a78c3d28a5911ac71fb87d750`.
All evidence below was executed against this tree. No publication was performed.

## 1. Architecture, module and control map

| Layer | Location | Authoritative data owner |
| --- | --- | --- |
| Deterministic rules (pure) | `src/lib/*.rules.ts` (cashflow, recognition, evm.report, contracts-claims, risk-sim, calendar-governance) | none — pure functions, no I/O |
| Server orchestration | `src/lib/*.server.ts`, `*.functions.ts` (`createServerFn`) | Postgres (Lovable Cloud) |
| HTTP surface | `src/routes/api/**`, public callers under `src/routes/api/public/**` | guarded by `src/lib/public-api/guard.ts` |
| Project cockpits | `src/routes/_authenticated/projects.$projectId.costing.*` | governed snapshot tables |
| Portfolio cockpits | `src/routes/_authenticated/portfolio.costing.*` | consolidated snapshot reads only |
| Packs / exports | `src/lib/*-appendix.server.ts`, `portfolio.costing.pack` | frozen snapshots (never live reads) |

Authoritative-data rule: a governed figure is authoritative only in its frozen
snapshot row (`cashflow_snapshots`, `recognition_snapshots`,
`contract_claim_snapshots`, `evm_reports`, `risk_sim_runs`). Portfolio views,
packs and alerts are derived and never re-compute from live transactions.

## 2. Role / action and RLS-security model

- Roles live only in `user_roles`; checks go through `has_role` /
  `has_company_role` (SECURITY DEFINER, `search_path` pinned).
- Every governed table is company-scoped; RLS predicates are company-membership
  based and enforced by the `tests/rls/policy-lint.test.ts` CI gate.
- `anon` has no EXECUTE on any SECURITY DEFINER routine and no access to
  calendar-governance, risk or costing tables (GC-16e, GC-17b, routine-privilege
  migration).
- Invariants are regression-tested in
  `tests/rls/routine-privilege-invariants.rls.test.ts` and
  `tests/rls/p132-stub-closure.rls.test.ts` (two-tenant probe, 35 tables).

## 3. FX and calculation provenance

- Rates are imported from Frankfurter into `fx_rates` with run provenance in
  `fx_import_runs`; consolidation basis (period-end vs average) is stored on the
  snapshot, so a translated figure is reproducible from stored inputs alone.
- Snapshots carry an MD5 fingerprint of their inputs; recomputation with the same
  inputs is byte-identical (determinism tests in the GC-12..GC-17 unit suites).

## 4. Alert catalog and pack contents

- Alert families are produced by the module rule files and rendered through the
  shared `AlertRegister` (acknowledge → escalate → snooze → unsnooze → resolve →
  reopen, optimistic-concurrency conflicts surfaced accessibly).
- Packs assemble: consolidation table, close matrix, cash curve, exposure
  waterfall, revenue/WIP, contracts & claims, risk/contingency appendices, plus
  the alert register snapshot for the reporting period.

## 5. Migration / deployment / rollback / monitoring / backup

- Ordering is filename-lexicographic; the company-index migration is
  `supabase/migrations/20260808124444_ca598441-5553-4433-b35c-5c4e3cceeca8.sql`,
  followed by `20260808125415_*` and `20260808125516_*` (routine privilege
  hardening).
- Index migration uses `CREATE INDEX IF NOT EXISTS` with deterministic
  `<table>_company_id_idx` naming: re-application is a no-op and cannot collide.
  Catalog state: 424 public indexes include a `company_id` leading column.
- Deployment lock consideration: `CREATE INDEX` (non-concurrent) takes a SHARE
  lock and blocks writes on the target table for its duration. On the current
  data volumes each index built in milliseconds; on materially larger tables the
  build must be scheduled in a maintenance window. Accepted limit: migrations run
  inside a transaction, so `CONCURRENTLY` is not available.
- Write/storage cost: ~4 MB total index footprint; every index is justified by an
  RLS company predicate, so write amplification is accepted in exchange for
  index-backed policy evaluation.
- Runbooks: `docs/ops-runbook.md`, `docs/pitr-runbook.md` (backup/recovery),
  `docs/operator-env.md` (environment), `docs/launch-checklist.md`.

## 6. Accepted-risk register — 131 advisor findings (fresh scan)

| Stable identity | Count | Level | Identities | Owner / disposition |
| --- | --- | --- | --- | --- |
| `0008_rls_enabled_no_policy` | 10 | INFO | `bond_counters`, `document_counters`, `esg_counters`, `estimate_counters`, `gl_counters`, `moc_counters`, `payment_counters`, `rate_limit_buckets`, `subcontract_counters`, `timesheet_counters` | Platform owner. Accepted: RLS on with zero policies = deny-all to `anon`/`authenticated`; these are internal sequence/rate-limit tables touched only by SECURITY DEFINER routines. |
| `0014_extension_in_public` | 2 | WARN | `citext`, `pg_net` | Platform owner. Accepted: relocation is not supported on managed Cloud without downtime; no user data exposure. |
| `0029_authenticated_security_definer_function_executable` | 119 | WARN | governed RPCs (close blockers, snapshot writers, alert lifecycle, role checks) | Module owners. Accepted by design: these are the audited write paths signed-in users must call; each pins `search_path` and re-checks company membership internally. `anon` EXECUTE is revoked on all of them. |

Delta vs the prior 177 baseline: **46 resolved** (all
`0030_anon_security_definer_function_executable` plus trigger-function EXECUTE
exposure, closed by the routine-privilege migration), **0 added**,
**131 unchanged**.

## 7. Executed evidence (this certification pass)

| Gate | Result |
| --- | --- |
| Nitro production build (`bun run build`) | exit 0, Cloudflare worker bundle + `dist/nitro.json` emitted |
| CI gates (`bun run test:gates`) | 3/3 PASS; run 3 executed concurrently with the DB-heavy `all-perf` project (also PASS, 22/22) |
| Full repository (`vitest.config.all.ts`) | **279 files, 4149 passed, 0 skipped, 0 failed** (249.3 s) |
| Typecheck (`tsgo --noEmit`) | exit 0 |
| ESLint (`eslint .`) | 0 errors, 56 warnings (baseline held) |
| Route tree | regenerated by the build; `src/routeTree.gen.ts` unchanged, 99 `portfolio/costing` route entries present |
| Live routine/RLS/invariant suites | 3 files, 164 passed |
| EN/AR parity + raw-key scans | 27 i18n/RTL assertions passed |
| GC-18 Playwright critical journeys | 36/36 passed on 3 consecutive Chromium runs |
| GC-17 Playwright regression | 10/10 (last production-code change was the GC-18 header/i18n fix at this SHA; suite re-run after it) |
| Seeded performance / EXPLAIN | 22/22; index-backed plans on every hot path — `cashflow_snapshots_project_idx` 1.843 ms, `cashflow_lines_cost_code_idx` 7.023 ms, `recognition_snapshots_project_idx` 7.982 ms, `recognition_lines_contract_idx` 0.939 ms, `contract_claim_snapshots_project_idx` 0.161 ms, `contract_claim_lines_snapshot_idx` 0.239 ms, `contract_claims_project_id_claim_ref_key` 1.847 ms, `risk_sim_runs_project_idx` 0.463 ms, `risk_contingency_events_project_idx` 0.121 ms, `risk_contingency_alerts_project_idx` 0.057 ms. Zero residue confirmed: 0 fixture companies, 0 fixture projects after the run. |

## 8. UAT checklist (executable, with evidence)

Run `bun run test:browser` (`tests/browser/gc18-critical-journeys.spec.ts`):
15 project costing surfaces GC-01..GC-17, 11 portfolio surfaces, reload and
back-navigation persistence, keyboard operability, role-less member sees no
operable governed mutation, AR/RTL parity with no raw i18n keys, 390 px mobile
with no horizontal overflow. Legacy checklist: `docs/uat-checklist.md`.

## 9. Traceability matrix (GC-01 … GC-18)

| Ref | Route(s) | Code | Tests |
| --- | --- | --- | --- |
| GC-01..07 costing, forecast, close | `projects/$id/costing*`, `.../close`, `.../close-pack` | `src/lib/costing*`, `costing-close-rules` | `tests/unit/costing-*`, `tests/rls/*` |
| GC-08..11 portfolio, audit, alerts, scenarios | `portfolio/costing`, `/audit`, `/alerts`, `/scenarios` | `src/components/portfolio/*` | `tests/unit/portfolio-*` |
| GC-12 EVM | `.../evm`, `.../evm-mappings`, `portfolio/costing/evm` | `src/lib/evm.report.rules.ts` | EVM unit + invariant suites |
| GC-13 cash flow & funding | `.../cash-flow`, `portfolio/costing/funding` | `src/lib/cashflow.rules.ts`, `cashflow.server.ts` | cashflow unit/RLS/perf |
| GC-14 contingency | `.../contingency` | contingency rules/server | contingency suites |
| GC-15 revenue & WIP | `.../revenue`, `portfolio/costing/revenue-wip` | `src/lib/recognition.rules.ts` | `tests/unit/recognition.test.ts`, perf |
| GC-16 contracts & claims + calendars | `.../contracts-claims`, portfolio equivalent | `contracts-claims.rules.ts`, `calendar-governance.*` | contracts/calendar suites |
| GC-17 risk & contingency drawdown | `.../risk-contingency` (project + portfolio) | `risk-sim.rules.ts`, `risk-contingency.server.ts` | `risk-alerts`, `risk-alert-register`, e2e, browser |
| GC-18 consolidation | all of the above | index + routine-privilege migrations | `gc18-critical-journeys.spec.ts`, this record |

## 10. Known limitations

- 131 accepted advisor findings above; none is a data-exposure defect.
- Non-concurrent index builds lock writes during migration (see §5).
- The browser UAT asserts governed-surface rendering and lifecycle operability;
  it does not assert numeric figures, which are covered by the deterministic
  rule suites instead.
