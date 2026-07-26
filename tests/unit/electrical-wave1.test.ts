// P-166 — Smoke tests for calculator wave 1. Fully offline: pure lib only.
import { describe, expect, it } from "vitest";

import {
  checkCableAmpacity,
  getCalculator,
  initialSymmetricalFault,
  kappaFromRx,
  radialLoadFlow,
  shortCircuitStudy,
  transformerLoading,
  voltageDrop,
  voltageFactor,
  WAVE1_STUDY_TYPES,
} from "@/lib/electrical";

const feeder = {
  baseMva: 100,
  sourceBusId: "B1",
  sourceVPu: 1,
  maxIterations: 50,
  buses: [
    { id: "B1", name: "Source", kvBase: 33, pKw: 0, qKvar: 0 },
    { id: "B2", name: "Mid", kvBase: 33, pKw: 1500, qKvar: 500 },
    { id: "B3", name: "End", kvBase: 33, pKw: 1000, qKvar: 300 },
  ],
  branches: [
    { fromBus: "B1", toBus: "B2", rOhm: 0.8, xOhm: 1.2 },
    { fromBus: "B2", toBus: "B3", rOhm: 0.6, xOhm: 0.9 },
  ],
};

describe("radialLoadFlow", () => {
  it("converges on a 3-bus radial feeder with sane voltages and losses", () => {
    const { results, warnings } = radialLoadFlow(feeder);
    expect(results.converged).toBe(true);
    expect(results.iterations).toBeLessThan(20);
    expect(results.buses).toHaveLength(3);
    expect(results.buses[0].vPu).toBeCloseTo(1, 6);
    // Voltage falls monotonically toward the end of the feeder.
    expect(results.buses[1].vPu).toBeLessThan(results.buses[0].vPu);
    expect(results.buses[2].vPu).toBeLessThan(results.buses[1].vPu);
    expect(results.totalLossKw).toBeGreaterThan(0);
    expect(warnings.filter((w) => w.severity === "critical")).toHaveLength(0);
  });

  it("echoes the full input sheet and is deterministic", () => {
    const a = radialLoadFlow(feeder);
    const b = radialLoadFlow(feeder);
    expect(a.results).toEqual(b.results);
    expect(a.results.inputSheet.buses).toHaveLength(3);
    expect(a.assumptionsEcho.map((x) => x.key)).toContain("base_mva");
  });

  it("flags a looped graph as critical and returns no solution", () => {
    const looped = {
      ...feeder,
      branches: [...feeder.branches, { fromBus: "B3", toBus: "B1", rOhm: 0.5, xOhm: 0.7 }],
    };
    const { results, warnings } = radialLoadFlow(looped);
    expect(results.converged).toBe(false);
    expect(warnings.some((w) => w.code === "loop_detected" && w.severity === "critical")).toBe(
      true,
    );
  });

  it("flags disconnected buses as critical", () => {
    const orphan = {
      ...feeder,
      buses: [...feeder.buses, { id: "B9", name: "Orphan", kvBase: 33, pKw: 10, qKvar: 0 }],
    };
    const { warnings } = radialLoadFlow(orphan);
    expect(warnings.some((w) => w.code === "disconnected_bus" && w.severity === "critical")).toBe(
      true,
    );
  });

  it("warns when a bus drifts outside the 0.95–1.05 pu band", () => {
    const heavy = {
      ...feeder,
      buses: feeder.buses.map((b) => (b.id === "B3" ? { ...b, pKw: 25000, qKvar: 12000 } : b)),
    };
    const { warnings } = radialLoadFlow(heavy);
    expect(warnings.some((w) => w.code === "voltage_out_of_band")).toBe(true);
  });
});

