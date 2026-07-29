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

Any RPC that reads _across_ projects — the portfolio lens, and every future
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

---

## External-party module doctrine (P-262, Batch 34)

The subcontractor module is the **reference implementation** for every future
external-party module (any counterparty that gets a seat in our app):

1. **Vendor-portal definer pattern.** External parties never touch the raw
   tables. Every policy on `subcontracts`, `subcontract_lines`,
   `subcontract_claims`, `subcontract_claim_lines` and
   `subcontract_retention_releases` is company-scoped _and_ excludes
   `is_external_viewer()`; the sub reads and writes only through
   `SECURITY DEFINER` routines (`sub_portal_*`) that resolve company + vendor
   from the caller's **active seat**, never from the argument. `anon` holds no
   privileges on any of the five tables.
2. **Engine-owned decision state.** `certified` is written by the approval
   engine alone: `subcontract_claims_guard_status` raises
   `subcontract_claim_engine_only` unless `gridmind.approval_settle` is on,
   which only `settle_derived_entity` sets. Certification is therefore also
   the single place the money loop fires (`sub_claim_generate_ap_invoice`).
3. **Trigger-maintained ledgers.** `certified_to_date`, `retention_held` and
   `retention_released` are never written by application code —
   `subcontract_retention_sync()` derives them from certified claims and the
   release ledger, exactly as the derived-status doctrine requires (no new
   hand-maintained status columns were introduced by Batch 34).

Proof suites: `tests/subcontracts/lifecycle.test.ts` ($100k subcontract, three
claims at 40/35/25 %, retention and AP invoices asserted to the cent, EVM
reflection, release zeroing the ledger) and
`tests/rls/subcontracts.rls.test.ts` (policy shape on all five tables plus
live cross-tenant, cross-sub, anon, external-viewer and engine-freeze probes).
Both tear their tenants down through `fixture_purge_tenants`.

## Batch 35 — Document control doctrine

Reference pattern for any controlled-artefact module:

1. **Pinned transmittals.** A transmittal item pins `revision_pinned` at
   insert time. Once the parent leaves `draft`, `transmittal_items_freeze()`
   raises `transmittal_items_frozen` on every insert/update/delete, so what
   was sent stays exactly what was sent even after the source document is
   superseded. `transmittals_guard_delete()` mirrors this at the header level:
   only a `draft` transmittal is deletable (`transmittal_not_draft`); the
   freeze exempts the cascade of a draft delete, and system/maintenance paths
   (`auth.uid() is null`) are exempt so fixture teardown stays possible.
2. **Enforced supersedure.** `status` on `document_register` is derived, never
   hand-set: `document_register_auto_supersede` flips the predecessor to
   `superseded` and links `supersedes_id` forward, `document_history()` walks
   the chain and `document_current_in_lineage()` resolves the head. This is
   the derived-status doctrine applied to revisions rather than to workflow.
3. **Controlled copies as obligations.** Copy numbers are allocated by
   `issue_controlled_copy`, issuing against a non-current revision raises the
   typed `doc_not_current` 409, and supersedure flags outstanding copies
   `recall_due` — recall completeness is a computed ratio, not a checkbox.
   Uncontrolled output is watermarked bilingually at export time.
4. **Dossier-as-document.** The turnover dossier is not a download side
   effect: it compiles, gap-checks, stamps COMPLETE/INCOMPLETE and then
   self-registers as a `permanent` controlled document with its own DOC
   number, so the deliverable is itself under document control.

Proof suites: `tests/documents/lifecycle.test.ts` (3-deep supersedure chain,
pinned transmittal items, copy numbering, recall math, retention classes,
gapped vs clean dossier registration, P-264 search ranking/snippets) and
`tests/rls/documents.rls.test.ts` (policy shape on all four tables plus live
cross-tenant, anon, external-viewer, role-gate and freeze probes). Both tear
their tenants down through `fixture_purge_tenants`.
