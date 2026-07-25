// P-077 — Cash-flow rules unit tests.
import { describe, expect, it } from "vitest";

import {
  addMonths,
  buildPivot,
  monthRange,
  normalizePeriod,
  type CashFlowRow,
} from "@/lib/cash-flow.rules";

function row(overrides: Partial<CashFlowRow>): CashFlowRow {
  return {
    id: crypto.randomUUID(),
    company_id: "c",
    project_id: "p",
    period: "2026-01-01",
    direction: "outflow",
    kind: "forecast",
    category: "po_payment",
    amount: 0,
    currency_code: "USD",
    fx_rate_to_base: 1,
    amount_base: 0,
    base_currency_code: "USD",
    reference_type: null,
    reference_id: null,
    voided: false,
    voided_at: null,
    voided_by: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("normalizePeriod / addMonths / monthRange", () => {
  it("normalizes to month start", () => {
    expect(normalizePeriod("2026-03-27")).toBe("2026-03-01");
  });
  it("adds months across year boundary", () => {
    expect(addMonths("2026-11-01", 3)).toBe("2027-02-01");
    expect(addMonths("2026-02-01", -3)).toBe("2025-11-01");
  });
  it("builds inclusive month range", () => {
    expect(monthRange("2026-01-15", "2026-03-05")).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });
});

describe("buildPivot", () => {
  const months = monthRange("2026-01-01", "2026-04-01");

  it("empties gracefully", () => {
    const p = buildPivot([], months);
    expect(p.rows).toEqual([]);
    expect(p.peakFundingRequirement).toBe(0);
    expect(p.peakFundingPeriod).toBeNull();
  });

  it("computes peak funding as the deepest cumulative dip", () => {
    // Feb: -500k outflow, Mar: +800k inflow → dip at Feb = -500k, peak later = +300k
    const rows = [
      row({
        period: "2026-02-01",
        direction: "outflow",
        kind: "forecast",
        category: "po_payment",
        amount: 500000,
        amount_base: 500000,
      }),
      row({
        period: "2026-03-01",
        direction: "inflow",
        kind: "forecast",
        category: "milestone_billing",
        amount: 800000,
        amount_base: 800000,
      }),
    ];
    const p = buildPivot(rows, months);
    expect(p.peakFundingRequirement).toBe(-500_000);
    expect(p.peakFundingPeriod).toBe("2026-02-01");
    const feb = p.netCumulative.find((r) => r.period === "2026-02-01")!;
    const mar = p.netCumulative.find((r) => r.period === "2026-03-01")!;
    expect(feb.forecastCum).toBe(-500_000);
    expect(mar.forecastCum).toBe(300_000);
  });

  it("excludes voided rows from totals", () => {
    const rows = [
      row({ amount: 100, amount_base: 100, direction: "outflow" }),
      row({ amount: 100, amount_base: 100, direction: "outflow", voided: true }),
    ];
    const p = buildPivot(rows, months);
    expect(p.rows[0]!.totalForecast).toBe(100);
  });
});
