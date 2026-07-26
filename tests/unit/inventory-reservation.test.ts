import { describe, expect, it } from "vitest";
import { available, canReserve, applyIssuance } from "@/lib/construction/inventory";

describe("P-186 · inventory reservation math", () => {
  it("available = on hand − reserved, floored at zero", () => {
    expect(available(100, 40)).toBe(60);
    expect(available(10, 25)).toBe(0);
  });

  it("canReserve: exact fit is allowed (reserved == on hand after)", () => {
    const onHand = 50;
    const reserved = 20;
    const avail = available(onHand, reserved); // 30
    expect(canReserve(30, avail)).toBe(true);
    expect(reserved + 30).toBe(onHand); // qty_reserved <= qty_on_hand holds
  });

  it("canReserve: oversell by epsilon is refused", () => {
    expect(canReserve(30.001, available(50, 20))).toBe(false);
  });

  it.each([0, -1, -0.5, Number.NaN])("canReserve: qty %s is refused", (qty) => {
    expect(canReserve(qty as number, 100)).toBe(false);
  });

  it("applyIssuance decrements reserved and on hand together", () => {
    expect(applyIssuance({ onHand: 100, reserved: 40, qty: 15 })).toEqual({
      onHand: 85,
      reserved: 25,
    });
  });

  it("applyIssuance refuses qty greater than reserved", () => {
    expect(() => applyIssuance({ onHand: 100, reserved: 10, qty: 10.5 })).toThrow();
    expect(() => applyIssuance({ onHand: 100, reserved: 10, qty: 0 })).toThrow();
  });

  it("double-reserve of the last unit: first succeeds, second sees recomputed availability", () => {
    const stock = { onHand: 5, reserved: 4 };
    const first = canReserve(1, available(stock.onHand, stock.reserved));
    expect(first).toBe(true);
    stock.reserved += 1; // commit the first reservation

    const second = canReserve(1, available(stock.onHand, stock.reserved));
    expect(second).toBe(false);
    expect(stock.reserved).toBeLessThanOrEqual(stock.onHand);
  });
});
