// P-216 — Pure-rule tests for the ESG activity register.
import { describe, expect, it } from "vitest";

import {
  categoriesForTab,
  csvFingerprint,
  currentMonthKey,
  equipmentFuelFingerprint,
  evidenceError,
  evidencePath,
  firstOfMonth,
  monthRange,
  parseActivityCsv,
  resolveFactors,
  rowHash,
  tabOfCategory,
  wasteFingerprint,
  WASTE_TYPE_TO_CATEGORY,
  type FactorRow,
} from "@/lib/esg/activity.rules";

describe("month normalisation", () => {
  it("normalises to the first of the month", () => {
    expect(firstOfMonth("2026-07")).toBe("2026-07-01");
    expect(firstOfMonth("2026-07-23")).toBe("2026-07-01");
  });

  it("rejects malformed months", () => {
    expect(() => firstOfMonth("July 2026")).toThrow();
    expect(() => firstOfMonth("2026-13")).toThrow();
  });

  it("builds a half-open range that rolls the year", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });

  it("formats the current month as YYYY-MM", () => {
    expect(currentMonthKey(new Date("2026-03-09T00:00:00Z"))).toBe("2026-03");
  });
});

describe("category tabs", () => {
  it("maps each category to its tab", () => {
    expect(tabOfCategory("fuel_diesel")).toBe("fuel");
    expect(tabOfCategory("waste_hazardous")).toBe("waste");
    expect(tabOfCategory("other")).toBe("other");
  });

  it("lists categories per tab", () => {
    expect(categoriesForTab("waste")).toEqual([
      "waste_general",
      "waste_hazardous",
      "waste_recyclable",
    ]);
  });

  it("maps waste stream types to categories", () => {
    expect(WASTE_TYPE_TO_CATEGORY.general).toBe("waste_general");
    expect(WASTE_TYPE_TO_CATEGORY.hazardous).toBe("waste_hazardous");
    expect(WASTE_TYPE_TO_CATEGORY.recyclable).toBe("waste_recyclable");
  });
});

describe("fingerprints", () => {
  it("is deterministic for equipment fuel per project + month", () => {
    const a = equipmentFuelFingerprint("p1", "2026-07-31");
    expect(a).toBe("equipment_fuel:p1:2026-07:fuel_diesel");
    expect(a).toBe(equipmentFuelFingerprint("p1", "2026-07"));
  });

  it("is per-row for waste", () => {
    expect(wasteFingerprint("w1")).toBe("waste:w1");
    expect(wasteFingerprint("w1")).not.toBe(wasteFingerprint("w2"));
  });

  it("hashes CSV rows stably", () => {
    expect(rowHash("a|1|L|2026-07")).toBe(rowHash("a|1|L|2026-07"));
    expect(rowHash("a|1|L|2026-07")).not.toBe(rowHash("a|2|L|2026-07"));
    expect(csvFingerprint("p1", "2026-07", "fuel_diesel", "abcd1234")).toBe(
      "import:p1:2026-07:fuel_diesel:abcd1234",
    );
  });
});

describe("csv preview", () => {
  it("accepts valid rows and flags invalid ones", () => {
    const preview = parseActivityCsv(
      [
        "category,quantity,unit,month",
        "fuel_diesel,1200,L,2026-07",
        "electricity_grid,-5,kWh,2026-07",
        "unknown_cat,10,kg,2026-07",
        "fuel_petrol,10,L",
      ].join("\n"),
    );
    expect(preview).toHaveLength(5);
    expect(preview[0].ok).toBe(false); // header
    expect(preview[1].ok).toBe(true);
    expect(preview[1].value?.quantity).toBe(1200);
    expect(preview[2].ok).toBe(false);
    expect(preview[3].ok).toBe(false);
    expect(preview[4].error).toContain("4 columns");
  });
});

describe("evidence rules", () => {
  it("rejects wrong type and oversized files", () => {
    expect(evidenceError({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(evidenceError({ size: 1000, type: "text/csv" })).toMatch(/PDF/);
    expect(evidenceError({ size: 11 * 1024 * 1024, type: "image/png" })).toMatch(/10 MB/);
  });

  it("builds a company-UUID-first path", () => {
    expect(
      evidencePath({ companyId: "c1", projectId: "p1", activityId: "a1", fileName: "my file.pdf" }),
    ).toBe("c1/esg/evidence/p1/a1/my_file.pdf");
  });
});

describe("factor resolution", () => {
  const rows: FactorRow[] = [
    {
      id: "1",
      company_id: null,
      category: "fuel_diesel",
      unit: "L",
      kg_co2e_per_unit: 2.68,
      factor_source: "DEFRA 2024",
    },
    {
      id: "2",
      company_id: "c1",
      category: "fuel_diesel",
      unit: "gal",
      kg_co2e_per_unit: 10.1,
      factor_source: "GSI internal",
    },
    {
      id: "3",
      company_id: null,
      category: "waste_general",
      unit: "kg",
      kg_co2e_per_unit: 0.45,
      factor_source: "DEFRA 2024",
    },
  ];

  it("prefers the company override regardless of row order", () => {
    for (const list of [rows, [...rows].reverse()]) {
      const resolved = resolveFactors(list);
      expect(resolved.fuel_diesel.unit).toBe("gal");
      expect(resolved.fuel_diesel.scope).toBe("company");
      expect(resolved.waste_general.scope).toBe("global");
    }
  });
});
