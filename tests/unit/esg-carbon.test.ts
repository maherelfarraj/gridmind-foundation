// P-217 — Pure carbon engine tests (offline, no Supabase).
import { describe, expect, it } from "vitest";

import {
  buildReportTotals,
  CATEGORY_SCOPE,
  computeAvoided,
  computeEmissions,
  DEFAULT_GRID_FACTOR_KG_PER_KWH,
  ESG_METHODOLOGY_NOTE,
  formatKgCo2e,
  netEmissions,
  resolveFactor,
  scopeOf,
  type CarbonFactor,
} from "@/lib/esg/carbon";

function factor(over: Partial<CarbonFactor> & { id: string }): CarbonFactor {
  return {
    company_id: null,
    category: "fuel_diesel",
    unit: "L",
    kg_co2e_per_unit: 2.68,
    factor_code: "DEFRA-DIESEL",
    factor_source: "DEFRA 2024",
    valid_from: "2020-01-01",
    valid_to: null,
    ...over,
  };
}

describe("category scope map", () => {
  it("mirrors the DB CHECK mapping", () => {
    expect(CATEGORY_SCOPE.fuel_diesel).toBe("scope_1");
    expect(CATEGORY_SCOPE.fuel_petrol).toBe("scope_1");
    expect(CATEGORY_SCOPE.fuel_lpg).toBe("scope_1");
    expect(CATEGORY_SCOPE.electricity_grid).toBe("scope_2");
    for (const c of [
      "electricity_generator",
      "transport_road",
      "materials_steel",
      "waste_hazardous",
      "other",
    ]) {
      expect(CATEGORY_SCOPE[c]).toBe("scope_3");
    }
    expect(scopeOf("unknown_future_category")).toBe("scope_3");
  });
});

describe("resolveFactor", () => {
  const factors = [
    factor({ id: "global-old", kg_co2e_per_unit: 2.5, valid_from: "2020-01-01", valid_to: "2024-01-01" }),
    factor({ id: "global-new", kg_co2e_per_unit: 2.68, valid_from: "2024-01-01" }),
    factor({
      id: "company",
      company_id: "c1",
      kg_co2e_per_unit: 2.9,
      factor_code: "GSI-DIESEL",
      valid_from: "2024-01-01",
      valid_to: "2026-01-01",
    }),
  ];

  it("respects validity windows", () => {
    expect(resolveFactor("fuel_diesel", "2022-06-01", factors)?.id).toBe("global-old");
  });

  it("prefers the company override inside its window", () => {
    expect(resolveFactor("fuel_diesel", "2025-06-01", factors)?.id).toBe("company");
  });

  it("falls back to a still-valid global when the company factor expired", () => {
    expect(resolveFactor("fuel_diesel", "2026-07-01", factors)?.id).toBe("global-new");
  });

  it("prefers the latest valid_from among same-scope candidates", () => {
    const overlapping = [
      factor({ id: "a", valid_from: "2024-01-01" }),
      factor({ id: "b", valid_from: "2025-06-01" }),
    ];
    expect(resolveFactor("fuel_diesel", "2026-01-01", overlapping)?.id).toBe("b");
  });

  it("returns null when nothing matches", () => {
    expect(resolveFactor("waste_general", "2026-01-01", factors)).toBeNull();
    expect(resolveFactor("fuel_diesel", "2019-01-01", factors)).toBeNull();
  });
});

describe("computeEmissions", () => {
  const factors = [
    factor({ id: "d" }),
    factor({
      id: "e",
      category: "electricity_grid",
      unit: "kWh",
      kg_co2e_per_unit: 0.55,
      factor_code: "JO-GRID",
      factor_source: "IEA 2024",
    }),
    factor({
      id: "w",
      category: "waste_general",
      unit: "kg",
      kg_co2e_per_unit: 0.45,
      factor_code: "DEFRA-WASTE",
    }),
  ];
  const rows = [
    { id: "1", category: "fuel_diesel", quantity: 1000, unit: "L", period_month: "2026-07-01" },
    { id: "2", category: "electricity_grid", quantity: 2000, unit: "kWh", period_month: "2026-07-01" },
    { id: "3", category: "waste_general", quantity: 500, unit: "kg", period_month: "2026-07-01" },
    { id: "4", category: "materials_steel", quantity: 10, unit: "t", period_month: "2026-07-01" },
  ];

  it("multiplies quantity by factor and groups by scope", () => {
    const out = computeEmissions(rows, factors);
    expect(out.totals.scope_1_kg).toBeCloseTo(2680, 6);
    expect(out.totals.scope_2_kg).toBeCloseTo(1100, 6);
    expect(out.totals.scope_3_kg).toBeCloseTo(225, 6);
  });

  it("carries a factor citation on every row", () => {
    const out = computeEmissions(rows, factors);
    expect(out.rows).toHaveLength(3);
    for (const r of out.rows) {
      expect(r.factor_code).toBeTruthy();
      expect(r.factor_source).toBeTruthy();
    }
  });

  it("reports unfactored rows instead of zeroing them", () => {
    const out = computeEmissions(rows, factors);
    expect(out.unfactored.map((r) => r.id)).toEqual(["4"]);
    expect(out.unfactored[0].reason).toBe("no_factor");
    expect(out.rows.some((r) => r.id === "4")).toBe(false);
  });
});

describe("avoided and net", () => {
  it("uses the Jordan default grid factor when none supplied", () => {
    expect(DEFAULT_GRID_FACTOR_KG_PER_KWH).toBe(0.55);
    expect(computeAvoided(1000).avoided_kg).toBeCloseTo(550, 6);
    expect(computeAvoided(1000, 0.4).avoided_kg).toBeCloseTo(400, 6);
  });

  it("nets scopes minus avoided", () => {
    const totals = { scope_1_kg: 100, scope_2_kg: 50, scope_3_kg: 25 };
    expect(netEmissions(totals, 100).net_kg).toBeCloseTo(75, 6);
    expect(netEmissions(totals, 100).net_negative).toBe(false);
  });

  it("flags net-negative without clamping", () => {
    const net = netEmissions({ scope_1_kg: 10, scope_2_kg: 0, scope_3_kg: 0 }, 500);
    expect(net.net_kg).toBeCloseTo(-490, 6);
    expect(net.net_negative).toBe(true);
  });

  it("treats null avoided as zero for net and flags no_metered_data", () => {
    const totals = buildReportTotals({
      totals: { scope_1_kg: 10, scope_2_kg: 5, scope_3_kg: 5 },
      avoidedKg: null,
      unfactoredCount: 2,
    });
    expect(totals.avoided_kg).toBeNull();
    expect(totals.note).toBe("no_metered_data");
    expect(totals.net_kg).toBeCloseTo(20, 6);
    expect(totals.unfactored_count).toBe(2);
  });

  it("omits the note when metered data exists", () => {
    const totals = buildReportTotals({
      totals: { scope_1_kg: 10, scope_2_kg: 0, scope_3_kg: 0 },
      avoidedKg: 4,
      unfactoredCount: 0,
    });
    expect(totals.note).toBeUndefined();
    expect(totals.net_kg).toBeCloseTo(6, 6);
  });
});

describe("presentation helpers", () => {
  it("formats kg and tonnes", () => {
    expect(formatKgCo2e(250)).toBe("250 kgCO2e");
    expect(formatKgCo2e(2680)).toBe("2.68 tCO2e");
  });

  it("exports the honesty note", () => {
    expect(ESG_METHODOLOGY_NOTE).toContain("not a verified third-party GHG audit");
  });
});
