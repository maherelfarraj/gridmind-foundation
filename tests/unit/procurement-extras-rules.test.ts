// P-070 — Unit tests for procurement-extras rules & zod.
import { describe, expect, it } from "vitest";
import {
  alertSubscriptionSchema,
  applyStockDelta,
  computeChangePct,
  isLowStock,
  priceObservationSchema,
  shouldTrigger,
  sparePartSchema,
  stockAdjustSchema,
} from "@/lib/procurement-extras-rules";

describe("computeChangePct", () => {
  it("returns null when previous is null/zero", () => {
    expect(computeChangePct(null, 1)).toBeNull();
    expect(computeChangePct(0, 1)).toBeNull();
    expect(computeChangePct(1, null)).toBeNull();
  });
  it("computes 0.120 → 0.131 as +9.17%", () => {
    expect(computeChangePct(0.12, 0.131)).toBeCloseTo(9.17, 2);
  });
  it("handles negative moves", () => {
    expect(computeChangePct(100, 90)).toBe(-10);
  });
});

describe("shouldTrigger", () => {
  it("triggers when |change| ≥ threshold", () => {
    expect(shouldTrigger(9.17, 5)).toBe(true);
    expect(shouldTrigger(-6, 5)).toBe(true);
    expect(shouldTrigger(5, 5)).toBe(true);
  });
  it("does not trigger under threshold or null", () => {
    expect(shouldTrigger(4.9, 5)).toBe(false);
    expect(shouldTrigger(null, 5)).toBe(false);
    expect(shouldTrigger(10, 0)).toBe(false);
  });
});

describe("isLowStock", () => {
  it("qty at or below reorder is low", () => {
    expect(isLowStock(3, 5)).toBe(true);
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
  });
});

describe("applyStockDelta", () => {
  it("adds and subtracts, floored at zero", () => {
    expect(applyStockDelta(5, 3)).toBe(8);
    expect(applyStockDelta(5, -3)).toBe(2);
    expect(applyStockDelta(2, -10)).toBe(0);
  });
});

describe("zod schemas", () => {
  it("alertSubscriptionSchema requires threshold > 0", () => {
    expect(() =>
      alertSubscriptionSchema.parse({
        category: "module",
        region: "global",
        unit: "USD/Wp",
        currency_code: "usd",
        alert_threshold_pct: 0,
      }),
    ).toThrow();
    const ok = alertSubscriptionSchema.parse({
      category: "module",
      region: "global",
      unit: "USD/Wp",
      currency_code: "usd",
      alert_threshold_pct: 5,
    });
    expect(ok.currency_code).toBe("USD");
  });

  it("priceObservationSchema requires non-negative price", () => {
    expect(() =>
      priceObservationSchema.parse({
        id: "00000000-0000-0000-0000-000000000000",
        index_price: -1,
      }),
    ).toThrow();
  });

  it("sparePartSchema requires part_number and name", () => {
    expect(() => sparePartSchema.parse({ part_number: "", name: "x" })).toThrow();
    const ok = sparePartSchema.parse({
      part_number: "INV-FAN-01",
      name: "Inverter fan",
      reorder_point: 5,
      qty_on_hand: 3,
    });
    expect(ok.category).toBe("other");
  });

  it("stockAdjustSchema requires a reason and non-zero delta", () => {
    expect(() =>
      stockAdjustSchema.parse({
        id: "00000000-0000-0000-0000-000000000000",
        delta: 0,
        reason: "restock",
      }),
    ).toThrow();
    expect(() =>
      stockAdjustSchema.parse({
        id: "00000000-0000-0000-0000-000000000000",
        delta: 2,
        reason: "",
      }),
    ).toThrow();
    const ok = stockAdjustSchema.parse({
      id: "00000000-0000-0000-0000-000000000000",
      delta: 2,
      reason: "Restocked from supplier",
    });
    expect(ok.delta).toBe(2);
  });
});
