// P-164 — GeoJSON validation, KML round-trip, optimization weights & scoring. Fully offline.
import { describe, expect, it } from "vitest";

import { KmlError, buildKml, parseKml, type KmlExportFeature } from "@/lib/civil/kml";
import type { GeoJsonGeometry } from "@/lib/civil/geom";
import {
  GeoJsonError,
  isValidGeoJSON,
  isValidGeometry,
  parseGeoJSON,
  toFeatureCollection,
} from "@/lib/geojson";
import {
  BALANCED_WEIGHTS,
  DEFAULT_UNIT_COSTS,
  METRIC_LABELS,
  OPTIMIZATION_METRICS,
  SCENARIO_TYPES,
  epcCostUsd,
  normalizeMetric,
  normalizeWeights,
  presetWeights,
  weightsAreValid,
  type MetricWeights,
} from "@/lib/pv/optimize";

const POINT = { type: "Point", coordinates: [35.9, 31.9] };
const LINE = {
  type: "LineString",
  coordinates: [
    [35.9, 31.9],
    [35.91, 31.91],
  ],
};
const POLYGON = {
  type: "Polygon",
  coordinates: [
    [
      [35.9, 31.9],
      [35.91, 31.9],
      [35.91, 31.91],
      [35.9, 31.9],
    ],
  ],
};

describe("isValidGeoJSON", () => {
  it("accepts Point / LineString / Polygon / Feature / FeatureCollection fixtures", () => {
    expect(isValidGeometry(POINT)).toBe(true);
    expect(isValidGeometry(LINE)).toBe(true);
    expect(isValidGeometry(POLYGON)).toBe(true);
    expect(isValidGeoJSON(POINT)).toBe(true);
    expect(isValidGeoJSON({ type: "Feature", geometry: LINE, properties: {} })).toBe(true);
    expect(
      isValidGeoJSON({
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: POINT, properties: { kind: "gate" } },
          { type: "Feature", geometry: POLYGON, properties: null },
        ],
      }),
    ).toBe(true);
  });

  it("rejects missing type, non-array coordinates, unclosed rings and NaN coordinates", () => {
    expect(isValidGeoJSON({ coordinates: [1, 2] })).toBe(false);
    expect(isValidGeoJSON({ type: "Circle", coordinates: [1, 2] })).toBe(false);
    expect(isValidGeoJSON({ type: "Point", coordinates: "35.9,31.9" })).toBe(false);
    expect(isValidGeoJSON({ type: "LineString", coordinates: [] })).toBe(false);
    expect(isValidGeoJSON({ type: "Point", coordinates: [Number.NaN, 31.9] })).toBe(false);
    expect(
      isValidGeoJSON({
        type: "LineString",
        coordinates: [
          [35.9, 31.9],
          [35.91, Number.NaN],
        ],
      }),
    ).toBe(false);
    // unclosed ring
    expect(
      isValidGeoJSON({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
        ],
      }),
    ).toBe(false);
    // closed but with only three positions
    expect(
      isValidGeoJSON({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [0, 0],
          ],
        ],
      }),
    ).toBe(false);
    expect(isValidGeoJSON({ type: "FeatureCollection", features: [{ type: "Feature" }] })).toBe(
      false,
    );
    expect(isValidGeoJSON(null)).toBe(false);
  });

  it("normalises accepted shapes and throws typed errors otherwise", () => {
    expect(toFeatureCollection(POINT).features).toHaveLength(1);
    expect(toFeatureCollection({ type: "Feature", geometry: LINE, properties: null }).features[0]
      .properties).toEqual({});
    expect(() => parseGeoJSON("{not json")).toThrowError(GeoJsonError);
    expect(() => parseGeoJSON(JSON.stringify({ type: "Point", coordinates: [] }))).toThrowError(
      GeoJsonError,
    );
    expect(parseGeoJSON(JSON.stringify(POLYGON)).features[0].geometry.type).toBe("Polygon");
  });
});

describe("KML round-trip", () => {
  const features: KmlExportFeature[] = [
    {
      feature_ref: "CF-0001",
      name: "Main gate",
      feature_type: "gate",
      status: "approved",
      revision_code: "A",
      geometry: POINT as unknown as GeoJsonGeometry,
    },
    {
      feature_ref: "CF-0002",
      name: "Access road",
      feature_type: "road_alignment",
      status: "draft",
      revision_code: "A",
      geometry: LINE as unknown as GeoJsonGeometry,
    },
    {
      feature_ref: "CF-0003",
      name: "Grading zone",
      feature_type: "grading_zone",
      status: "draft",
      revision_code: "A",
      geometry: POLYGON as unknown as GeoJsonGeometry,
    },
  ];

  it("writes placemarks that parse back into the same geometry", () => {
    const kml = buildKml(features, { documentName: "East Amman civil" });
    const placemarks = parseKml(kml);
    expect(placemarks).toHaveLength(3);
    expect(placemarks.map((p) => p.geometry.type)).toEqual(["Point", "LineString", "Polygon"]);

    const round = (v: number) => Number(v.toFixed(8));
    expect((placemarks[0].geometry.coordinates as number[]).map(round)).toEqual(
      (POINT.coordinates as number[]).map(round),
    );
    expect((placemarks[1].geometry.coordinates as number[][]).map((c) => c.map(round))).toEqual(
      (LINE.coordinates as number[][]).map((c) => c.map(round)),
    );
    expect(
      (placemarks[2].geometry.coordinates as number[][][]).map((r) => r.map((c) => c.map(round))),
    ).toEqual((POLYGON.coordinates as number[][][]).map((r) => r.map((c) => c.map(round))));
    expect(placemarks[0].name).toContain("CF-0001");
    // round-tripped geometry is still valid GeoJSON
    for (const p of placemarks) expect(isValidGeometry(p.geometry)).toBe(true);
  });

  it("escapes XML and rejects malformed KML with a typed error", () => {
    const kml = buildKml([{ ...features[0], name: 'Gate "A" & B <east>' }]);
    expect(kml).toContain("&amp;");
    expect(kml).not.toContain("<east>");
    expect(() => parseKml("<kml><Document></Document></kml>")).toThrowError(KmlError);
  });
});

