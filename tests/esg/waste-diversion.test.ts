// P-220 — Waste diversion rate: recyclable ÷ total, null on zero total.
import { describe, expect, it } from "vitest";
import { diversionRate } from "@/lib/esg/dashboard.rules";

describe("diversionRate", () => {
  it("300 kg recyclable of 1,200 kg total = 25.0%", () => {
    const r = diversionRate(300, 1200);
    expect(r.pct).toBe(25);
    expect(r.reason).toBeUndefined();
  });

  it("returns null (n/a) with zero total waste — no NaN, no divide-by-zero", () => {
    const r = diversionRate(0, 0);
    expect(r.pct).toBeNull();
    expect(r.reason).toBe("no_waste_data");
    expect(Number.isNaN(r.pct as unknown as number)).toBe(false);
  });

  it("handles full diversion", () => {
    expect(diversionRate(1200, 1200).pct).toBe(100);
  });
});
