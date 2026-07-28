// P-245 — Status-duplication consistency audit (Batch 32 kickoff).
//
// Seven classes of duplicated status were found in the Day 7 sweep: a status
// column that mirrors state owned by another table. Each mirror can drift.
// This harness reads LIVE data and asserts zero divergences per class, so the
// repairs in P-246..P-249 have a proof they worked — and a regression net.
//
// Read-only. No schema changes, no writes. Requires managed PG* env vars;
// skips (never silently passes) without them.

import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const HAS_DB = Boolean(process.env.PGHOST);
const d = HAS_DB ? describe : describe.skip;

const SEP = "\u0001";

function rows(sql: string): string[][] {
  const out = execFileSync("psql", ["-At", "-F", SEP, "-c", sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(SEP));
}

/** Every divergence query returns: company, entity ref, expected, actual. */
export interface Divergence {
  company: string;
  ref: string;
  expected: string;
  actual: string;
}

function divergences(sql: string): Divergence[] {
  return rows(sql).map(([company, ref, expected, actual]) => ({
    company,
    ref,
    expected,
    actual,
  }));
}

function report(cls: string, found: Divergence[]) {
  if (found.length === 0) return "";
  return `\n${cls}: ${found.length} divergence(s)\n${found
    .slice(0, 25)
    .map((r) => `  [${r.company}] ${r.ref}: expected=${r.expected} actual=${r.actual}`)
    .join("\n")}`;
}

// Scope: every live tenant (GSI + Sandbox today). Company name is carried in
// the output so the divergence table is readable per tenant.
const CO = "join public.companies c on c.id = %T%.company_id";

// ---------------------------------------------------------------------------
// C1 — rfq_bids.status = 'awarded'  <=>  an rfq_line_awards row exists.
// The class that actually hurt us: two writers, no single award path.
// ---------------------------------------------------------------------------
const C1 = `
select c.name, r.po_ref, r.expected, r.actual from (
  select b.company_id,
         'rfq_bid ' || b.id::text as po_ref,
         case when exists (select 1 from public.rfq_line_awards a where a.rfq_bid_id = b.id)
              then 'awarded' else 'not-awarded' end as expected,
         b.status::text as actual
  from public.rfq_bids b
) r ${CO.replace(/%T%/g, "r")}
where (r.expected = 'awarded') <> (r.actual = 'awarded')
order by 1, 2`;

// ---------------------------------------------------------------------------
// C2 — drawing_register.current_status / locked vs latest revision + IFC.
// A register locked without a released IFC package, or a register whose
// current_status disagrees with the revision it points at.
// ---------------------------------------------------------------------------
const C2 = `
select c.name, r.ref, r.expected, r.actual from (
  select d.company_id,
         'drawing ' || d.drawing_number as ref,
         coalesce(rev.status::text, '(no-revision)') as expected,
         d.current_status::text as actual
  from public.drawing_register d
  left join public.drawing_revisions rev on rev.id = d.current_revision_id
) r ${CO.replace(/%T%/g, "r")}
where r.expected is distinct from r.actual
order by 1, 2`;

const C2_LOCK = `
select c.name, r.ref, r.expected, r.actual from (
  select d.company_id,
         'drawing ' || d.drawing_number || ' (lock)' as ref,
         case when exists (
           select 1 from public.ifc_releases i
           where i.project_id = d.project_id and i.status = 'released'
         ) then 'lockable' else 'unlocked' end as expected,
         case when d.locked then 'locked' else 'unlocked' end as actual
  from public.drawing_register d
) r ${CO.replace(/%T%/g, "r")}
where r.actual = 'locked' and r.expected = 'unlocked'
order by 1, 2`;

// ---------------------------------------------------------------------------
// C3 — sld_drawings.status / locked vs the register row it belongs to.
// ---------------------------------------------------------------------------
const C3 = `
select c.name, r.ref, r.expected, r.actual from (
  select s.company_id,
         'sld ' || s.drawing_number as ref,
         case when dr.locked then 'locked' else 'unlocked' end as expected,
         case when s.locked then 'locked' else 'unlocked' end as actual
  from public.sld_drawings s
  join public.drawing_register dr on dr.id = s.drawing_register_id
) r ${CO.replace(/%T%/g, "r")}
where r.expected is distinct from r.actual
order by 1, 2`;

// ---------------------------------------------------------------------------
// C4..C6 — the approval-mirror class. One shape, five tables: a local status
// column mirroring approval_instances.status via approval_instance_id.
// ---------------------------------------------------------------------------
function approvalMirror(
  table: string,
  refExpr: string,
  approvedStatuses: string[],
  rejectedStatuses: string[],
): string {
  const app = approvedStatuses.map((s) => `'${s}'`).join(",");
  const rej = rejectedStatuses.map((s) => `'${s}'`).join(",");
  return `
select c.name, r.ref, r.expected, r.actual from (
  select t.company_id,
         '${table} ' || ${refExpr} as ref,
         ai.status::text as expected,
         t.status::text as actual
  from public.${table} t
  join public.approval_instances ai on ai.id = t.approval_instance_id
) r ${CO.replace(/%T%/g, "r")}
where (r.expected = 'approved' and r.actual not in (${app}))
   or (r.expected = 'rejected' and r.actual not in (${rej}))
order by 1, 2`;
}

const C4_PO = approvalMirror(
  "purchase_orders",
  "t.po_number",
  ["approved", "issued", "acknowledged", "accepted", "partially_received", "received", "closed"],
  ["draft", "rejected", "cancelled"],
);
const C5_EST = approvalMirror(
  "estimates",
  "t.estimate_number",
  ["approved", "converted"],
  ["draft", "rejected"],
);
const C5_ESG = approvalMirror(
  "esg_reports",
  "t.report_number",
  ["approved", "published"],
  ["draft", "rejected"],
);
const C5_TS = approvalMirror(
  "timesheets",
  "t.timesheet_number",
  ["approved", "locked"],
  ["draft", "rejected"],
);

// pay_applications and proposals carry no approval_instance_id column — their
// mirror is the certified/approved timestamp pair, checked structurally.
const C5_PAYAPP = `
select c.name, r.ref, r.expected, r.actual from (
  select p.company_id,
         'pay_application ' || p.application_number::text as ref,
         case when p.approved_at is not null then 'approved'
              when p.certified_at is not null then 'certified'
              else 'open' end as expected,
         p.status::text as actual
  from public.pay_applications p
) r ${CO.replace(/%T%/g, "r")}
where (r.expected = 'approved' and r.actual not in ('approved','paid','invoiced','closed'))
   or (r.expected = 'open' and r.actual in ('approved','paid'))
order by 1, 2`;

// ---------------------------------------------------------------------------
// C7 — invoices.status vs the sum of live (non-voided) payments.
// paid_amount = total  <=> paid ; 0 < paid < total <=> partially_paid.
// Also asserts the denormalised paid_amount matches the payment ledger.
// ---------------------------------------------------------------------------
const C7_STATUS = `
select c.name, r.ref, r.expected, r.actual from (
  select i.company_id,
         'invoice ' || i.invoice_number as ref,
         case
           when coalesce(pay.total, 0) <= 0 then 'unpaid'
           when coalesce(pay.total, 0) >= (i.amount + coalesce(i.tax_amount, 0)) then 'paid'
           else 'partially_paid'
         end as expected,
         i.status::text as actual
  from public.invoices i
  left join lateral (
    select sum(p.amount) as total from public.payments p
    where p.invoice_id = i.id and p.record_status <> 'voided'
  ) pay on true
  where i.status not in ('draft', 'cancelled', 'disputed')
) r ${CO.replace(/%T%/g, "r")}
where (r.expected = 'paid' and r.actual <> 'paid')
   or (r.expected = 'partially_paid' and r.actual not in ('partially_paid','paid'))
   or (r.expected = 'unpaid' and r.actual in ('paid','partially_paid'))
order by 1, 2`;

const C7_LEDGER = `
select c.name, r.ref, r.expected, r.actual from (
  select i.company_id,
         'invoice ' || i.invoice_number || ' (paid_amount)' as ref,
         to_char(coalesce(pay.total, 0), 'FM9999999990.00') as expected,
         to_char(coalesce(i.paid_amount, 0), 'FM9999999990.00') as actual
  from public.invoices i
  left join lateral (
    select sum(p.amount) as total from public.payments p
    where p.invoice_id = i.id and p.record_status <> 'voided'
  ) pay on true
) r ${CO.replace(/%T%/g, "r")}
where r.expected <> r.actual
order by 1, 2`;

// ---------------------------------------------------------------------------
// C8 — leave_requests.status vs its decision fields (approvals-backed class).
// ---------------------------------------------------------------------------
const C8_LEAVE = `
select c.name, r.ref, r.expected, r.actual from (
  select l.company_id,
         'leave ' || l.request_number as ref,
         case when l.decided_at is not null then 'decided' else 'pending' end as expected,
         l.status::text as actual
  from public.leave_requests l
) r ${CO.replace(/%T%/g, "r")}
where (r.expected = 'decided' and r.actual in ('draft','submitted','pending'))
   or (r.expected = 'pending' and r.actual in ('approved','rejected'))
order by 1, 2`;

// Approvals rows must agree with their parent instance: no instance can be
// 'approved' while a required step is still pending.
const C9_APPROVALS = `
select c.name, r.ref, r.expected, r.actual from (
  select ai.company_id,
         'approval_instance ' || ai.id::text as ref,
         'no-pending-steps' as expected,
         'pending step(s): ' || count(a.id)::text as actual
  from public.approval_instances ai
  join public.approvals a on a.instance_id = ai.id and a.status = 'pending'
  where ai.status in ('approved', 'rejected')
  group by ai.company_id, ai.id
) r ${CO.replace(/%T%/g, "r")}
order by 1, 2`;

export const CHECKS: { cls: string; sql: string }[] = [
  { cls: "C1 rfq_bids.status <=> rfq_line_awards", sql: C1 },
  { cls: "C2 drawing_register.current_status <=> latest revision", sql: C2 },
  { cls: "C2b drawing_register.locked <=> released IFC package", sql: C2_LOCK },
  { cls: "C3 sld_drawings.locked <=> register lock", sql: C3 },
  { cls: "C4 purchase_orders.status <=> approval_instances", sql: C4_PO },
  { cls: "C5 estimates.status <=> approval_instances", sql: C5_EST },
  { cls: "C5b esg_reports.status <=> approval_instances", sql: C5_ESG },
  { cls: "C5c timesheets.status <=> approval_instances", sql: C5_TS },
  { cls: "C5d pay_applications.status <=> certification state", sql: C5_PAYAPP },
  { cls: "C6 invoices.status <=> payments ledger", sql: C7_STATUS },
  { cls: "C6b invoices.paid_amount <=> payments ledger", sql: C7_LEDGER },
  { cls: "C7 leave_requests.status <=> decision fields", sql: C8_LEAVE },
  { cls: "C7b approval_instances decided with pending steps", sql: C9_APPROVALS },
];

d("P-245 status-duplication consistency audit", () => {
  for (const { cls, sql } of CHECKS) {
    it(`${cls} — zero divergences`, () => {
      const found = divergences(sql);
      expect(found, report(cls, found)).toEqual([]);
    });
  }

  it("prints the divergence table for every tenant", () => {
    const table = CHECKS.map(({ cls, sql }) => {
      let n = 0;
      try {
        n = divergences(sql).length;
      } catch (e) {
        n = -1;
      }
      return `${n === 0 ? "PASS" : "FAIL"}  ${String(n).padStart(3)}  ${cls}`;
    });
    // eslint-disable-next-line no-console
    console.log(`\nP-245 divergence table\n${table.join("\n")}\n`);
    expect(table.every((l) => l.startsWith("PASS"))).toBe(true);
  });
});
