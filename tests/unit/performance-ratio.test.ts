import { describe, expect, it } from "vitest";
import { computePerformanceRatio } from "@/lib/performance-tests.schema";

describe("computePerformanceRatio", () => {
  it("computes PR in the plausible 70–90% band for utility-scale inputs", () => {
    // 25,000 MWh over 30 days, 178.5 kWh/m² POA, 175 MWp DC → ~80%
    const pr = computePerformanceRatio(25_000, 178.5, 175);
    expect(pr).not.toBeNull();
    expect(pr!).toBeGreaterThanOrEqual(70);
    expect(pr!).toBeLessThanOrEqual(90);
    expect(pr!).toBeCloseTo(80.03, 1);
  });

  it("returns null on invalid or zero inputs", () => {
    expect(computePerformanceRatio(null, 1, 1)).toBeNull();
    expect(computePerformanceRatio(1, 0, 1)).toBeNull();
    expect(computePerformanceRatio(1, 1, 0)).toBeNull();
    expect(computePerformanceRatio(-1, 1, 1)).toBeNull();
    expect(computePerformanceRatio(NaN, 1, 1)).toBeNull();
  });

  it("returns 100% when metered equals theoretical output", () => {
    const capacity = 100; // MWp
    const poa = 200; // kWh/m²
    const theoretical = poa * capacity; // MWh
    const pr = computePerformanceRatio(theoretical, poa, capacity);
    expect(pr).toBeCloseTo(100, 6);
  });
});
