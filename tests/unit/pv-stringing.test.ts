// P-154 — Unit tests for the pure PV stringing engine.
import { describe, expect, it } from "vitest";

import {
  RHO_COPPER_20C,
  balancedSplit,
  cableLossKw,
  generateStringing,
  routeLengthM,
  voltageDropV,
  type StringingInput,
} from "@/lib/pv/stringing";

const MODULE = {
  id: null,
  pmaxW: 580,
  vocV: 52.0,
  vmpV: 43.4,
  iscA: 14.0,
  impA: 13.4,
  tempCoeffVocPctPerC: -0.25,
};

const INVERTER = {
  id: null,
  acKw: 250,
  maxDcV: 1500,
  mpptMinV: 500,
  mpptMaxV: 1500,
  mpptCount: 12,
  maxInputAPerMppt: 30,
};

function baseInput(overrides: Partial<StringingInput> = {}): StringingInput {
  return {
    module: MODULE,
    inverter: INVERTER,
    combiner: { id: null, inputs: 16 },
    dcCable: { id: null, crossSectionMm2: 6, material: "copper", tempFactor: 1 },
    mvCable: { id: null, crossSectionMm2: 240, material: "aluminium" },
    transformer: { id: null, ratedKva: 2500, mvKv: 33 },
    site: { minTempC: -5, maxTempC: 70 },
    blocks: Array.from({ length: 8 }, (_, i) => ({
      blockId: null,
      label: `T${i + 1}`,
      centroid: { x: i * 50, y: 100 },
      moduleCount: 56,
    })),
    inverterStations: [
      { label: "INV-01", centroid: { x: 100, y: 0 } },
      { label: "INV-02", centroid: { x: 300, y: 0 } },
    ],
    transformerStations: [{ label: "TX-01", centroid: { x: 200, y: -50 } }],
    modulesInSeries: 26,
    routingFactor: 1.15,
    ...overrides,
  };
}

