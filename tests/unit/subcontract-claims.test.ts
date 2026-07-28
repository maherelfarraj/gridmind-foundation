// P-258 — Subcontract claim math + guards.
import { describe, expect, it } from "vitest";

import {
  ClaimDecisionSchema,
  SubcontractSaveSchema,
  computeClaimLine,
  computeClaimTotals,
  isSubcontractorCapable,
  progressPct,
  reconcileSov,
  sovLineAmount,
  sovTotal,
} from "@/lib/subcontracts.rules";

const line = (qty: number, unit_price: number) => ({ qty, unit_price });

describe("SOV reconciliation guard", () => {
  it("sums line amounts to the cent", () => {
    expect(sovLineAmount(line(3, 33.333))).toBe(100);
    expect(sovTotal([line(3, 33.333), line(1, 0.005)])).toBe(100.01);
  });

  it("reconciles when the SOV equals the contract value", () => {
    const r = reconcileSov([line(10, 1000), line(5, 250)], 11250);
    expect(r.total).toBe(11250);
    expect(r.variance).toBe(0);
    expect(r.reconciled).toBe(true);
  });

  it("blocks a mismatch and reports the signed variance", () => {
    const r = reconcileSov([line(10, 1000)], 12000);
    expect(r.reconciled).toBe(false);
    expect(r.variance).toBe(-2000);
  });

  it("rejects the save payload when the SOV does not reconcile", () => {
    const payload = {
      title: "Civil works",
      vendor_id: "11111111-1111-4111-8111-111111111111",
      project_id: "22222222-2222-4222-8222-222222222222",
      contract_value: 5000,
      currency_code: "USD",
      retention_pct: 10,
      status: "draft" as const,
      lines: [{ line_no: 1, description: "Piling", qty: 1, unit_price: 4000 }],
    };
    expect(SubcontractSaveSchema.safeParse(payload).success).toBe(false);
    expect(SubcontractSaveSchema.safeParse({ ...payload, contract_value: 4000 }).success).toBe(
      true,
    );
  });
});

describe("cumulative 0–100 clamp", () => {
  it("flags a line whose cumulative exceeds 100%", () => {
    const m = computeClaimLine({ line_amount: 1000, previous_pct: 80, this_period_pct: 25 });
    expect(m.cumulative_pct).toBe(105);
    expect(m.inRange).toBe(false);
  });

  it("flags a negative cumulative", () => {
    const m = computeClaimLine({ line_amount: 1000, previous_pct: 10, this_period_pct: -20 });
    expect(m.inRange).toBe(false);
  });

  it("accepts the boundary values", () => {
    expect(
      computeClaimLine({ line_amount: 1000, previous_pct: 80, this_period_pct: 20 }).inRange,
    ).toBe(true);
    expect(
      computeClaimLine({ line_amount: 1000, previous_pct: 0, this_period_pct: 0 }).inRange,
    ).toBe(true);
  });

  it("reports every out-of-range line index on the roll-up", () => {
    const totals = computeClaimTotals(
      [
        { line_amount: 1000, previous_pct: 0, this_period_pct: 50 },
        { line_amount: 1000, previous_pct: 90, this_period_pct: 20 },
      ],
      10,
    );
    expect(totals.outOfRangeLines).toEqual([1]);
  });
});

describe("retention math fixture (10% of this period)", () => {
  it("derives previous, this-period, retention and net payable", () => {
    const totals = computeClaimTotals(
      [
        { line_amount: 100_000, previous_pct: 20, this_period_pct: 30 },
        { line_amount: 50_000, previous_pct: 0, this_period_pct: 10 },
      ],
      10,
    );
    expect(totals.previous_certified).toBe(20_000);
    expect(totals.this_period_amount).toBe(35_000);
    expect(totals.gross_to_date).toBe(55_000);
    expect(totals.retention_amount).toBe(3_500);
    expect(totals.net_payable).toBe(31_500);
  });

  it("holds nothing back at 0% retention", () => {
    const totals = computeClaimTotals(
      [{ line_amount: 1000, previous_pct: 0, this_period_pct: 100 }],
      0,
    );
    expect(totals.retention_amount).toBe(0);
    expect(totals.net_payable).toBe(1000);
  });

  it("rounds retention to the cent", () => {
    const totals = computeClaimTotals(
      [{ line_amount: 333.33, previous_pct: 0, this_period_pct: 33.33 }],
      10,
    );
    expect(totals.this_period_amount).toBe(111.1);
    expect(totals.retention_amount).toBe(11.11);
    expect(totals.net_payable).toBe(99.99);
  });
});

describe("progress + vendor eligibility", () => {
  it("clamps progress to 0..100", () => {
    expect(progressPct(50, 200)).toBe(25);
    expect(progressPct(500, 200)).toBe(100);
    expect(progressPct(10, 0)).toBe(0);
  });

  it("only lists subcontract-capable vendors", () => {
    expect(isSubcontractorCapable(["Civil", "logistics"])).toBe(true);
    expect(isSubcontractorCapable(["modules", "logistics"])).toBe(false);
    expect(isSubcontractorCapable(null)).toBe(false);
  });
});

describe("decision guard", () => {
  const base = {
    claim_id: "33333333-3333-4333-8333-333333333333",
    approval_id: "44444444-4444-4444-8444-444444444444",
  };

  it("requires a comment on reject", () => {
    expect(
      ClaimDecisionSchema.safeParse({ ...base, decision: "rejected", comment: "   " }).success,
    ).toBe(false);
    expect(
      ClaimDecisionSchema.safeParse({ ...base, decision: "rejected", comment: "Scope short" })
        .success,
    ).toBe(true);
  });

  it("allows certify without a comment", () => {
    expect(ClaimDecisionSchema.safeParse({ ...base, decision: "approved" }).success).toBe(true);
  });
});
