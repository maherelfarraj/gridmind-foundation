// P-178 — Tag scaling math + quality-flag handling.
//
// raw × scaling_factor + scaling_offset is applied server-side; the explorer
// excludes `bad` samples and marks buckets that contain `suspect` samples.
import { describe, expect, it } from "vitest";

import { applyMappingScaling } from "@/lib/scada/ingestion";
import { bucketizeTag, scaleValue, type RawSample } from "@/lib/scada/trends";

const identity = { scaling_factor: 1, scaling_offset: 0 };

describe("P-178 tag scaling math", () => {
  it("applies factor 0.1 with offset −40 (temperature register)", () => {
    expect(scaleValue(750, { scaling_factor: 0.1, scaling_offset: -40 })).toBeCloseTo(35, 10);
    expect(applyMappingScaling(750, { scaling_factor: 0.1, scaling_offset: -40 })).toBeCloseTo(
      35,
      10,
    );
    expect(scaleValue(0, { scaling_factor: 0.1, scaling_offset: -40 })).toBeCloseTo(-40, 10);
  });

  it("handles unit conversions in both directions (×1000 and ÷1000)", () => {
    // MW register → kW
    expect(scaleValue(2.5, { scaling_factor: 1000, scaling_offset: 0 })).toBe(2500);
    // Wh/m² → kWh/m²
    expect(scaleValue(5400, { scaling_factor: 0.001, scaling_offset: 0 })).toBeCloseTo(5.4, 10);
  });

  it("supports negative offsets and negative raw values", () => {
    expect(scaleValue(-120, { scaling_factor: 0.5, scaling_offset: -10 })).toBe(-70);
    expect(applyMappingScaling(-1, { scaling_factor: 1, scaling_offset: -273.15 })).toBeCloseTo(
      -274.15,
      10,
    );
  });

  it("retains precision with small numeric factors (0.0001)", () => {
    expect(scaleValue(12345, { scaling_factor: 0.0001, scaling_offset: 0 })).toBeCloseTo(
      1.2345,
      10,
    );
    expect(applyMappingScaling(1, { scaling_factor: 0.0001, scaling_offset: 0 })).toBeCloseTo(
      0.0001,
      12,
    );
  });

  it("defaults to identity, matching tag_dictionary defaults", () => {
    expect(scaleValue(42, identity)).toBe(42);
    expect(scaleValue(42, { scaling_factor: null, scaling_offset: null })).toBe(42);
    expect(applyMappingScaling(42, identity)).toBe(42);
  });
});

describe("P-178 quality flags in the trend explorer", () => {
  const samples: RawSample[] = [
    { ts: "2026-03-01T00:00:00.000Z", value: 100, quality: "good" },
    { ts: "2026-03-01T00:01:00.000Z", value: 9999, quality: "bad" },
    { ts: "2026-03-01T00:02:00.000Z", value: 200, quality: "good" },
    { ts: "2026-03-01T01:00:00.000Z", value: 300, quality: "suspect" },
  ];

  it("excludes bad rows from the series and counts them", () => {
    const out = bucketizeTag(samples, identity, "1h");
    expect(out.badCount).toBe(1);
    // First bucket averages 100 and 200 only — the bad 9999 never contributes.
    expect(out.points[0].value).toBe(150);
  });

  it("flags buckets containing suspect samples without dropping them", () => {
    const out = bucketizeTag(samples, identity, "1h");
    expect(out.points).toHaveLength(2);
    expect(out.points[0].suspect).toBe(false);
    expect(out.points[1]).toMatchObject({ value: 300, suspect: true });
  });

  it("scales surviving samples before bucketing", () => {
    const out = bucketizeTag(samples, { scaling_factor: 0.1, scaling_offset: -40 }, "1h");
    // (100×0.1−40 = −30) and (200×0.1−40 = −20) → mean −25
    expect(out.points[0].value).toBe(-25);
  });
});