describe("P-154 stringing engine", () => {
  it("matches Vdrop = 2·L·I·rho/A to three decimals", () => {
    const cable = { crossSectionMm2: 6, material: "copper" as const, tempFactor: 1 };
    const expected = (2 * 250 * 13.4 * RHO_COPPER_20C) / 6;
    expect(voltageDropV(250, 13.4, cable)).toBeCloseTo(expected, 3);
    expect(cableLossKw(250, 13.4, cable)).toBeCloseTo(
      (13.4 * 13.4 * ((2 * 250 * RHO_COPPER_20C) / 6)) / 1000,
      3,
    );
  });

  it("applies the routing factor to the block → combiner → inverter polyline", () => {
    const len = routeLengthM({ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 140 }, 1.15);
    expect(len).toBeCloseTo((50 + 100) * 1.15, 3);
  });

  it("marks strings invalid with an explicit warning when cold Voc exceeds inverter max", () => {
    const res = generateStringing(baseInput({ modulesInSeries: 29 }));
    expect(res.strings.length).toBeGreaterThan(0);
    expect(res.strings.every((s) => s.valid)).toBe(false);
    expect(res.strings[0].vocAtMinTempV).toBeGreaterThan(1500);
    const warn = res.warnings.find((w) => w.code === "voc_exceeds_inverter_max");
    expect(warn?.message).toContain("exceeds the inverter maximum");
  });

  it("warns when hot Vmp falls below the MPPT minimum", () => {
    const res = generateStringing(baseInput({ modulesInSeries: 10 }));
    expect(res.warnings.some((w) => w.code === "vmp_below_mppt_min")).toBe(true);
    expect(res.strings.every((s) => s.valid)).toBe(false);
  });

  it("never exceeds mppt_count or the per-MPPT current limit, imbalance ≤ 1 string", () => {
    const res = generateStringing(baseInput());
    const perMppt = new Map<string, number>();
    for (const a of res.allocations) {
      expect(a.mpptIndex).toBeLessThanOrEqual(INVERTER.mpptCount);
      expect(a.currentA).toBeLessThanOrEqual(INVERTER.maxInputAPerMppt);
      perMppt.set(`${a.inverterStationLabel}-${a.mpptIndex}`, a.stringLabels.length);
    }
    const counts = [...perMppt.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(res.allocations).toHaveLength(2 * INVERTER.mpptCount);
  });

  it("splits evenly with at most one string of imbalance", () => {
    expect(balancedSplit(10, 4)).toEqual([3, 3, 2, 2]);
    expect(balancedSplit(0, 3)).toEqual([0, 0, 0]);
  });

  it("warns instead of silently dropping strings when MPPT capacity is exceeded", () => {
    const res = generateStringing(
      baseInput({ inverterStations: [{ label: "INV-01", centroid: { x: 100, y: 0 } }] }),
    );
    const warn = res.warnings.find((w) => w.code === "mppt_capacity_exceeded");
    expect(warn).toBeDefined();
    expect(warn?.refs).toContain("INV-01");
  });

  it("assigns combiners by input count and reports DC/AC ratio and loading", () => {
    const res = generateStringing(baseInput());
    const combiners = new Set(res.strings.map((s) => s.combinerLabel));
    expect(combiners.size).toBe(res.counts.combiners);
    for (const cb of combiners) {
      expect(res.strings.filter((s) => s.combinerLabel === cb).length).toBeLessThanOrEqual(16);
    }
    const alloc = res.allocations[0];
    expect(alloc.dcAcRatio).toBeCloseTo(alloc.inverterDcKwp / alloc.inverterAcKw, 3);
    expect(alloc.loadingPct).toBeCloseTo(alloc.dcAcRatio * 100, 1);
  });

  it("builds MV feeders with transformer loading", () => {
    const res = generateStringing(baseInput({ invertersPerFeeder: 2 }));
    expect(res.feeders).toHaveLength(1);
    const feeder = res.feeders[0];
    expect(feeder.stationLabels).toEqual(["INV-01", "INV-02"]);
    expect(feeder.voltageKv).toBe(33);
    expect(feeder.transformerLoadingPct).toBeGreaterThan(0);
    expect(feeder.lengthM).toBeGreaterThan(0);
  });

  it("flags a missing transformer rather than assuming one", () => {
    const res = generateStringing(baseInput({ transformer: null }));
    expect(res.warnings.some((w) => w.code === "no_transformer_selected")).toBe(true);
    expect(res.counts.transformers).toBe(0);
  });

  it("equipment counts equal the generated rows exactly", () => {
    const res = generateStringing(baseInput());
    expect(res.counts.strings).toBe(res.strings.length);
    expect(res.counts.modules).toBe(res.strings.length * 26);
    expect(res.counts.inverters).toBe(2);
    expect(res.counts.dc_cable_m).toBeCloseTo(
      Number(res.strings.reduce((s, x) => s + x.cable.lengthM, 0).toFixed(1)),
      1,
    );
    expect(res.counts.mv_cable_m).toBeCloseTo(
      Number(res.feeders.reduce((s, f) => s + f.lengthM, 0).toFixed(1)),
      1,
    );
    expect(res.totals.dcKwp).toBeCloseTo((res.counts.modules * 580) / 1000, 1);
  });

  it("reports orphan modules that cannot complete a string", () => {
    const res = generateStringing(
      baseInput({
        blocks: [{ blockId: null, label: "T1", centroid: { x: 0, y: 0 }, moduleCount: 60 }],
      }),
    );
    const warn = res.warnings.find((w) => w.code === "orphan_modules");
    expect(warn?.refs).toEqual(["T1"]);
    expect(res.counts.strings).toBe(2);
  });

  it("is deterministic", () => {
    const a = generateStringing(baseInput());
    const b = generateStringing(baseInput());
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});