describe("initialSymmetricalFault", () => {
  it("returns I″k, ip and S″k with an R/X-derived κ", () => {
    const { results } = initialSymmetricalFault({
      unKv: 33,
      rOhm: 0.5,
      xOhm: 5,
      impedanceAssumed: false,
    });
    const z = Math.hypot(0.5, 5);
    expect(results.cFactor).toBe(1.1);
    expect(results.ikKa).toBeCloseTo((1.1 * 33) / (Math.sqrt(3) * z), 5);
    expect(results.kappa).toBeCloseTo(kappaFromRx(0.5, 5), 6);
    expect(results.ipKa).toBeCloseTo(results.kappa * Math.SQRT2 * results.ikKa, 5);
    expect(results.skMva).toBeCloseTo(Math.sqrt(3) * 33 * results.ikKa, 5);
  });

  it("uses c = 1.05 at low voltage and 1.10 above 1 kV", () => {
    expect(voltageFactor(0.4)).toBe(1.05);
    expect(voltageFactor(11)).toBe(1.1);
  });

  it("raises a critical warning when impedance is assumed or missing", () => {
    const assumed = initialSymmetricalFault({
      unKv: 11,
      rOhm: 0.2,
      xOhm: 2,
      impedanceAssumed: true,
    });
    expect(
      assumed.warnings.some((w) => w.code === "impedance_assumed" && w.severity === "critical"),
    ).toBe(true);

    const missing = initialSymmetricalFault({
      unKv: 11,
      rOhm: 0,
      xOhm: 0,
      impedanceAssumed: false,
    });
    expect(
      missing.warnings.some((w) => w.code === "impedance_missing" && w.severity === "critical"),
    ).toBe(true);
    expect(missing.results.ikKa).toBe(0);
  });

  it("chains feeder impedances so fault level falls downstream", () => {
    const { results } = shortCircuitStudy({
      unKv: 33,
      sourceROhm: 0.3,
      sourceXOhm: 3,
      impedanceAssumed: false,
      sections: [
        { busId: "B2", name: "Mid", rOhm: 0.4, xOhm: 0.6 },
        { busId: "B3", name: "End", rOhm: 0.4, xOhm: 0.6 },
      ],
    });
    expect(results.buses).toHaveLength(2);
    expect(results.buses[0].ikKa).toBeLessThan(results.source.ikKa);
    expect(results.buses[1].ikKa).toBeLessThan(results.buses[0].ikKa);
  });
});

describe("checkCableAmpacity", () => {
  it("derates for ambient temperature and grouping", () => {
    const base = checkCableAmpacity({
      loadA: 100,
      standardMm2: 50,
      material: "cu",
      installation: "buried",
      ambientC: 30,
      groupingFactor: 1,
    });
    const hot = checkCableAmpacity({
      loadA: 100,
      standardMm2: 50,
      material: "cu",
      installation: "buried",
      ambientC: 50,
      groupingFactor: 0.8,
    });
    expect(base.results.deratedA).toBeCloseTo(180, 3);
    expect(hot.results.deratedA).toBeLessThan(base.results.deratedA);
    expect(hot.results.temperatureFactor).toBeCloseTo(0.71, 4);
    expect(base.results.ok).toBe(true);
  });

  it("flags an overloaded conductor as critical", () => {
    const { results, warnings } = checkCableAmpacity({
      loadA: 300,
      standardMm2: 50,
      material: "al",
      installation: "buried",
      ambientC: 45,
      groupingFactor: 0.7,
    });
    expect(results.ok).toBe(false);
    expect(warnings.some((w) => w.code === "ampacity_exceeded" && w.severity === "critical")).toBe(
      true,
    );
  });
});

