import { describe, expect, it } from "vitest";
import {
  bucketPowerCurve,
  energyDelta,
  isStale,
  latestPerAsset,
  performanceRatio,
  plantAvailabilityBadge,
  utcMidnightIso,
  type TelemetryRow,
} from "@/lib/scada-dashboard.rules";

const A1 = "a1";
const A2 = "a2";
const rows = (rs: [string, string, string, number][]): TelemetryRow[] =>
  rs.map(([scada_asset_id, ts, metric, value]) => ({
    scada_asset_id,
    ts,
    metric,
    value,
  }));

describe("latestPerAsset", () => {
  it("picks the highest ts per asset for the given metric", () => {
    const r = rows([
      [A1, "2026-07-25T10:00:00Z", "ac_power_kw", 10],
      [A1, "2026-07-25T10:05:00Z", "ac_power_kw", 20],
      [A2, "2026-07-25T09:00:00Z", "ac_power_kw", 5],
      [A1, "2026-07-25T09:59:00Z", "energy_kwh", 999], // ignored
    ]);
    const latest = latestPerAsset(r, "ac_power_kw");
    expect(latest.get(A1)?.value).toBe(20);
    expect(latest.get(A2)?.value).toBe(5);
    expect(latest.size).toBe(2);
  });
});

describe("energyDelta", () => {
  it("sums max−min per asset since sinceIso, ignoring earlier rows", () => {
    const r = rows([
      [A1, "2026-07-24T23:00:00Z", "energy_kwh", 100], // before window
      [A1, "2026-07-25T00:15:00Z", "energy_kwh", 110],
      [A1, "2026-07-25T18:00:00Z", "energy_kwh", 145],
      [A2, "2026-07-25T02:00:00Z", "energy_kwh", 50],
      [A2, "2026-07-25T20:00:00Z", "energy_kwh", 62],
    ]);
    // 145-110 = 35, 62-50 = 12 → 47
    expect(energyDelta(r, "2026-07-25T00:00:00Z")).toBe(47);
  });
  it("returns 0 with no rows", () => {
    expect(energyDelta([], "2026-07-25T00:00:00Z")).toBe(0);
  });
});

describe("bucketPowerCurve", () => {
  it("sums latest power per asset per 5-min bucket and averages irradiance", () => {
    const r = rows([
      [A1, "2026-07-25T10:00:00Z", "ac_power_kw", 10],
      [A2, "2026-07-25T10:01:00Z", "ac_power_kw", 20],
      [A1, "2026-07-25T10:04:00Z", "ac_power_kw", 15], // replaces A1 in bucket
      [A1, "2026-07-25T10:06:00Z", "ac_power_kw", 25], // next bucket
      [A1, "2026-07-25T10:00:00Z", "irradiance_wm2", 800],
      [A1, "2026-07-25T10:03:00Z", "irradiance_wm2", 900],
    ]);
    const c = bucketPowerCurve(r, 5);
    expect(c.length).toBe(2);
    // Bucket 10:00 → A1(15) + A2(20) = 35 kW; irr mean = 850
    expect(c[0]?.ac_power_kw).toBe(35);
    expect(c[0]?.irradiance_wm2).toBe(850);
    // Bucket 10:05 → A1(25); no irradiance rows
    expect(c[1]?.ac_power_kw).toBe(25);
    expect(c[1]?.irradiance_wm2).toBe(null);
  });
});

describe("performanceRatio", () => {
  it("returns null with no nameplate", () => {
    expect(performanceRatio({ actualKwh: 100, irradianceSeries: [], nameplateKw: 0 })).toBe(null);
  });
  it("returns null with fewer than 2 irradiance samples", () => {
    expect(
      performanceRatio({
        actualKwh: 100,
        irradianceSeries: [{ ts: "2026-07-25T10:00:00Z", value: 800 }],
        nameplateKw: 1000,
      }),
    ).toBe(null);
  });
  it("computes irradiance-weighted expected energy", () => {
    // 1 hour at 1000 W/m² on a 1000 kW plant → expected 1000 kWh.
    // Actual 850 kWh → PR = 85%.
    const pr = performanceRatio({
      actualKwh: 850,
      irradianceSeries: [
        { ts: "2026-07-25T10:00:00Z", value: 1000 },
        { ts: "2026-07-25T11:00:00Z", value: 1000 },
      ],
      nameplateKw: 1000,
    });
    expect(pr).toBe(85);
  });
});

describe("plantAvailabilityBadge", () => {
  it("maps null to unknown", () => {
    expect(plantAvailabilityBadge(null)).toBe("unknown");
  });
  it("tiers correctly", () => {
    expect(plantAvailabilityBadge(99.5)).toBe("excellent");
    expect(plantAvailabilityBadge(99.0)).toBe("excellent");
    expect(plantAvailabilityBadge(98)).toBe("warning");
    expect(plantAvailabilityBadge(96.9)).toBe("critical");
  });
});

describe("isStale", () => {
  it("null → stale", () => {
    expect(isStale(null)).toBe(true);
  });
  it("recent → fresh", () => {
    expect(isStale(new Date().toISOString())).toBe(false);
  });
  it("older than window → stale", () => {
    const twentyMinAgo = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(isStale(twentyMinAgo, 15)).toBe(true);
  });
});

describe("utcMidnightIso", () => {
  it("returns start of the UTC day", () => {
    const iso = utcMidnightIso(new Date("2026-07-25T14:32:00Z"));
    expect(iso).toBe("2026-07-25T00:00:00.000Z");
  });
});
