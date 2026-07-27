// P-214 — Waterfall math + margin bounds (pure, offline).
import { describe, expect, it } from "vitest";

import { combinedMarginPct, computeEstimate } from "@/lib/estimating/buildup";
import { SaveEstimateMarginsSchema } from "@/lib/estimating.rules";

const DIRECT_LINES = [{ qty: 1000, unit_rate: 100 }];
const MARGINS = { escalation_pct: 2, contingency_pct: 5, overhead_pct: 8, profit_pct: 10 };

const stage = (r: ReturnType<typeof computeEstimate>, key: string) =>
  r.stages.find((s) => s.key === key)!;

describe("build-up waterfall", () => {
  it("matches the known 127,234.80 fixture stage by stage", () => {
    const r = computeEstimate(DIRECT_LINES, MARGINS);
    expect(r.direct_cost).toBe(100_000);
    expect(stage(r, "escalation")).toMatchObject({ amount: 2000, running_total: 102_000 });
    expect(stage(r, "contingency")).toMatchObject({ amount: 5100, running_total: 107_100 });
    expect(stage(r, "overhead")).toMatchObject({ amount: 8568, running_total: 115_668 });
    expect(r.subtotal).toBe(115_668);
    expect(stage(r, "profit").amount).toBe(11_566.8);
    expect(r.total_price).toBe(127_234.8);
  });

  it("carries base, pct and amount in every stage formula", () => {
    const r = computeEstimate(DIRECT_LINES, MARGINS);
    for (const s of r.stages.filter((x) => x.key !== "direct")) {
      expect(s.formula).toContain(s.base.toLocaleString("en-US", { minimumFractionDigits: 2 }));
      expect(s.formula).toContain(`${s.pct}`);
      expect(s.formula).toContain(s.amount.toLocaleString("en-US", { minimumFractionDigits: 2 }));
    }
  });

  it("rounds half-up to 2dp at each stage", () => {
    const r = computeEstimate([{ qty: 1, unit_rate: 33.335 }], {
      escalation_pct: 0,
      contingency_pct: 0,
      overhead_pct: 0,
      profit_pct: 0,
    });
    expect(r.direct_cost).toBe(33.34);
    const r2 = computeEstimate([{ qty: 1, unit_rate: 100.05 }], {
      escalation_pct: 2.5,
      contingency_pct: 0,
      overhead_pct: 0,
      profit_pct: 0,
    });
    expect(stage(r2, "escalation").amount).toBe(2.5);
    expect(r2.total_price).toBe(102.55);
  });

  it("returns direct cost as the total when every margin is zero", () => {
    const r = computeEstimate(DIRECT_LINES, {
      escalation_pct: 0,
      contingency_pct: 0,
      overhead_pct: 0,
      profit_pct: 0,
    });
    expect(r.subtotal).toBe(100_000);
    expect(r.total_price).toBe(100_000);
  });
});

describe("margin bounds", () => {
  const parse = (patch: Record<string, number>) =>
    SaveEstimateMarginsSchema.safeParse({
      estimate_id: "00000000-0000-4000-8000-000000000001",
      escalation_pct: 0,
      contingency_pct: 0,
      overhead_pct: 0,
      profit_pct: 0,
      ...patch,
    });

  it("rejects a percentage above 50 or below zero", () => {
    expect(parse({ profit_pct: 50.01 }).success).toBe(false);
    expect(parse({ overhead_pct: 51 }).success).toBe(false);
    expect(parse({ contingency_pct: -1 }).success).toBe(false);
    expect(parse({ profit_pct: 50 }).success).toBe(true);
  });

  it("warns above 40% combined but not at or below it", () => {
    const warnings = (e: number, c: number, o: number, p: number) =>
      computeEstimate(DIRECT_LINES, {
        escalation_pct: e,
        contingency_pct: c,
        overhead_pct: o,
        profit_pct: p,
      }).warnings;
    expect(warnings(10, 10, 10, 15)).toHaveLength(1); // 45%
    expect(warnings(10, 9, 10, 10)).toHaveLength(0); // 39%
    expect(warnings(10, 10, 10, 10)).toHaveLength(0); // exactly 40%
    expect(combinedMarginPct({ ...MARGINS })).toBe(25);
  });
});