describe("voltageDrop", () => {
  it("honours the configurable limit", () => {
    const input = {
      currentA: 150,
      lengthM: 300,
      mm2: 95,
      phases: 3 as const,
      powerFactor: 0.95,
      material: "cu" as const,
      voltageV: 400,
    };
    const strict = voltageDrop({ ...input, limitPct: 1 });
    const relaxed = voltageDrop({ ...input, limitPct: 20 });
    expect(strict.results.dropPct).toBeCloseTo(relaxed.results.dropPct, 6);
    expect(strict.results.ok).toBe(false);
    expect(relaxed.results.ok).toBe(true);
    expect(
      strict.warnings.some((w) => w.code === "voltage_drop_exceeded" && w.severity === "critical"),
    ).toBe(true);
  });

  it("defaults to a 4% limit and doubles the factor on single phase", () => {
    const three = voltageDrop({
      currentA: 40,
      lengthM: 60,
      mm2: 16,
      phases: 3,
      powerFactor: 1,
      material: "cu",
      voltageV: 400,
    });
    const single = voltageDrop({
      currentA: 40,
      lengthM: 60,
      mm2: 16,
      phases: 1,
      powerFactor: 1,
      material: "cu",
      voltageV: 400,
    });
    expect(three.results.limitPct).toBe(4);
    expect(single.results.dropV / three.results.dropV).toBeCloseTo(2 / Math.sqrt(3), 4);
  });
});

describe("transformerLoading", () => {
  it("vector-sums the loads and suggests an upsize", () => {
    const { results, warnings } = transformerLoading({
      ratingKva: 1000,
      loads: [
        { label: "MV aux", pKw: 600, qKvar: 200 },
        { label: "BESS aux", pKw: 400, qKvar: 150 },
      ],
      growthPct: 10,
      units: 1,
      nMinus1: false,
      targetLoadingPct: 80,
    });
    expect(results.loadKva).toBeCloseTo(Math.hypot(1000, 350), 4);
    expect(results.designKva).toBeCloseTo(Math.hypot(1000, 350) * 1.1, 4);
    expect(results.loadingPct).toBeGreaterThan(100);
    expect(results.suggestedKva).toBeGreaterThan(1000);
    expect(results.upsizeRequired).toBe(true);
    expect(
      warnings.some((w) => w.code === "transformer_overloaded" && w.severity === "critical"),
    ).toBe(true);
  });

  it("emits an info warning above the 80% target only", () => {
    const { results, warnings } = transformerLoading({
      ratingKva: 1250,
      loads: [{ label: "Aux", pKw: 1100, qKvar: 0 }],
      growthPct: 0,
      units: 1,
      nMinus1: false,
      targetLoadingPct: 80,
    });
    expect(results.loadingPct).toBeCloseTo(88, 1);
    expect(
      warnings.some((w) => w.code === "transformer_loading_high" && w.severity === "info"),
    ).toBe(true);
  });

  it("runs the n-1 check when parallel units are declared", () => {
    const firm = transformerLoading({
      ratingKva: 1000,
      loads: [{ label: "Aux", pKw: 900, qKvar: 0 }],
      growthPct: 0,
      units: 2,
      nMinus1: true,
      targetLoadingPct: 80,
    });
    expect(firm.results.nMinus1LoadingPct).toBeCloseTo(90, 4);
    expect(firm.results.nMinus1Ok).toBe(true);

    const notFirm = transformerLoading({
      ratingKva: 1000,
      loads: [{ label: "Aux", pKw: 1600, qKvar: 0 }],
      growthPct: 0,
      units: 2,
      nMinus1: true,
      targetLoadingPct: 80,
    });
    expect(notFirm.results.nMinus1Ok).toBe(false);
    expect(
      notFirm.warnings.some((w) => w.code === "n_minus_1_overload" && w.severity === "critical"),
    ).toBe(true);
  });
});

describe("calculator registry", () => {
  it("exposes a schema, METHOD text and compute fn per wave-1 study type", () => {
    expect(WAVE1_STUDY_TYPES).toEqual([
      "load_flow",
      "short_circuit",
      "cable_ampacity",
      "voltage_drop",
      "transformer_loading",
    ]);
    for (const type of WAVE1_STUDY_TYPES) {
      const calc = getCalculator(type);
      expect(calc.method.length).toBeGreaterThan(80);
      expect(calc.inputSchema).toBeDefined();
      expect(typeof calc.compute).toBe("function");
    }
  });

  it("rejects an invalid input sheet through the calculator schema", () => {
    expect(() => getCalculator("cable_ampacity").compute({ loadA: -5, standardMm2: 50 })).toThrow();
  });
});
