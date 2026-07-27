// P-211 — Cost build-up engine: purity, compounding, formulas, warnings and
// pricing validation. Offline; no React, no network.
import { describe, expect, it } from "vitest";

import {
  MARGIN_WARNING_MESSAGE,
  combinedMarginPct,
  computeEstimate,
  directCostOf,
  estimateMarginsSchema,
  validateForPricing,
} from "@/lib/estimating/buildup";

const M = (e: number, c: number, o: number, p: number) => ({
  escalation_pct: e,
  contingency_pct: c,
  overhead_pct: o,
  profit_pct: p,
});

// 100,000 direct cost expressed as two lines.
const lines = [
  { qty: 400, unit_rate: 150 }, // 60,000
  { qty: 200, unit_rate: 200 }, // 40,000
];

describe("computeEstimate — canonical fixture", () => {
  const result = computeEstimate(lines, M(2, 5, 8, 10));

  it("compounds each stage with 2dp rounding", () => {
    expect(result.direct_cost).toBe(100000);
    const byKey = Object.fromEntries(result.stages.map((s) => [s.key, s]));
    expect(byKey.escalation.amount).toBe(2000);
    expect(byKey.escalation.running_total).toBe(102000);
    expect(byKey.contingency.amount).toBe(5100);
    expect(byKey.contingency.running_total).toBe(107100);
    expect(byKey.overhead.amount).toBe(8568);
    expect(byKey.overhead.running_total).toBe(115668);
    expect(byKey.profit.amount).toBe(11566.8);
    expect(result.subtotal).toBe(115668);
    expect(result.total_price).toBe(127234.8);
  });

  it("reconciles: subtotal + profit = total, last running_total = total", () => {
    const profit = result.stages.at(-1)!;
    expect(result.subtotal + profit.amount).toBeCloseTo(result.total_price, 2);
    expect(profit.running_total).toBe(result.total_price);
    expect(result.stages.map((s) => s.key)).toEqual([
      "direct",
      "escalation",
      "contingency",
      "overhead",
      "profit",
    ]);
  });

  it("carries a human formula on every stage", () => {
    const byKey = Object.fromEntries(result.stages.map((s) => [s.key, s]));
    expect(byKey.direct.formula).toBe("Σ qty × unit_rate over 2 lines");
    expect(byKey.contingency.formula).toBe("102,000.00 × 5.000% = 5,100.00");
    expect(byKey.profit.formula).toBe("115,668.00 × 10.000% = 11,566.80");
    for (const stage of result.stages) expect(stage.formula.length).toBeGreaterThan(0);
  });

  it("is pure — no input mutation, stable across calls", () => {
    const snapshot = JSON.stringify(lines);
    const again = computeEstimate(lines, M(2, 5, 8, 10));
    expect(JSON.stringify(lines)).toBe(snapshot);
    expect(again).toEqual(result);
  });
});

describe("edge cases", () => {
  it("zero margins leave the direct cost untouched", () => {
    const r = computeEstimate(lines, M(0, 0, 0, 0));
    expect(r.total_price).toBe(100000);
    expect(r.subtotal).toBe(100000);
    expect(r.warnings).toEqual([]);
  });

  it("handles no lines", () => {
    const r = computeEstimate([], M(5, 5, 5, 5));
    expect(r.direct_cost).toBe(0);
    expect(r.total_price).toBe(0);
    expect(r.stages[0].formula).toBe("Σ qty × unit_rate over 0 lines");
  });

  it("rounds per line before summing", () => {
    expect(
      directCostOf([
        { qty: 3, unit_rate: 1.115 },
        { qty: 1, unit_rate: 0.005 },
      ]),
    ).toBe(3.36);
  });
});

describe("warnings", () => {
  it("stays silent at exactly 40%", () => {
    expect(computeEstimate(lines, M(10, 10, 10, 10)).warnings).toEqual([]);
    expect(combinedMarginPct(M(10, 10, 10, 10))).toBe(40);
  });

  it("warns above 40% without blocking the computation", () => {
    const r = computeEstimate(lines, M(10, 10, 10, 10.5));
    expect(r.warnings).toEqual([MARGIN_WARNING_MESSAGE]);
    expect(r.total_price).toBeGreaterThan(0);
  });
});

describe("estimateMarginsSchema", () => {
  it("accepts 0..50 and rejects out-of-range values", () => {
    expect(estimateMarginsSchema.safeParse(M(0, 50, 12.5, 3)).success).toBe(true);
    expect(estimateMarginsSchema.safeParse(M(50.1, 0, 0, 0)).success).toBe(false);
    expect(estimateMarginsSchema.safeParse(M(0, -1, 0, 0)).success).toBe(false);
    expect(estimateMarginsSchema.safeParse({ escalation_pct: 1 }).success).toBe(false);
  });
});

describe("validateForPricing", () => {
  const priced = [
    { id: "l1", description: "Modules", qty: 400, unit_rate: 150 },
    { id: "l2", description: "Cable", qty: 200, unit_rate: 200 },
  ];

  it("passes a healthy estimate", () => {
    const v = validateForPricing(priced, M(2, 5, 8, 10));
    expect(v.ok).toBe(true);
    expect(v.issues).toEqual([]);
    expect(v.result.total_price).toBe(127234.8);
  });

  it("lists zero-qty and negative-rate lines", () => {
    const v = validateForPricing(
      [
        { id: "l1", description: "Modules", qty: 0, unit_rate: 150 },
        { id: "l2", description: "Cable", qty: 5, unit_rate: -1 },
      ],
      M(0, 0, 0, 0),
    );
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.line_id)).toEqual(["l1", "l2"]);
  });

  it("rejects a zero total price", () => {
    const v = validateForPricing(
      [{ id: "l1", description: "Free", qty: 2, unit_rate: 0 }],
      M(5, 5, 5, 5),
    );
    expect(v.ok).toBe(false);
    expect(v.result.total_price).toBe(0);
  });

  it("rejects an empty estimate", () => {
    expect(validateForPricing([], M(0, 0, 0, 0)).ok).toBe(false);
  });
});
