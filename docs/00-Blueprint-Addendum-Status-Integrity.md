# Blueprint Addendum — Status Integrity (Derived-Status Doctrine)

Status: **binding** as of Batch 32 (P-245 … P-250).
Origin: the orphan-bid incident — an `rfq_bids.status = 'awarded'` row with no
`rfq_line_awards` row. Two writers, no single source of truth. The audit that
followed found **13 classes** of the same design debt across the system.

---

## The doctrine

> A status column that mirrors truth owned by another table is **derived**.
> Derived state is written by the database, never by the app.

Every derived status column MUST satisfy all four legs:

**(a) DB-maintained via sync trigger.**
The column is recomputed from its source-of-truth rows by an `AFTER INSERT OR
UPDATE OR DELETE` trigger on the _source_ table (and, where the entity can be
created already-decided, on the entity itself). The recompute function is
`SECURITY DEFINER`, `SET search_path`, and sets the engine marker before
writing.

**(b) Guard-triggered against manual writes.**
A `BEFORE UPDATE` guard on the entity raises `42501` with a message ending in
`…_is_derived` whenever the derived column changes without the engine marker
(`current_setting('app.derived_write', true) = 'on'`, set only by the governed
routines). App code that tries a direct `.update({ status })` fails loudly in
development instead of silently drifting in production.

**(c) Covered by a consistency-harness class.**
`tests/integrity/status-consistency.test.ts` carries one class per derived
column, expressed as a SQL divergence query returning
`(company, ref, expected, actual)`. The class asserts **0 rows**. New derived
columns add a new class in the same PR — a derived column without a class is
an incomplete change.

**(d) Exempt transitions enumerated per entity.**
Manual, human-initiated transitions that do _not_ mirror another table (draft
→ submitted, submitted → withdrawn, archive) stay open, are listed below per
entity, and are performed only through their governed server functions.

---

## The gates

Both run inside `bun run test:all` as named, non-skippable gates
(`scripts/ci-gates.mjs`). Missing DB env is a **failure**, not a skip.

| Gate                       | Command                    | Threshold          |
| -------------------------- | -------------------------- | ------------------ |
| RLS policy lint            | `bun run test:policy-lint` | 0 flags            |
| Status-consistency harness | `bun run test:integrity`   | 13/13 classes at 0 |

Scope: real tenants (GSI + Sandbox) by default;
`INTEGRITY_ALL_TENANTS=1` widens the sweep to every tenant including fixtures.
Both scopes must be at 0 before a release.

---

## The 13 classes and their exemptions

| #   | Entity · column                              | Source of truth                                              | Exempt (manual) transitions                     |
| --- | -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| 1   | `rfq_bids.status`                            | `rfq_line_awards`                                            | submit, withdraw, disqualify                    |
| 2   | `drawing_register.current_status` / `locked` | latest `drawing_revisions` + released `ifc_releases`         | register create, `current_revision_id` re-point |
| 3   | `sld_drawings.status` / `locked`             | approval rows + `drawing_register` lock (`sld_apply_status`) | draft create, submit for review                 |
| 4   | `purchase_orders.status`                     | `approval_instances` (settler)                               | draft, submit, cancel, close                    |
| 4   | `proposals.status`                           | `approval_instances` via `approval_instance_id`              | draft, submit, withdraw, expire                 |
| 4   | `pay_applications.status`                    | `approval_instances` (`pay_app_decide`)                      | draft, submit, withdraw                         |
| 4   | `estimates.status`                           | `approval_instances`                                         | draft, submit, supersede                        |
| 4   | `esg_reports.status`                         | `approval_instances`                                         | draft, submit                                   |
| 5   | `invoices.status` / `payment_status`         | `payments` ledger                                            | draft, issue, void                              |
| 6   | approval-decided mirrors (all of the above)  | `decide_approval` engine only                                | —                                               |
| 7   | `timesheets.status`                          | approval chain instance                                      | draft, submit, recall-before-review             |
| 7   | `leave_requests.status`                      | approval chain (`leave_decide`)                              | draft, submit, cancel-before-decision           |
| —   | `scada_alarms.status`                        | acknowledgement/clear events                                 | manual acknowledge                              |

---

## Rule for every future prompt

Any change that **adds or modifies a status column** must declare, in the
prompt or the PR description, which side of the doctrine it is on:

- **Derived** — then it ships with (a) sync trigger, (b) `…_is_derived` guard,
  (c) a new harness class, (d) an exemption list appended to the table above.
- **Owned** — the column is the sole source of truth for that fact; nothing
  else mirrors it. Then say so explicitly, and no other table may duplicate it.

There is no third option. A status column whose side is undeclared is the
exact shape of the defect that produced the orphan-bid incident.

---

## Test-suite tenant hygiene (P-250)

Fixture tenants used to regrow to hundreds because `companies.delete()`
silently no-ops behind surviving FKs (audit logs, notifications). Every suite
that creates a tenant now tears it down through the audited purge path:

```ts
import { purgeFixtureTenants } from "../helpers/fixture-teardown";
afterAll(async () => {
  await purgeFixtureTenants(svc, [companyId]);
});
```

`public.fixture_purge_tenants(uuid[])` is `SECURITY DEFINER`, service-role
only, refuses the protected slugs (`gsi`, `sandbox`), cascades every public
table carrying `company_id`, and writes an `ops.fixture_purge` audit row.
**Invariant:** after any number of back-to-back full-suite runs,
`select count(*) from public.companies` = **2**. Suite isolation must never
depend on leftover fixtures.

---

## Cross-project RPC doctrine (P-256)

Any RPC that reads *across* projects — the portfolio lens, and every future
executive/roll-up surface — follows the **guard + audit** pattern established
by `public.portfolio_guard(p_rpc text)`:

1. `SECURITY DEFINER` with `set search_path = public`, `revoke all … from
   public, anon`, `grant execute … to authenticated`.
2. The guard rejects `auth.uid() is null` (anon) and any
   `is_external_viewer()` caller — client, investor, lender and vendor
   viewers never reach portfolio math.
3. The tenant is resolved **from the caller's profile**, never from an
   argument. A cross-tenant caller sees their own company or nothing.
4. The guard writes one `ops.portfolio_view` audit row per call, carrying the
   RPC name in `metadata.rpc`.
5. Aggregation is **weighted** (ΣEV/ΣPV, recordables × 200,000 / Σhours) and
   FX is frozen at entry (`amount_base`), never re-converted at read time.

Proof suites: `tests/portfolio/aggregation.test.ts` (3-project fixture, every
number hand-computed) and `tests/rls/portfolio.rls.test.ts` (four external
roles, anon, cross-tenant isolation, audit row). Both tear their tenants down
through `fixture_purge_tenants`.
