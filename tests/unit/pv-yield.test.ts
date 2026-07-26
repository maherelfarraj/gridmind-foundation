// P-158 — gridmind-yield-v2 loss-chain determinism, reconciliation and clipping.
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { DAYS_IN_MONTH, runYieldV2, type YieldInput } from "@/lib/pv/yield-v2";

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
  interannualVariabilitySigmaPct: 4,
  computedAt: "2026-02-01T00:00:00.000Z",
};

describe("P-158 yield engine — determinism", () => {
  it("two runs on the same snapshot are byte-identical", () => {
    const a = runYieldV2(base);
    const b = runYieldV2(base);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.computed_at).toBe(base.computedAt);
  });

  it("the engine source reads no wall-clock and no randomness", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/pv/yield-v2.ts"), "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(|Math\.random|crypto\.randomUUID/);
  });

  it("src/lib/pv/* stays pure — no React or Supabase imports", () => {
    const dir = join(process.cwd(), "src/lib/pv");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      expect(src, file).not.toMatch(/from\s+["'](react|@supabase\/[^"']+)["']/);
      expect(src, file).not.toMatch(/@\/integrations\/supabase/);
    }
  });
});

describe("P-158 yield engine — loss chain", () => {
  const result = runYieldV2(base);

  it("has 16 steps, each fully documented", () => {
    expect(result.loss_chain).toHaveLength(16);
    result.loss_chain.forEach((step, i) => {
      expect(step.index).toBe(i + 1);
      expect(step.step.length).toBeGreaterThan(0);
      expect(step.formula.length).toBeGreaterThan(0);
      expect(Object.keys(step.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.input_sources).length).toBeGreaterThan(0);
      expect(step.monthly_kwh).toHaveLength(12);
      expect(Number.isFinite(step.energy_kwh)).toBe(true);
    });
  });

  it("gross × Π(1 − loss_pct) reconciles to annual net within 0.1 %", () => {
    const gross = result.loss_chain[0].energy_kwh;
    const product = result.loss_chain
      .slice(1)
      .reduce((acc, step) => acc * (1 - step.loss_pct / 100), gross);
    const net = result.annual.energy_kwh;
    expect(Math.abs(product - net) / net).toBeLessThan(0.001);
    expect(result.loss_chain.at(-1)!.energy_kwh).toBeCloseTo(net, 3);
  });

  it("monthly energies sum to the annual total", () => {
    const sum = result.monthly.reduce((a, m) => a + m.energy_kwh, 0);
    expect(sum).toBeCloseTo(result.annual.energy_kwh, 3);
  });

  it("clipping keeps monthly net below the inverter AC limit × hours", () => {
    const clipped = runYieldV2({ ...base, inverterAcKw: 20000 });
    clipped.monthly.forEach((m, i) => {
      expect(m.energy_kwh).toBeLessThanOrEqual(20000 * DAYS_IN_MONTH[i] * 24);
    });
    // A tighter inverter must produce strictly less energy than a larger one.
    expect(clipped.annual.energy_kwh).toBeLessThan(result.annual.energy_kwh);
  });

  it("a grid export limit only ever removes energy", () => {
    const limited = runYieldV2({ ...base, gridLimitKw: 15000 });
    expect(limited.annual.energy_kwh).toBeLessThan(result.annual.energy_kwh);
  });

  it("missing σ disables the P-scenarios with insufficient_data", () => {
    const p = runYieldV2({ ...base, interannualVariabilitySigmaPct: null }).p_scenarios;
    expect([p.p75_kwh, p.p90_kwh, p.p99_kwh]).toEqual([null, null, null]);
    expect(p.note).toContain("insufficient_data");
  });
});
