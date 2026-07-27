// P-218 — ESG dashboard math (offline, pure).
import { describe, expect, it } from "vitest";

import type { CarbonActivity, CarbonFactor } from "@/lib/esg/carbon";
import {
  buildDashboard,
  carbonIntensity,
  categoryTotals,
  diversionRate,
  fmtIntensity,
  fmtKg,
  fmtMwh,
  fmtPct,
  fmtTonnes,
  fmtTrir,
  grossKg,
  kwhToMwh,
  monthKeysBetween,
  monthlySeries,
  NA_REASON_LABEL,
  renewableShare,
  scopeShare,
} from "@/lib/esg/dashboard.rules";
import { monthlyAvoidedKg, toKg } from "@/lib/esg/dashboard.server";

const factors: CarbonFactor[] = [
  {
    id: "d",
    company_id: null,
    category: "fuel_diesel",
    unit: "L",
    kg_co2e_per_unit: 2.68,
    factor_code: "DEFRA-DIESEL",
    factor_source: "DEFRA 2024",
    valid_from: "2020-01-01",
    valid_to: null,
  },
  {
    id: "g",
    company_id: null,
    category: "electricity_grid",
    unit: "kWh",
    kg_co2e_per_unit: 0.55,
    factor_code: "JO-GRID",
    factor_source: "IEA",
    valid_from: "2020-01-01",
    valid_to: null,
  },
  {
    id: "w",
    company_id: null,
    category: "waste_general",
    unit: "kg",
    kg_co2e_per_unit: 0.45,
    factor_code: "DEFRA-WASTE",
    factor_source: "DEFRA 2024",
    valid_from: "2020-01-01",
    valid_to: null,
  },
];

const activities: CarbonActivity[] = [
  { id: "1", category: "fuel_diesel", quantity: 1000, unit: "L", period_month: "2026-01-01" },
  {
    id: "2",
    category: "electricity_grid",
    quantity: 2000,
    unit: "kWh",
    period_month: "2026-02-01",
  },
  { id: "3", category: "waste_general", quantity: 500, unit: "kg", period_month: "2026-02-01" },
  { id: "4", category: "materials_steel", quantity: 3, unit: "t", period_month: "2026-02-01" },
];

