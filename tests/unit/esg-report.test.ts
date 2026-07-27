// P-219 — ESG report flow rules (pure, offline).
import { describe, expect, it } from "vitest";

import type { ComputedRow } from "@/lib/esg/carbon";
import {
  approvalStageLabel,
  canGenerate,
  canPublish,
  ESG_APPROVAL_CHAIN,
  ESG_REPORT_RULE_KEY,
  esgReportFilename,
  esgReportPdfPath,
  lenderIndicatorRows,
  scopeSubtotalKg,
  scopeTableRows,
} from "@/lib/esg/report.rules";

const row = (over: Partial<ComputedRow>): ComputedRow =>
  ({
    id: "a1",
    category: "diesel",
    quantity: 100,
    unit: "L",
    period_month: "2026-01-01",
    co2e_kg: 268,
    scope: "scope_1",
    factor_code: "DEFRA-DIESEL",
    factor_source: "DEFRA 2024",
    factor_unit: "L",
    kg_co2e_per_unit: 2.68,
    ...over,
  }) as ComputedRow;

describe("esg report rules", () => {
  it("uses the seeded rule key and hse → company_admin chain", () => {
    expect(ESG_REPORT_RULE_KEY).toBe("esg_report");
    expect(ESG_APPROVAL_CHAIN).toEqual(["hse_admin", "company_admin"]);
  });

  it("builds the contract storage path and filename", () => {
    expect(esgReportPdfPath("c1", "r1")).toBe("c1/esg/r1.pdf");
    expect(esgReportFilename("ESG-0007", "2026-01-01", "2026-03-31")).toBe(
      "ESG-0007_2026-01-01_2026-03-31.pdf",
    );
  });

  it("labels the pending stage from the current step", () => {
    expect(approvalStageLabel(1)).toContain("awaiting HSE Admin");
    expect(approvalStageLabel(2)).toContain("awaiting Company Admin");
    expect(approvalStageLabel(null)).toContain("awaiting HSE Admin");
  });

  it("gates generate and publish transitions", () => {
    expect(canGenerate("draft", false)).toBe(true);
    expect(canGenerate("draft", true)).toBe(false);
    expect(canGenerate("approved", false)).toBe(false);
    expect(canPublish("approved", true)).toBe(true);
    expect(canPublish("approved", false)).toBe(false);
    expect(canPublish("draft", true)).toBe(false);
  });

  it("emits per-scope rows with factor citations and subtotals", () => {
    const rows = [
      row({}),
      row({ id: "a2", co2e_kg: 132 }),
      row({ id: "a3", scope: "scope_2", category: "electricity_grid", co2e_kg: 500 }),
    ];
    const s1 = scopeTableRows(rows, "scope_1");
    expect(s1).toHaveLength(2);
    expect(s1[0].factor_code).toBe("DEFRA-DIESEL");
    expect(s1[0].factor_source).toBe("DEFRA 2024");
    expect(scopeSubtotalKg(s1)).toBe(400);
    expect(scopeSubtotalKg(scopeTableRows(rows, "scope_2"))).toBe(500);
    expect(scopeTableRows(rows, "scope_3")).toEqual([]);
  });

  it("renders the lender indicator table with formulas and n/a fallbacks", () => {
    const rows = lenderIndicatorRows({
      totals: { scope_1_kg: 1000, scope_2_kg: 2000, scope_3_kg: 0 },
      avoidedKg: null,
      netKg: 3000,
      meteredMwh: null,
      intensity: null,
      diversionPct: 42.5,
      trir: null,
    });
    const by = Object.fromEntries(rows.map((r) => [r.indicator, r]));
    expect(by["Gross emissions"].value).toBe("3 t CO2e");
    expect(by["Gross emissions"].formula).toBe("scope 1 + scope 2 + scope 3");
    expect(by["Avoided emissions"].value).toBe("n/a");
    expect(by["Carbon intensity"].value).toBe("n/a");
    expect(by["Renewable generation"].value).toBe("n/a");
    expect(by["Waste diversion"].value).toBe("42.5 %");
    expect(by["TRIR"].value).toBe("n/a");
    expect(rows.every((r) => r.formula.length > 0)).toBe(true);
  });

  it("computes intensity and avoided values when telemetry exists", () => {
    const rows = lenderIndicatorRows({
      totals: { scope_1_kg: 1000, scope_2_kg: 0, scope_3_kg: 0 },
      avoidedKg: 55_000,
      netKg: -54_000,
      meteredMwh: 100,
      intensity: 10,
      diversionPct: null,
      trir: 1.234,
    });
    const by = Object.fromEntries(rows.map((r) => [r.indicator, r]));
    expect(by["Avoided emissions"].value).toBe("55 t CO2e");
    expect(by["Net emissions"].value).toBe("-54 t CO2e");
    expect(by["Carbon intensity"].value).toBe("10 kg CO2e/MWh");
    expect(by["Renewable generation"].value).toBe("100 MWh");
    expect(by["TRIR"].value).toBe("1.23");
  });
});
