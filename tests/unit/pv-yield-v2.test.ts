import { describe, expect, it } from "vitest";

import {
  inverterEfficiencyAt,
  runYieldV2,
  YIELD_CALC_VERSION,
  YIELD_DISCLAIMER,
  YIELD_ENGINE_ID,
  type YieldInput,
} from "@/lib/pv/yield-v2";

const base: YieldInput = {
  latitudeDeg: 31.9,
  tiltDeg: 25,
  azimuthDeg: 0,
  albedo: 0.2,
  tracker: null,
  gcr: 0.4,
  monthlyGhiKwhM2: [110, 125, 165, 190, 215, 235, 235, 220, 190, 155, 120, 100],
  monthlyAmbientTempC: [10, 11, 14, 19, 24, 27, 29, 29, 27, 23, 17, 12],
  monthlyDiffuseFraction: null,
  monthlySoilingPct: [2, 2, 3, 4, 5, 6, 6, 6, 5, 4, 3, 2],
  arrayDcKwp: 50000,
  inverterAcKw: 40000,
  modulePmaxPctPerC: -0.34,
  moduleNoctC: 44,
  degradationYear1Pct: 1.5,
  mismatchPct: 1.5,
  dcWiringLossPct: 1.2,
  inverterEffCurve: [
    { loadFraction: 0.05, effPct: 92 },
    { loadFraction: 0.2, effPct: 97.5 },
    { loadFraction: 0.5, effPct: 98.6 },
    { loadFraction: 1, effPct: 98.2 },
  ],
  transformerLossPct: 1,
  mvCollectionLossPct: 0.6,
  gridAvailabilityPct: 99.5,
  plantAvailabilityPct: 99,
  gridLimitKw: null,
  auxiliaryLoadKw: 40,
  bess: null,
  interannualVariabilitySigmaPct: 3.5,
  daylightHours: 12,
  loadShapeFactor: 0.6,
  inputSources: { ghi: "meteonorm-2024" },
  computedAt: "2026-01-01T00:00:00.000Z",
};

describe("yield-v2 engine", () => {
  it("is deterministic for identical inputs", () => {
    expect(JSON.stringify(runYieldV2(base))).toBe(JSON.stringify(runYieldV2({ ...base })));
  });

  it("stamps engine metadata and the disclaimer", () => {
    const out = runYieldV2(base);
    expect(out.engine_id).toBe(YIELD_ENGINE_ID);
    expect(out.calc_version).toBe(YIELD_CALC_VERSION);
    expect(out.disclaimer).toBe(YIELD_DISCLAIMER);
    expect(out.computed_at).toBe(base.computedAt);
  });

  it("walks 16 loss steps, each with formula, inputs and sources", () => {
    const out = runYieldV2(base);
    expect(out.loss_chain).toHaveLength(16);
    for (const step of out.loss_chain) {
      expect(step.formula.length).toBeGreaterThan(5);
      expect(Object.keys(step.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.input_sources).length).toBeGreaterThan(0);
      expect(step.monthly_kwh).toHaveLength(12);
    }
    expect(out.loss_chain.map((s) => s.step)).toEqual([
      "poa_irradiance",
      "temperature",
      "soiling",
      "shading",
      "mismatch",
      "dc_wiring",
      "inverter",
      "clipping",
      "transformer",
      "mv_collection",
      "grid_availability",
      "plant_availability",
      "curtailment",
      "degradation",
      "auxiliary",
      "bess_round_trip",
    ]);
  });

  it("final loss step energy matches the annual net within rounding", () => {
    const out = runYieldV2(base);
    const last = out.loss_chain[out.loss_chain.length - 1];
    expect(Math.abs(last.energy_kwh - out.annual.energy_kwh)).toBeLessThan(1);
    const monthlySum = out.monthly.reduce((a, m) => a + m.energy_kwh, 0);
    expect(Math.abs(monthlySum - out.annual.energy_kwh)).toBeLessThan(1);
  });

  it("produces plausible specific yield, PR and capacity factor", () => {
    const out = runYieldV2(base);
    expect(out.annual.specific_yield_kwh_per_kwp).toBeGreaterThan(1200);
    expect(out.annual.specific_yield_kwh_per_kwp).toBeLessThan(2400);
    expect(out.annual.performance_ratio_pct).toBeGreaterThan(65);
    expect(out.annual.performance_ratio_pct).toBeLessThan(92);
    expect(out.annual.capacity_factor_pct).toBeGreaterThan(10);
  });

  it("enforces the P50 >= P75 >= P90 >= P99 ordering", () => {
    const p = runYieldV2(base).p_scenarios;
    expect(p.p50_kwh).toBeGreaterThanOrEqual(p.p75_kwh!);
    expect(p.p75_kwh).toBeGreaterThanOrEqual(p.p90_kwh!);
    expect(p.p90_kwh).toBeGreaterThanOrEqual(p.p99_kwh!);
  });

  it("returns null P-scenarios with insufficient_data when sigma is missing", () => {
    const out = runYieldV2({ ...base, interannualVariabilitySigmaPct: null });
    expect(out.p_scenarios.p75_kwh).toBeNull();
    expect(out.p_scenarios.p90_kwh).toBeNull();
    expect(out.p_scenarios.p99_kwh).toBeNull();
    expect(out.p_scenarios.note).toContain("insufficient_data");
    expect(out.warnings.some((w) => w.code === "insufficient_data")).toBe(true);
  });

  it("applies a BESS round-trip loss only when configured", () => {
    const withBess = runYieldV2({
      ...base,
      bess: { roundTripEffPct: 88, throughputFraction: 0.3, libraryId: null },
    });
    const noBess = runYieldV2(base);
    expect(withBess.annual.energy_kwh).toBeLessThan(noBess.annual.energy_kwh);
    expect(noBess.loss_chain[15].loss_pct).toBe(0);
    expect(withBess.loss_chain[15].loss_pct).toBeCloseTo(3.6, 3);
  });

  it("curtails against the site grid limit", () => {
    const limited = runYieldV2({ ...base, gridLimitKw: 20000 });
    expect(limited.loss_chain[12].loss_pct).toBeGreaterThan(0);
    expect(limited.annual.energy_kwh).toBeLessThan(runYieldV2(base).annual.energy_kwh);
  });

  it("interpolates the inverter efficiency curve piecewise", () => {
    const curve = base.inverterEffCurve;
    expect(inverterEfficiencyAt(curve, 0.2)).toBeCloseTo(97.5, 6);
    expect(inverterEfficiencyAt(curve, 0.35)).toBeCloseTo(98.05, 6);
    expect(inverterEfficiencyAt(curve, 0.01)).toBe(92);
    expect(inverterEfficiencyAt(curve, 2)).toBe(98.2);
  });

  it("gains energy with single-axis tracking", () => {
    const tracked = runYieldV2({ ...base, tracker: { type: "single_axis", maxAngleDeg: 55 } });
    expect(tracked.annual.energy_kwh).toBeGreaterThan(runYieldV2(base).annual.energy_kwh);
  });
});
