// P-220 — Factor resolution: company override, expiry fallback, null path.
import { describe, expect, it } from "vitest";
import { computeEmissions, resolveFactor, type CarbonFactor } from "@/lib/esg/carbon";

function factor(over: Partial<CarbonFactor> & { factor_code: string }): CarbonFactor {
  return {
    id: over.factor_code,
    company_id: null,
    category: "fuel_diesel",
    unit: "L",
    kg_co2e_per_unit: 2.68,
    factor_source: "DEFRA 2024",
    valid_from: "2020-01-01",
    valid_to: null,
    ...over,
  };
}

const GLOBAL = factor({ factor_code: "FUEL_DIESEL-GLOBAL" });

describe("resolveFactor", () => {
  it("prefers the company override over the global factor", () => {
    const company = factor({
      factor_code: "FUEL_DIESEL-GSI",
      company_id: "company-a",
      kg_co2e_per_unit: 3.0,
    });
    const hit = resolveFactor("fuel_diesel", "2026-03-01", [GLOBAL, company]);
    expect(hit?.factor_code).toBe("FUEL_DIESEL-GSI");
    expect(hit?.kg_co2e_per_unit).toBe(3.0);
  });

  it("falls back to the still-valid global when the company factor expired", () => {
    const expired = factor({
      factor_code: "FUEL_DIESEL-OLD",
      company_id: "company-a",
      kg_co2e_per_unit: 3.0,
      valid_from: "2020-01-01",
      valid_to: "2025-01-01",
    });
    const hit = resolveFactor("fuel_diesel", "2026-03-01", [GLOBAL, expired]);
    expect(hit?.factor_code).toBe("FUEL_DIESEL-GLOBAL");
    expect(hit?.kg_co2e_per_unit).toBe(2.68);
  });

  it("returns null out of window and lands the row in unfactored, never zero", () => {
    const future = factor({ factor_code: "FUEL_DIESEL-FUTURE", valid_from: "2030-01-01" });
    expect(resolveFactor("fuel_diesel", "2026-03-01", [future])).toBeNull();

    const { rows, totals, unfactored } = computeEmissions(
      [
        {
          id: "a1",
          category: "fuel_diesel",
          quantity: 1000,
          unit: "L",
          period_month: "2026-03-01",
        },
      ],
      [future],
    );
    expect(rows).toHaveLength(0);
    expect(unfactored).toHaveLength(1);
    expect(unfactored[0].reason).toBe("no_factor");
    expect(totals).toEqual({ scope_1_kg: 0, scope_2_kg: 0, scope_3_kg: 0 });
  });

  it("picks the latest valid_from when two valid factors overlap", () => {
    const older = factor({ factor_code: "DIESEL-2024", valid_from: "2024-01-01" });
    const newer = factor({
      factor_code: "DIESEL-2026",
      valid_from: "2026-01-01",
      kg_co2e_per_unit: 2.7,
    });
    const hit = resolveFactor("fuel_diesel", "2026-03-01", [older, newer]);
    expect(hit?.factor_code).toBe("DIESEL-2026");
  });
});

describe("carbon.ts import hygiene", () => {
  it("imports neither Supabase nor React", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/esg/carbon.ts", "utf8");
    expect(src).not.toMatch(/from\s+["'].*supabase/i);
    expect(src).not.toMatch(/from\s+["']react/i);
  });
});
