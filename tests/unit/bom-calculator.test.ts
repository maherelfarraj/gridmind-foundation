import { describe, expect, it } from "vitest";
import {
  applyBuffer,
  computeBom,
  DEFAULT_BUFFERS,
  sumBomCost,
} from "@/lib/calculators/bom";

describe("applyBuffer", () => {
  it("ceils integer-unit categories to the next whole", () => {
    expect(applyBuffer(1000, 0.5, "modules")).toBe(1005);
    expect(applyBuffer(1000, 0.55, "modules")).toBe(1006);
    expect(applyBuffer(41, 0, "inverters")).toBe(41);
    expect(applyBuffer(9, 5, "structures")).toBe(10);
  });

  it("rounds cable/BOS categories to 4 decimals", () => {
    expect(applyBuffer(100, 10, "cables")).toBe(110);
    expect(applyBuffer(100.12345, 10, "cables")).toBe(110.1358);
    expect(applyBuffer(1, 5, "bos")).toBe(1.05);
  });

  it("never returns a negative", () => {
    expect(applyBuffer(-5, 10, "cables")).toBe(0);
    expect(applyBuffer(0, 10, "modules")).toBe(0);
  });

  it("handles NaN inputs by treating them as zero", () => {
    expect(applyBuffer(Number.NaN, 10, "cables")).toBe(0);
    expect(applyBuffer(100, Number.NaN, "cables")).toBe(100);
  });
});

describe("computeBom — Prairie Winds fixture", () => {
  const lines = computeBom({
    capacity_mwp_dc: 175,
    module_wp: 550,
    dc_ac_ratio: 1.3,
    inverter_count: 42,
    tracker_type: "single_axis",
  });

  it("computes the module count from MWp / module Wp", () => {
    const modules = lines.find((l) => l.category === "modules")!;
    // 175_000 kWp / 550 Wp = 318.18… → ceil → 318,182
    expect(modules.qty).toBe(318_182);
    expect(modules.buffer_pct).toBe(DEFAULT_BUFFERS.modules);
    // 318182 × 1.005 = 319772.91 → ceil → 319,773
    expect(modules.qty_buffered).toBe(319_773);
  });

  it("uses the supplied inverter count with 0% buffer", () => {
    const inv = lines.find((l) => l.category === "inverters")!;
    expect(inv.qty).toBe(42);
    expect(inv.qty_buffered).toBe(42);
  });

  it("produces DC + MV cable lines with 10% buffer", () => {
    const cables = lines.filter((l) => l.category === "cables");
    expect(cables).toHaveLength(2);
    for (const c of cables) {
      expect(c.buffer_pct).toBe(DEFAULT_BUFFERS.cables);
      expect(c.qty_buffered).toBeCloseTo(c.qty * 1.1, 3);
    }
  });

  it("emits every required category at least once", () => {
    const categories = new Set(lines.map((l) => l.category));
    for (const c of ["modules", "inverters", "cables", "structures", "transformers", "bos"] as const) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it("is deterministic — repeat calls match", () => {
    const again = computeBom({
      capacity_mwp_dc: 175,
      module_wp: 550,
      dc_ac_ratio: 1.3,
      inverter_count: 42,
      tracker_type: "single_axis",
    });
    expect(again).toEqual(lines);
  });
});

describe("sumBomCost", () => {
  it("ignores lines without a unit cost", () => {
    expect(
      sumBomCost([
        { qty_buffered: 100, unit_cost: 2 },
        { qty_buffered: 50, unit_cost: null },
      ]),
    ).toBe(200);
  });

  it("rounds to cents", () => {
    expect(sumBomCost([{ qty_buffered: 4, unit_cost: 1.25 }])).toBe(5);
    expect(sumBomCost([{ qty_buffered: 3, unit_cost: 1.005 }])).toBeCloseTo(3.02, 1);
  });

});
