// P-210 — Pure estimating rules: BOM import mapping, amounts, rate validity,
// CSV parsing and zod guards.
import { describe, expect, it } from "vitest";

import {
  CreateEstimateSchema,
  ESTIMATE_WRITE_ROLES,
  RATE_WRITE_ROLES,
  UpsertEstimateLineSchema,
  bomLinesToEstimateLines,
  isEstimateEditable,
  lineAmount,
  parseRateCsv,
  rateValidity,
  round2,
  sumAmounts,
} from "@/lib/estimating.rules";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("amount maths", () => {
  it("rounds line amounts to 2dp", () => {
    expect(lineAmount(3, 1.115)).toBe(3.35);
    expect(lineAmount(2.5, 168.5)).toBe(421.25);
    expect(lineAmount(0, 99)).toBe(0);
    expect(round2(10 / 3)).toBe(3.33);
  });

  it("sums line amounts into the direct cost", () => {
    expect(sumAmounts([{ amount: 1.115 }, { amount: 2.22 }, { amount: 3 }])).toBe(6.34);
  });
});

describe("BOM import", () => {
  const lines = [
    { id: "a", item: "PV module", spec: "580 Wp", qty_buffered: 10, unit: "ea", unit_cost: 168.5 },
    { id: "b", item: "Cable", spec: null, qty_buffered: 2.5, unit: "km", unit_cost: null },
  ];

  it("copies every line as material, preserving source traceability", () => {
    const out = bomLinesToEstimateLines(lines);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      line_type: "material",
      description: "PV module — 580 Wp",
      qty: 10,
      uom: "ea",
      unit_rate: 168.5,
      amount: 1685,
      source_bom_line_id: "a",
      sort_order: 0,
    });
    expect(out[1].description).toBe("Cable");
    expect(out[1].unit_rate).toBe(0);
    expect(out[1].sort_order).toBe(1);
  });

  it("direct cost equals Σ qty_buffered × unit_cost", () => {
    expect(sumAmounts(bomLinesToEstimateLines(lines))).toBe(1685);
  });
});

describe("rate validity", () => {
  it("treats open-ended and far-future rates as current", () => {
    expect(rateValidity(null, "2026-07-27")).toBe("current");
    expect(rateValidity("2027-01-01", "2026-07-27")).toBe("current");
  });
  it("flags rates expiring within 30 days", () => {
    expect(rateValidity("2026-08-20", "2026-07-27")).toBe("expiring");
    expect(rateValidity("2026-07-27", "2026-07-27")).toBe("expiring");
  });
  it("marks past rates expired, never current", () => {
    expect(rateValidity("2026-07-26", "2026-07-27")).toBe("expired");
  });
});

describe("editability + roles", () => {
  it("only drafts are editable", () => {
    expect(isEstimateEditable("draft")).toBe(true);
    for (const s of ["in_review", "approved", "priced", "superseded"]) {
      expect(isEstimateEditable(s)).toBe(false);
    }
  });
  it("finance_admin may write rates but not estimates", () => {
    expect(ESTIMATE_WRITE_ROLES).not.toContain("finance_admin");
    expect(RATE_WRITE_ROLES).toContain("finance_admin");
  });
});

describe("schemas", () => {
  it("rejects negative qty and rate", () => {
    const base = {
      estimate_id: UUID,
      line_type: "labor",
      description: "Crew",
      uom: "hr",
      qty: -1,
      unit_rate: 5,
    };
    expect(UpsertEstimateLineSchema.safeParse(base).success).toBe(false);
    expect(UpsertEstimateLineSchema.safeParse({ ...base, qty: 1 }).success).toBe(true);
    expect(UpsertEstimateLineSchema.safeParse({ ...base, qty: 1, unit_rate: -2 }).success).toBe(
      false,
    );
  });

  it("requires a project and upper-cases the currency", () => {
    const parsed = CreateEstimateSchema.safeParse({
      title: "EPC estimate",
      project_id: UUID,
      currency_code: "usd",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currency_code).toBe("USD");
    expect(
      CreateEstimateSchema.safeParse({ title: "x", project_id: UUID, currency_code: "USD" })
        .success,
    ).toBe(false);
  });
});

describe("CSV paste import", () => {
  const csv = [
    "rate_type,name,uom,unit_rate,currency_code,category,supplier,valid_from,valid_to",
    "material,PV module 580W,ea,168.50,USD,Modules,Trina,2026-01-01,2026-12-31",
    "labor,Electrician,hr,22,USD,Crew,,2026-01-01,",
    "widget,Bad type,ea,1,USD,,,,",
    "material,Backwards,ea,1,USD,,,2026-06-01,2026-01-01",
  ].join("\n");

  it("parses valid rows and reports per-row errors", () => {
    const rows = parseRateCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0].row).toMatchObject({ rate_type: "material", unit_rate: 168.5, uom: "ea" });
    expect(rows[1].row?.valid_to ?? null).toBeNull();
    expect(rows[2].row).toBeNull();
    expect(rows[2].errors.join(" ")).toContain("rate_type");
    expect(rows[3].row).toBeNull();
    expect(rows[3].errors.join(" ")).toContain("valid_to");
  });

  it("works without a header row and reports 1-based line numbers", () => {
    const rows = parseRateCsv("plant,Crane 50t,day,900,USD,,,,");
    expect(rows[0].line).toBe(1);
    expect(rows[0].row?.rate_type).toBe("plant");
  });
});
