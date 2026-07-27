// P-220 — Avoided emissions and net (never clamped at zero).
import { describe, expect, it } from "vitest";
import {
  buildReportTotals,
  computeAvoided,
  netEmissions,
  type EmissionTotals,
} from "@/lib/esg/carbon";

const totals = (s1: number, s2 = 0, s3 = 0): EmissionTotals => ({
  scope_1_kg: s1,
  scope_2_kg: s2,
  scope_3_kg: s3,
});

describe("computeAvoided", () => {
  it("500 MWh × 0.55 kg/kWh = 275,000 kg = 275 t", () => {
    const { avoided_kg } = computeAvoided(500 * 1000, 0.55);
    expect(avoided_kg).toBe(275_000);
    expect(avoided_kg / 1000).toBe(275);
  });
});

describe("netEmissions", () => {
  it("net = gross − avoided", () => {
    expect(netEmissions(totals(1000, 500, 500), 1000)).toEqual({
      net_kg: 1000,
      net_negative: false,
    });
  });

  it("goes negative when avoided exceeds gross — never clamped", () => {
    const net = netEmissions(totals(1000, 500, 500), 275_000);
    expect(net.net_kg).toBe(-273_000);
    expect(net.net_negative).toBe(true);
  });

  it("net equals gross when avoided is null (no metered data)", () => {
    const net = netEmissions(totals(1000, 500, 500), null);
    expect(net.net_kg).toBe(2000);
    expect(net.net_negative).toBe(false);
  });
});

describe("buildReportTotals", () => {
  it("flags no_metered_data and keeps avoided null", () => {
    const t = buildReportTotals({ totals: totals(1000), avoidedKg: null, unfactoredCount: 2 });
    expect(t.avoided_kg).toBeNull();
    expect(t.note).toBe("no_metered_data");
    expect(t.net_kg).toBe(1000);
    expect(t.unfactored_count).toBe(2);
  });

  it("omits the note and reports a negative net when avoided dominates", () => {
    const t = buildReportTotals({ totals: totals(1000), avoidedKg: 275_000, unfactoredCount: 0 });
    expect(t.note).toBeUndefined();
    expect(t.net_kg).toBe(-274_000);
    expect(t.net_negative).toBe(true);
  });
});
