// P-220 — Emission math, scope grouping, and CHECK-constraint parity.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_SCOPE,
  computeEmissions,
  scopeOf,
  type CarbonActivity,
  type CarbonFactor,
} from "@/lib/esg/carbon";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

function f(
  category: string,
  unit: string,
  kg: number,
  code: string,
  source = "DEFRA 2024",
): CarbonFactor {
  return {
    id: code,
    company_id: null,
    category,
    unit,
    kg_co2e_per_unit: kg,
    factor_code: code,
    factor_source: source,
    valid_from: "2020-01-01",
    valid_to: null,
  };
}

const FACTORS: CarbonFactor[] = [
  f("fuel_diesel", "L", 2.68, "DIESEL-24"),
  f("fuel_petrol", "L", 2.31, "PETROL-24"),
  f("electricity_grid", "kWh", 0.45, "GRID-IEA", "IEA grid average"),
  f("transport_road", "km", 0.17, "ROAD-24"),
  f("materials_steel", "t", 1850, "STEEL-ICE", "ICE v3"),
  f("materials_concrete", "t", 120, "CONCRETE-ICE", "ICE v3"),
  f("waste_general", "kg", 0.45, "WASTE-24"),
];

const act = (over: Partial<CarbonActivity> & { id: string }): CarbonActivity => ({
  category: "fuel_diesel",
  quantity: 1,
  unit: "L",
  period_month: "2026-03-01",
  ...over,
});

describe("computeEmissions", () => {
  it("1000 L diesel × 2.68 = 2680 kg exactly, with factor citation", () => {
    const { rows, totals } = computeEmissions(
      [act({ id: "a1", quantity: 1000 })],
      FACTORS,
    );
    expect(rows[0].co2e_kg).toBe(2680);
    expect(rows[0].factor_code).toBe("DIESEL-24");
    expect(rows[0].factor_source).toBe("DEFRA 2024");
    expect(totals.scope_1_kg).toBe(2680);
  });

  it("groups categories into scopes 1 / 2 / 3", () => {
    const { totals, rows } = computeEmissions(
      [
        act({ id: "s1a", category: "fuel_diesel", quantity: 100 }),
        act({ id: "s1b", category: "fuel_petrol", quantity: 100, unit: "L" }),
        act({ id: "s2", category: "electricity_grid", quantity: 1000, unit: "kWh" }),
        act({ id: "s3a", category: "transport_road", quantity: 100, unit: "km" }),
        act({ id: "s3b", category: "materials_steel", quantity: 2, unit: "t" }),
        act({ id: "s3c", category: "materials_concrete", quantity: 10, unit: "t" }),
        act({ id: "s3d", category: "waste_general", quantity: 1000, unit: "kg" }),
      ],
      FACTORS,
    );
    expect(totals.scope_1_kg).toBeCloseTo(268 + 231, 6);
    expect(totals.scope_2_kg).toBeCloseTo(450, 6);
    expect(totals.scope_3_kg).toBeCloseTo(17 + 3700 + 1200 + 450, 6);

    const sum = rows.reduce((s, r) => s + r.co2e_kg, 0);
    expect(totals.scope_1_kg + totals.scope_2_kg + totals.scope_3_kg).toBeCloseTo(sum, 6);
  });

  it("CATEGORY_SCOPE agrees with the migration CHECK for every enum value", () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => readFileSync(join(MIGRATIONS, n), "utf8"))
      .join("\n");

    const enumBlock = sql.match(/CREATE TYPE public\.esg_factor_category AS ENUM \(([\s\S]*?)\)/i);
    expect(enumBlock).toBeTruthy();
    const values = [...enumBlock![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(10);

    const scope1 = new Set(["fuel_diesel", "fuel_petrol", "fuel_lpg"]);
    for (const category of values) {
      const expected = scope1.has(category)
        ? "scope_1"
        : category === "electricity_grid"
          ? "scope_2"
          : "scope_3";
      expect(CATEGORY_SCOPE[category], category).toBe(expected);
      expect(scopeOf(category), category).toBe(expected);
    }
  });
});
