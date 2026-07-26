// P-158 — DC cable voltage-drop and loss math on known fixtures.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUTING_FACTOR,
  RHO_COPPER_20C,
  cableLossKw,
  routeLengthM,
  voltageDropV,
  type CableSpec,
} from "@/lib/pv/stringing";

const COPPER_4MM: CableSpec = { id: null, crossSectionMm2: 4, material: "copper", tempFactor: 1 };

describe("P-158 DC cable math", () => {
  it("Vdrop = 2·100·10·0.0172/4 = 8.6 V exactly", () => {
    expect(RHO_COPPER_20C).toBe(0.0172);
    expect(voltageDropV(100, 10, COPPER_4MM)).toBeCloseTo(8.6, 3);
  });

  it("loss % derives from the same I²R resistance", () => {
    const r = (2 * 100 * RHO_COPPER_20C) / 4; // ohms
    const lossKw = cableLossKw(100, 10, COPPER_4MM);
    expect(lossKw).toBeCloseTo((10 * 10 * r) / 1000, 6);
    // Loss fraction of a 5 kW circuit, expressed as a percentage.
    expect((lossKw / 5) * 100).toBeCloseTo(((10 * 10 * r) / 1000 / 5) * 100, 6);
  });

  it("applies the 1.15 routing factor once, multiplicatively", () => {
    const raw = 50 + 100;
    expect(DEFAULT_ROUTING_FACTOR).toBe(1.15);
    const routed = routeLengthM({ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 140 });
    expect(routed).toBeCloseTo(raw * 1.15, 3);
    // Drop over the routed length is the unrouted drop × 1.15 — never squared.
    expect(voltageDropV(routed, 10, COPPER_4MM)).toBeCloseTo(
      voltageDropV(raw, 10, COPPER_4MM) * 1.15,
      6,
    );
  });

  it("temperature factor scales resistivity linearly", () => {
    const hot: CableSpec = { ...COPPER_4MM, tempFactor: 1.2 };
    expect(voltageDropV(100, 10, hot)).toBeCloseTo(8.6 * 1.2, 3);
  });

  it("aluminium uses its own resistivity", () => {
    const al: CableSpec = { ...COPPER_4MM, material: "aluminium" };
    expect(voltageDropV(100, 10, al)).toBeCloseTo((2 * 100 * 10 * 0.0282) / 4, 3);
  });

  it("zero length, zero current and zero area return 0, never NaN", () => {
    for (const v of [
      voltageDropV(0, 10, COPPER_4MM),
      voltageDropV(100, 0, COPPER_4MM),
      voltageDropV(100, 10, { ...COPPER_4MM, crossSectionMm2: 0 }),
      cableLossKw(0, 10, COPPER_4MM),
      cableLossKw(100, 0, COPPER_4MM),
      cableLossKw(100, 10, { ...COPPER_4MM, crossSectionMm2: 0 }),
    ]) {
      expect(Number.isNaN(v)).toBe(false);
      expect(v).toBe(0);
    }
  });
});
