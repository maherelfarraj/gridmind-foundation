// P-212 — estimate → proposal conversion mapping fixtures.
import { describe, expect, it } from "vitest";

import { computeEstimate } from "@/lib/estimating/buildup";
import {
  LINE_TYPE_CATEGORY,
  proposalLinesFromEstimate,
  sumLineTotals,
} from "@/lib/estimating/convert";

const margins = {
  escalation_pct: 2,
  contingency_pct: 5,
  overhead_pct: 8,
  profit_pct: 10,
};

const lines = [
  { line_type: "material", amount: 60_000, qty: 1, unit_rate: 60_000 },
  { line_type: "labor", amount: 25_000, qty: 1, unit_rate: 25_000 },
  { line_type: "plant", amount: 10_000, qty: 1, unit_rate: 10_000 },
  { line_type: "subcontract", amount: 5_000, qty: 1, unit_rate: 5_000 },
];

describe("proposalLinesFromEstimate", () => {
  const buildup = computeEstimate(lines, margins);
  const drafts = proposalLinesFromEstimate(lines, buildup);

  it("maps line types to the P-046 category map", () => {
    expect(LINE_TYPE_CATEGORY).toMatchObject({
      material: "equipment",
      labor: "installation",
      plant: "equipment",
      subcontract: "other",
      other: "other",
    });
    expect(drafts.find((d) => d.description.startsWith("Materials"))?.category).toBe("equipment");
    expect(drafts.find((d) => d.description.startsWith("Labour"))?.category).toBe("installation");
  });

  it("emits contingency as its own category and margin stages as other", () => {
    const contingency = drafts.find((d) => d.description === "Contingency");
    expect(contingency?.category).toBe("contingency");
    expect(drafts.find((d) => d.description === "Escalation")?.category).toBe("other");
    expect(drafts.find((d) => d.description === "Overhead & indirect costs")?.category).toBe(
      "other",
    );
  });

  it("reconciles Σ line_total with the build-up subtotal", () => {
    expect(sumLineTotals(drafts)).toBeCloseTo(buildup.subtotal, 2);
  });

  it("reconciles subtotal × (1 + margin/100) with total_price", () => {
    const total = Math.round(buildup.subtotal * (1 + margins.profit_pct / 100) * 100) / 100;
    expect(total).toBeCloseTo(buildup.total_price, 2);
  });

  it("uses lot quantities of 1 and skips zero stages", () => {
    expect(drafts.every((d) => d.qty === 1 && d.unit === "lot")).toBe(true);
    const zero = proposalLinesFromEstimate(
      lines,
      computeEstimate(lines, { ...margins, escalation_pct: 0 }),
    );
    expect(zero.some((d) => d.description === "Escalation")).toBe(false);
  });
});