describe("period helpers", () => {
  it("enumerates months inclusively across years", () => {
    expect(monthKeysBetween("2025-11-01", "2026-02-28")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });
});

describe("buildDashboard", () => {
  const months = monthKeysBetween("2026-01-01", "2026-03-31");

  it("reconciles tiles to activity × factor", () => {
    const d = buildDashboard({
      activities,
      factors,
      months,
      monthlyAvoidedKg: null,
      meteredKwh: null,
    });
    expect(d.totals.scope_1_kg).toBeCloseTo(2680, 6);
    expect(d.totals.scope_2_kg).toBeCloseTo(1100, 6);
    expect(d.totals.scope_3_kg).toBeCloseTo(225, 6);
    expect(d.gross_kg).toBeCloseTo(4005, 6);
    expect(d.unfactored_count).toBe(1);
    expect(d.activity_count).toBe(4);
  });

  it("nets avoided and flags net-negative", () => {
    const d = buildDashboard({
      activities,
      factors,
      months,
      monthlyAvoidedKg: { "2026-01": 3000, "2026-02": 3000 },
      meteredKwh: 20000,
    });
    expect(d.avoided_kg).toBeCloseTo(6000, 6);
    expect(d.net_kg).toBeCloseTo(-1995, 6);
    expect(d.net_negative).toBe(true);
  });

  it("charts match the tile totals", () => {
    const d = buildDashboard({
      activities,
      factors,
      months,
      monthlyAvoidedKg: null,
      meteredKwh: null,
    });
    const donutSum = d.scope_share.reduce((s, p) => s + p.kg, 0);
    const barSum = d.by_category.reduce((s, p) => s + p.kg, 0);
    const trendSum = d.monthly.reduce((s, m) => s + m.scope_1_kg + m.scope_2_kg + m.scope_3_kg, 0);
    expect(donutSum).toBeCloseTo(d.gross_kg, 6);
    expect(barSum).toBeCloseTo(d.gross_kg, 6);
    expect(trendSum).toBeCloseTo(d.gross_kg, 6);
    expect(d.scope_share.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 6);
  });

  it("keeps every period month on the trend, avoided null without meters", () => {
    const d = buildDashboard({
      activities,
      factors,
      months,
      monthlyAvoidedKg: null,
      meteredKwh: null,
    });
    expect(d.monthly.map((m) => m.month)).toEqual(months);
    expect(d.monthly.every((m) => m.avoided_kg === null)).toBe(true);
    expect(d.intensity).toBeNull();
  });
});

describe("intensity, share and diversion", () => {
  const totals = { scope_1_kg: 1000, scope_2_kg: 500, scope_3_kg: 500 };

  it("divides gross kg by MWh", () => {
    expect(grossKg(totals)).toBe(2000);
    expect(carbonIntensity(totals, 100_000)).toBeCloseTo(20, 6);
    expect(carbonIntensity(totals, null)).toBeNull();
    expect(carbonIntensity(totals, 0)).toBeNull();
    expect(kwhToMwh(2500)).toBe(2.5);
  });

  it("computes waste diversion and flags empty periods", () => {
    expect(diversionRate(250, 1000).pct).toBeCloseTo(25, 6);
    expect(diversionRate(0, 0)).toEqual({ pct: null, reason: "no_waste_data" });
    expect(toKg(2, "t")).toBe(2000);
    expect(toKg(2, "kg")).toBe(2);
  });

  it("explains why portfolio share is unavailable", () => {
    expect(renewableShare(50, 200, 4).pct).toBeCloseTo(25, 6);
    expect(renewableShare(50, 200, 1).reason).toBe("single_project");
    expect(renewableShare(null, null, 4).reason).toBe("no_metered_data");
  });

  it("splits scope share safely at zero gross", () => {
    const share = scopeShare({ scope_1_kg: 0, scope_2_kg: 0, scope_3_kg: 0 });
    expect(share.every((s) => s.share === 0)).toBe(true);
  });
});

describe("avoided per month", () => {
  it("applies the grid factor valid that month", () => {
    expect(monthlyAvoidedKg({ "2026-01": 1000 }, factors)).toEqual({ "2026-01": 550 });
  });
  it("stays null when telemetry is missing", () => {
    expect(monthlyAvoidedKg(null, factors)).toBeNull();
  });
});

describe("formatting", () => {
  it("uses 0 decimals for kg and 1 for tonnes", () => {
    expect(fmtKg(1234.56)).toBe("1,235 kg CO2e");
    expect(fmtTonnes(1234.56)).toBe("1.2 t CO2e");
    expect(fmtMwh(12.34)).toBe("12.3 MWh");
    expect(fmtPct(25.456)).toBe("25.5%");
    expect(fmtIntensity(20.4)).toBe("20 kg CO2e/MWh");
    expect(fmtTrir(1.234)).toBe("1.23");
  });

  it("renders labelled n/a reasons", () => {
    expect(fmtKg(null)).toBe(NA_REASON_LABEL.no_metered_data);
    expect(fmtPct(null, "single_project")).toBe(NA_REASON_LABEL.single_project);
    expect(fmtTrir(null)).toBe(NA_REASON_LABEL.no_hours);
    expect(NA_REASON_LABEL.not_tracked).toBe("not tracked");
  });
});

describe("categoryTotals", () => {
  it("groups and sorts descending", () => {
    const rows = [
      { category: "a", co2e_kg: 5 },
      { category: "b", co2e_kg: 10 },
      { category: "a", co2e_kg: 20 },
    ] as never;
    expect(categoryTotals(rows)).toEqual([
      { category: "a", kg: 25 },
      { category: "b", kg: 10 },
    ]);
  });

  it("ignores rows outside the month window", () => {
    const rows = [
      { category: "x", co2e_kg: 5, scope: "scope_1", period_month: "2025-01-01" },
    ] as never;
    const series = monthlySeries(rows, ["2026-01"], null);
    expect(series[0].scope_1_kg).toBe(0);
  });
});