describe("optimization weights", () => {
  it("accepts every scenario preset", () => {
    for (const scenario of SCENARIO_TYPES) {
      const weights = presetWeights(scenario);
      expect(weightsAreValid(weights)).toBe(true);
      const sum = OPTIMIZATION_METRICS.reduce((s, m) => s + weights[m], 0);
      expect(sum).toBeCloseTo(1, 6);
      for (const m of OPTIMIZATION_METRICS) expect(METRIC_LABELS[m]).toBeTruthy();
    }
  });

  it("rejects negative weights, unknown keys and sums outside tolerance", () => {
    const bad = { ...BALANCED_WEIGHTS, capacity: -0.2, grading: 0.5 } as MetricWeights;
    expect(weightsAreValid(bad)).toBe(false);
    expect(
      weightsAreValid({ ...BALANCED_WEIGHTS, moonshot: 0 } as unknown as MetricWeights),
    ).toBe(false);
    const drifted = { ...BALANCED_WEIGHTS, capacity: BALANCED_WEIGHTS.capacity + 0.5 };
    expect(weightsAreValid(drifted)).toBe(false);
    expect(weightsAreValid({ capacity: 1 } as unknown as MetricWeights)).toBe(false);
  });

  it("normalizes an unnormalized weight set back onto the simplex", () => {
    const doubled = Object.fromEntries(
      OPTIMIZATION_METRICS.map((m) => [m, BALANCED_WEIGHTS[m] * 2]),
    ) as MetricWeights;
    const normalized = normalizeWeights(doubled);
    expect(weightsAreValid(normalized)).toBe(true);
    for (const m of OPTIMIZATION_METRICS) {
      expect(normalized[m]).toBeCloseTo(BALANCED_WEIGHTS[m], 9);
    }
  });
});

describe("weighted scoring invariants", () => {
  const score = (weights: MetricWeights, values: Record<string, number[]>, i: number) =>
    OPTIMIZATION_METRICS.reduce((sum, m) => {
      const higherIsBetter = m === "capacity" || m === "energy_yield";
      return sum + weights[m] * normalizeMetric(values[m], values[m][i], higherIsBetter);
    }, 0);

  const values: Record<string, number[]> = Object.fromEntries(
    OPTIMIZATION_METRICS.map((m) => [m, [10, 20, 30]]),
  );

  it("is order-independent across the metric terms", () => {
    const forward = score(BALANCED_WEIGHTS, values, 1);
    const reversedMetrics = [...OPTIMIZATION_METRICS].reverse();
    const backward = reversedMetrics.reduce((sum, m) => {
      const higherIsBetter = m === "capacity" || m === "energy_yield";
      return sum + BALANCED_WEIGHTS[m] * normalizeMetric(values[m], values[m][1], higherIsBetter);
    }, 0);
    expect(backward).toBeCloseTo(forward, 12);
  });

  it("is monotone in each metric", () => {
    for (const higherIsBetter of [true, false]) {
      const series = [10, 20, 30];
      const scores = series.map((v) => normalizeMetric(series, v, higherIsBetter));
      for (let i = 1; i < scores.length; i++) {
        if (higherIsBetter) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
        else expect(scores[i]).toBeLessThan(scores[i - 1]);
      }
      expect(Math.min(...scores)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...scores)).toBeLessThanOrEqual(1);
    }
    // a degenerate spread scores neutrally rather than dividing by zero
    expect(normalizeMetric([5, 5, 5], 5, true)).toBeCloseTo(normalizeMetric([5, 5, 5], 5, false), 12);
  });

  it("keeps EPC cost monotone in each cost driver", () => {
    const base = epcCostUsd(1000, 5000, 2000, 800, DEFAULT_UNIT_COSTS);
    expect(epcCostUsd(1100, 5000, 2000, 800, DEFAULT_UNIT_COSTS)).toBeGreaterThan(base);
    expect(epcCostUsd(1000, 6000, 2000, 800, DEFAULT_UNIT_COSTS)).toBeGreaterThan(base);
    expect(epcCostUsd(1000, 5000, 2500, 800, DEFAULT_UNIT_COSTS)).toBeGreaterThan(base);
    expect(epcCostUsd(1000, 5000, 2000, 900, DEFAULT_UNIT_COSTS)).toBeGreaterThan(base);
  });
});
