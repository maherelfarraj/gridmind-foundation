import { describe, expect, it } from "vitest";
import {
  MAX_READINGS_PER_REQUEST,
  chunk,
  filterReadingsByAsset,
  ingestBodySchema,
  type AssetLookup,
  type Reading,
} from "@/lib/telemetry-ingest";

const validReading = (over: Partial<Reading> = {}): Reading => ({
  asset_key: "INV-01-01",
  ts: "2026-07-25T10:00:00Z",
  metric: "ac_power_kw",
  value: 42.5,
  ...over,
});

describe("ingestBodySchema", () => {
  it("accepts a valid batch", () => {
    const r = ingestBodySchema.safeParse({ readings: [validReading()] });
    expect(r.success).toBe(true);
  });

  it("rejects empty readings", () => {
    expect(ingestBodySchema.safeParse({ readings: [] }).success).toBe(false);
  });

  it("rejects unknown metric", () => {
    expect(
      ingestBodySchema.safeParse({
        readings: [validReading({ metric: "not_a_metric" as never })],
      }).success,
    ).toBe(false);
  });

  it("rejects non-finite value (NaN, Infinity)", () => {
    expect(
      ingestBodySchema.safeParse({
        readings: [validReading({ value: Number.NaN })],
      }).success,
    ).toBe(false);
    expect(
      ingestBodySchema.safeParse({
        readings: [validReading({ value: Number.POSITIVE_INFINITY })],
      }).success,
    ).toBe(false);
  });

  it("rejects malformed ts", () => {
    expect(
      ingestBodySchema.safeParse({
        readings: [validReading({ ts: "yesterday" })],
      }).success,
    ).toBe(false);
  });

  it("rejects batches over the max size", () => {
    const readings = Array.from({ length: MAX_READINGS_PER_REQUEST + 1 }, () => validReading());
    expect(ingestBodySchema.safeParse({ readings }).success).toBe(false);
  });

  it("accepts optional quality", () => {
    expect(
      ingestBodySchema.safeParse({
        readings: [validReading({ quality: "suspect" })],
      }).success,
    ).toBe(true);
  });
});

describe("filterReadingsByAsset", () => {
  const assetMap = new Map<string, AssetLookup>([
    ["INV-01-01", { scada_asset_id: "aaaa", project_id: "p1" }],
    ["INV-01-02", { scada_asset_id: "bbbb", project_id: "p1" }],
  ]);

  it("routes known keys to accepted with project_id + scada_asset_id", () => {
    const { accepted, rejected } = filterReadingsByAsset(
      [validReading(), validReading({ asset_key: "INV-01-02" })],
      assetMap,
    );
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(2);
    expect(accepted[0]).toMatchObject({ scada_asset_id: "aaaa", project_id: "p1" });
    expect(accepted[1]).toMatchObject({ scada_asset_id: "bbbb", project_id: "p1" });
  });

  it("rejects unknown / cross-company asset keys with a stable reason", () => {
    const { accepted, rejected } = filterReadingsByAsset(
      [validReading({ asset_key: "OTHER-COMPANY-INV" }), validReading()],
      assetMap,
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      index: 0,
      asset_key: "OTHER-COMPANY-INV",
      reason: "unknown_asset_or_cross_company",
    });
  });

  it("preserves the input index in rejected rows", () => {
    const { rejected } = filterReadingsByAsset(
      [
        validReading(),
        validReading({ asset_key: "UNKNOWN-A" }),
        validReading(),
        validReading({ asset_key: "UNKNOWN-B" }),
      ],
      assetMap,
    );
    expect(rejected.map((r) => r.index)).toEqual([1, 3]);
  });
});

describe("chunk", () => {
  it("splits into batches of the requested size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns a single batch when array is smaller than size", () => {
    expect(chunk([1, 2], 500)).toEqual([[1, 2]]);
  });
});
