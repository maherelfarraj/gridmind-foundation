// P-163 — Unit tests for the layout optimization scenario engine.
import { describe, expect, it } from "vitest";

import type { AlternativeParams, AlternativeSiteConfig } from "@/lib/pv/layout";
import {
  BALANCED_WEIGHTS,
  DEFAULT_UNIT_COSTS,
  DEFAULT_YIELD_REFERENCE,
  OPTIMIZATION_METRICS,
  SCENARIO_PRESETS,
  SCENARIO_TYPES,
  energyYieldMwh,
  epcCostUsd,
  normalizeMetric,
  normalizeWeights,
  presetWeights,
  runLayoutOptimizationEngine,
  weightsAreValid,
} from "@/lib/pv/optimize";

const site: AlternativeSiteConfig = {
  boundary: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
    { x: 0, y: 0 },
  ],
  exclusionZones: [],
  latitude: 31.9,
  terrainRef: null,
  equipmentPads: [
    { label: "Inverter station", widthM: 12, depthM: 6, count: 2, type: "inverter_station" },
  ],
};

const base: AlternativeParams = {
  module: { lengthMm: 2278, widthMm: 1134 },
  moduleWp: 580,
  orientation: "portrait",
  modulesAcross: 28,
  modulesUp: 2,
  tiltDeg: 25,
  azimuthDeg: 180,
  gcr: 0.35,
  setbackM: 10,
  roadEveryNRows: 6,
  roadWidthM: 6,
  tracker: false,
};

describe("scenario presets", () => {
  it("exposes exactly seven scenario types", () => {
    expect(SCENARIO_TYPES).toHaveLength(7);
  });

  it("every preset weights the six metrics and sums to 1", () => {
    for (const scenario of SCENARIO_TYPES) {
      const weights = presetWeights(scenario);
      expect(Object.keys(weights).sort()).toEqual([...OPTIMIZATION_METRICS].sort());
      expect(weightsAreValid(weights)).toBe(true);
    }
  });

  it("balanced is the six-way default", () => {
    expect(SCENARIO_PRESETS.balanced).toEqual(BALANCED_WEIGHTS);
  });
});

describe("weight validation", () => {
  it("rejects bad sums, negatives and unknown keys", () => {
    expect(weightsAreValid({ ...BALANCED_WEIGHTS, capacity: 0.9 })).toBe(false);
    expect(weightsAreValid({ ...BALANCED_WEIGHTS, grading: -0.15, capacity: 0.35 })).toBe(false);
    expect(weightsAreValid({ nonsense: 1 } as never)).toBe(false);
  });

  it("normalizes arbitrary weights back to a sum of 1", () => {
    const out = normalizeWeights({ ...BALANCED_WEIGHTS, capacity: 2 });
    const sum = OPTIMIZATION_METRICS.reduce((s, m) => s + out[m], 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe("metric maths", () => {
  it("normalizes lower-is-better metrics inversely", () => {
    expect(normalizeMetric([10, 20], 10, false)).toBe(1);
    expect(normalizeMetric([10, 20], 20, false)).toBe(0);
    expect(normalizeMetric([10, 20], 20, true)).toBe(1);
  });

  it("collapses to 1 when every candidate ties", () => {
    expect(normalizeMetric([5, 5, 5], 5, true)).toBe(1);
  });

  it("adds grading, cable and road costs on top of equipment", () => {
    const cost = epcCostUsd(1000, 100, 200, 300, DEFAULT_UNIT_COSTS);
    expect(cost).toBeGreaterThan(1000 * 1000 * 0.33);
  });

  it("derates yield above the reference GCR", () => {
    const low = energyYieldMwh(1000, 0.35, DEFAULT_YIELD_REFERENCE);
    const high = energyYieldMwh(1000, 0.5, DEFAULT_YIELD_REFERENCE);
    expect(high).toBeLessThan(low);
  });
});

describe("optimization runs", () => {
  it("produces candidates with all six metrics and a weighted score", () => {
    const results = runLayoutOptimizationEngine({ site, base, weights: BALANCED_WEIGHTS });
    expect(results.candidates.length).toBeGreaterThan(1);
    for (const candidate of results.candidates) {
      for (const metric of OPTIMIZATION_METRICS) {
        expect(Number.isFinite(candidate.metrics[metric])).toBe(true);
        expect(candidate.normalized[metric]).toBeGreaterThanOrEqual(0);
        expect(candidate.normalized[metric]).toBeLessThanOrEqual(1);
      }
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
    expect(results.winner_index).not.toBeNull();
  });

  it("is deterministic", () => {
    const a = runLayoutOptimizationEngine({ site, base, weights: BALANCED_WEIGHTS });
    const b = runLayoutOptimizationEngine({ site, base, weights: BALANCED_WEIGHTS });
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("max_capacity picks the highest DC capacity candidate", () => {
    const results = runLayoutOptimizationEngine({
      site,
      base,
      weights: presetWeights("max_capacity"),
    });
    const winner = results.candidates.find((c) => c.index === results.winner_index)!;
    const best = Math.max(...results.candidates.map((c) => c.metrics.capacity));
    expect(winner.metrics.capacity).toBe(best);
  });

  it("min_road_length picks the shortest road candidate", () => {
    const results = runLayoutOptimizationEngine({
      site,
      base,
      weights: presetWeights("min_road_length"),
    });
    const winner = results.candidates.find((c) => c.index === results.winner_index)!;
    const shortest = Math.min(...results.candidates.map((c) => c.metrics.road_length));
    expect(winner.metrics.road_length).toBe(shortest);
  });

  it("excludes candidates that break a hard constraint", () => {
    const results = runLayoutOptimizationEngine({
      site,
      base,
      weights: BALANCED_WEIGHTS,
      constraints: { minCapacityKwp: Number.MAX_SAFE_INTEGER },
    });
    expect(results.excluded_count).toBe(results.candidates.length);
    expect(results.winner_index).toBeNull();
  });
});
