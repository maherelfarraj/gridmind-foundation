// P-158 — P-scenario ordering invariant and exact z-factors.
import { describe, expect, it } from "vitest";

import { runYieldV2, type YieldInput } from "@/lib/pv/yield-v2";

const Z = { p75: 0.675, p90: 1.282, p99: 2.326 };

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
  auxiliaryLoadKw: 60,
  bess: null,
  interannualVariabilitySigmaPct: null,
  computedAt: "2026-01-01T00:00:00.000Z",
};

/** σ inputs expressed as fractions in the spec; the engine takes percent. */
const SIGMAS = [0.03, 0.05, 0.1];

describe("P-158 P-scenarios", () => {
  for (const fraction of SIGMAS) {
    const sigmaPct = fraction * 100;

    it(`σ = ${fraction} keeps P50 ≥ P75 ≥ P90 ≥ P99`, () => {
      const p = runYieldV2({ ...base, interannualVariabilitySigmaPct: sigmaPct }).p_scenarios;
      expect(p.sigma_pct).toBe(sigmaPct);
      expect(p.note).toBeNull();
      expect(p.p50_kwh).toBeGreaterThanOrEqual(p.p75_kwh!);
      expect(p.p75_kwh!).toBeGreaterThanOrEqual(p.p90_kwh!);
      expect(p.p90_kwh!).toBeGreaterThanOrEqual(p.p99_kwh!);
    });

    it(`σ = ${fraction} uses the exact z-factors 0.675 / 1.282 / 2.326`, () => {
      const p = runYieldV2({ ...base, interannualVariabilitySigmaPct: sigmaPct }).p_scenarios;
      expect(p.p75_kwh!).toBeCloseTo(p.p50_kwh * (1 - Z.p75 * fraction), 3);
      expect(p.p90_kwh!).toBeCloseTo(p.p50_kwh * (1 - Z.p90 * fraction), 3);
      expect(p.p99_kwh!).toBeCloseTo(p.p50_kwh * (1 - Z.p99 * fraction), 3);
      expect(p.formula).toContain("0.675");
      expect(p.formula).toContain("1.282");
      expect(p.formula).toContain("2.326");
    });
  }

  it("σ = 0 collapses every scenario onto P50", () => {
    const p = runYieldV2({ ...base, interannualVariabilitySigmaPct: 0 }).p_scenarios;
    expect(p.p75_kwh).toBeCloseTo(p.p50_kwh, 6);
    expect(p.p99_kwh).toBeCloseTo(p.p50_kwh, 6);
  });

  it("missing σ yields nulls with an insufficient_data note", () => {
    const p = runYieldV2({ ...base, interannualVariabilitySigmaPct: null }).p_scenarios;
    expect(p.sigma_pct).toBeNull();
    expect([p.p75_kwh, p.p90_kwh, p.p99_kwh]).toEqual([null, null, null]);
    expect(p.note).toContain("insufficient_data");
    expect(p.p50_kwh).toBeGreaterThan(0);
  });
});
