import { describe, expect, it } from "vitest";

import {
  buildPoLinesFromAwards,
  computePoTotals,
  formatPoNumber,
  maxSiteNeedDate,
  nextPoNumber,
  parsePoNumber,
} from "@/lib/po-rules";
import type { RfqLine } from "@/lib/rfq-rules";

describe("PO number generator", () => {
  it("starts at PO-0001 when empty", () => {
    expect(nextPoNumber([])).toBe("PO-0001");
  });
  it("ignores malformed numbers and increments the max", () => {
    expect(nextPoNumber(["PO-0001", "junk", "PO-0007", ""])).toBe("PO-0008");
  });
  it("format/parse round-trip", () => {
    expect(formatPoNumber(42)).toBe("PO-0042");
    expect(parsePoNumber("PO-0042")).toBe(42);
    expect(parsePoNumber("nope")).toBeNull();
  });
});

describe("computePoTotals", () => {
  it("sums line amounts and applies tax with 2dp rounding", () => {
    const totals = computePoTotals(
      [{ amount: 100.005 }, { amount: 250.99 }],
      10,
    );
    expect(totals.subtotal).toBe(351);
    expect(totals.tax_amount).toBe(35.1);
    expect(totals.total_amount).toBe(386.1);
  });
  it("handles zero tax", () => {
    const totals = computePoTotals([{ amount: 500 }], 0);
    expect(totals.tax_amount).toBe(0);
    expect(totals.total_amount).toBe(500);
  });
});

describe("buildPoLinesFromAwards", () => {
  const rfqLines: RfqLine[] = [
    { line_no: 2, description: "Inverters", qty: 5, uom: "pcs", spec: "250kW", site_need_date: "2026-08-01" },
    { line_no: 1, description: "Modules", qty: 100, uom: "pcs", spec: "580W" },
  ];

  it("merges award qty/price with RFQ spec/desc/uom and sorts by line_no", () => {
    const lines = buildPoLinesFromAwards(rfqLines, [
      { line_no: 2, awarded_qty: 5, awarded_unit_price: 15000 },
      { line_no: 1, awarded_qty: 100, awarded_unit_price: 195 },
    ]);
    expect(lines.map((l) => l.line_no)).toEqual([1, 2]);
    expect(lines[0].description).toBe("Modules");
    expect(lines[0].spec).toBe("580W");
    expect(lines[0].amount).toBe(19500);
    expect(lines[1].amount).toBe(75000);
    expect(maxSiteNeedDate(lines)).toBe("2026-08-01");
  });

  it("computed totals from built lines are correct", () => {
    const lines = buildPoLinesFromAwards(rfqLines, [
      { line_no: 1, awarded_qty: 100, awarded_unit_price: 195 },
      { line_no: 2, awarded_qty: 5, awarded_unit_price: 15000 },
    ]);
    const t = computePoTotals(lines, 5);
    expect(t.subtotal).toBe(94500);
    expect(t.tax_amount).toBe(4725);
    expect(t.total_amount).toBe(99225);
  });
});
