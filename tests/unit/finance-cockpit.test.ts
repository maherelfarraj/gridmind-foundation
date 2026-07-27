// P-196 — Finance cockpit pure-rule tests.
import { describe, expect, it } from "vitest";

import {
  aggregateCashTrend,
  budgetStatus,
  cashPositionStatus,
  coExposureStatus,
  lastMonthKeys,
  monthBounds,
  percent,
  sumPayments,
  trendRange,
  type CashFlowRow,
} from "@/lib/finance-cockpit.rules";

describe("period helpers", () => {
  it("computes inclusive month bounds", () => {
    expect(monthBounds("2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthBounds("2024-02-05").end).toBe("2024-02-29");
    expect(monthBounds("2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("returns six month keys oldest first, crossing the year boundary", () => {
    expect(lastMonthKeys("2026-02-14", 6)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("spans the full trend range", () => {
    expect(trendRange("2026-02-14", 6)).toEqual({ start: "2025-09-01", end: "2026-02-28" });
  });
});

describe("cash trend aggregation", () => {
  const months = lastMonthKeys("2026-02-01", 3); // 2025-12, 2026-01, 2026-02

  it("sums actuals by direction and nets them, ignoring voided rows", () => {
    const rows: CashFlowRow[] = [
      { period: "2026-01-10", direction: "inflow", kind: "actual", amount_base: 1000 },
      { period: "2026-01-20", direction: "outflow", kind: "actual", amount_base: 400 },
      { period: "2026-01-25", direction: "inflow", kind: "actual", amount_base: 500, voided: true },
      { period: "2026-02-02", direction: "outflow", kind: "actual", amount_base: 250 },
    ];
    const out = aggregateCashTrend(rows, months);
    expect(out.map((p) => p.month)).toEqual(months);
    expect(out[1]).toMatchObject({ inflow: 1000, outflow: 400, net: 600 });
    expect(out[2]).toMatchObject({ inflow: 0, outflow: 250, net: -250 });
    expect(out[0]).toMatchObject({ inflow: 0, outflow: 0, net: 0, forecast_net: null });
  });

  it("keeps forecast net on a separate series and drops out-of-range rows", () => {
    const rows: CashFlowRow[] = [
      { period: "2026-02-01", direction: "inflow", kind: "forecast", amount_base: 900 },
      { period: "2026-02-01", direction: "outflow", kind: "forecast", amount_base: 300 },
      { period: "2020-01-01", direction: "inflow", kind: "actual", amount_base: 99999 },
    ];
    const out = aggregateCashTrend(rows, months);
    expect(out[2].forecast_net).toBe(600);
    expect(out[2].inflow).toBe(0);
    expect(out.reduce((a, p) => a + p.inflow, 0)).toBe(0);
  });
});

describe("tile math", () => {
  it("splits payments by direction", () => {
    const rows = [
      { direction: "receivable", amount_base: 100 },
      { direction: "receivable", amount_base: 50 },
      { direction: "payable", amount_base: 30 },
    ];
    expect(sumPayments(rows, "receivable")).toBe(150);
    expect(sumPayments(rows, "payable")).toBe(30);
  });

  it("guards divide-by-zero", () => {
    expect(percent(5, 0)).toBeNull();
    expect(percent(5, 50)).toBe(10);
  });
});

describe("status thresholds", () => {
  it("flags budget consumption at 85% and 100%", () => {
    expect(budgetStatus(null)).toBe("neutral");
    expect(budgetStatus(84)).toBe("good");
    expect(budgetStatus(85)).toBe("good");
    expect(budgetStatus(85.1)).toBe("warning");
    expect(budgetStatus(100)).toBe("warning");
    expect(budgetStatus(100.1)).toBe("bad");
  });

  it("flags CO exposure at 5% and 10%", () => {
    expect(coExposureStatus(null)).toBe("neutral");
    expect(coExposureStatus(5)).toBe("good");
    expect(coExposureStatus(5.5)).toBe("warning");
    expect(coExposureStatus(10)).toBe("warning");
    expect(coExposureStatus(11)).toBe("bad");
  });

  it("flags negative cash position", () => {
    expect(cashPositionStatus(-1)).toBe("bad");
    expect(cashPositionStatus(0)).toBe("good");
    expect(cashPositionStatus(null)).toBe("neutral");
  });
});

describe("safeRows degradation", () => {
  it("returns null for a missing table (42P01) and rethrows other errors", async () => {
    const { safeRows } = await import("@/lib/finance-cockpit.server");
    await expect(
      safeRows(async () => ({ data: null, error: { code: "42P01", message: "does not exist" } })),
    ).resolves.toBeNull();
    await expect(
      safeRows(async () => ({ data: null, error: { code: "PGRST205", message: "no table" } })),
    ).resolves.toBeNull();
    await expect(safeRows(async () => ({ data: [{ a: 1 }], error: null }))).resolves.toEqual([
      { a: 1 },
    ]);
    await expect(
      safeRows(async () => ({ data: null, error: { code: "42501", message: "denied" } })),
    ).rejects.toBeTruthy();
  });
});
