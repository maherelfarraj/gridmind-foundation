// P-213 — pure comparison + revision-diff engines.
import { describe, expect, it } from "vitest";

import {
  buildComparisonRows,
  classifyPoLine,
  committedByType,
  estimatedByType,
  meanAbsoluteVariance,
  variancePct,
  varianceTone,
} from "@/lib/estimating/comparison";
import { canCreateRevision, diffRevisions } from "@/lib/estimating/revision-diff";

describe("PO line classification", () => {
  it("maps equipment purchases to material", () => {
    expect(classifyPoLine({ description: "550W PV module" })).toBe("material");
    expect(classifyPoLine({ description: "DC cable 4mm2" })).toBe("material");
  });

  it("maps installation and civil work to subcontract", () => {
    expect(classifyPoLine({ description: "Civil earthworks" })).toBe("subcontract");
    expect(classifyPoLine({ description: "Installation of trackers" })).toBe("subcontract");
  });

  it("falls back to other when unmappable", () => {
    expect(classifyPoLine({ description: "Misc allowance" })).toBe("other");
  });
});

describe("committed attribution", () => {
  it("splits a PO total across its line categories", () => {
    const out = committedByType([
      {
        id: "po1",
        total: 1000,
        lines: [
          { description: "PV module", amount: 750 },
          { description: "Installation", amount: 250 },
        ],
      },
    ]);
    expect(out.material).toBeCloseTo(750, 2);
    expect(out.subcontract).toBeCloseTo(250, 2);
  });
});

describe("variance", () => {
  it("is null when estimated is zero or actuals missing", () => {
    expect(variancePct(0, 100)).toBeNull();
    expect(variancePct(100, null)).toBeNull();
  });

  it("flips tone at exactly >5% and >10%", () => {
    expect(varianceTone(5)).toBe("neutral");
    expect(varianceTone(5.1)).toBe("warning");
    expect(varianceTone(10)).toBe("warning");
    expect(varianceTone(10.1)).toBe("destructive");
    expect(varianceTone(-10.1)).toBe("destructive");
  });

  it("averages absolute variance and ignores nulls", () => {
    expect(meanAbsoluteVariance([10, -20, null])).toBeCloseTo(15, 5);
    expect(meanAbsoluteVariance([null])).toBeNull();
  });
});

describe("comparison rows", () => {
  it("reconciles estimated per type and degrades missing sources to null", () => {
    const { rows, total } = buildComparisonRows({
      estimated: estimatedByType([
        { line_type: "material", amount: 1000 },
        { line_type: "labor", amount: 500 },
      ]),
      committed: null,
      actuals: null,
    });
    const material = rows.find((r) => r.line_type === "material")!;
    expect(material.estimated).toBe(1000);
    expect(material.committed).toBeNull();
    expect(material.actuals).toBeNull();
    expect(material.variance_pct).toBeNull();
    expect(total.estimated).toBe(1500);
  });
});

describe("revisions", () => {
  it("refuses revisions of draft or in_review estimates", () => {
    expect(canCreateRevision("draft")).toBe(false);
    expect(canCreateRevision("in_review")).toBe(false);
    expect(canCreateRevision("priced")).toBe(true);
    expect(canCreateRevision("approved")).toBe(true);
  });

  it("diffs margins, totals and lines", () => {
    const base = {
      id: "a",
      estimate_number: "EST-0001",
      revision: 1,
      status: "superseded",
      currency_code: "USD",
      direct_cost: 1000,
      subtotal: 1100,
      total_price: 1200,
      escalation_pct: 2,
      overhead_pct: 5,
      contingency_pct: 3,
      margin_pct: 10,
      priced_at: null,
      submitted_at: null,
      actor: null,
    };
    const diff = diffRevisions(
      {
        summary: base,
        lines: [
          {
            id: "l1",
            description: "Module",
            line_type: "material",
            qty: 10,
            unit_rate: 145,
            amount: 1450,
            source_bom_line_id: "b1",
          },
          {
            id: "l2",
            description: "Old",
            line_type: "other",
            qty: 1,
            unit_rate: 10,
            amount: 10,
            source_bom_line_id: null,
          },
        ],
      },
      {
        summary: { ...base, id: "b", revision: 2, escalation_pct: 3, total_price: 1300 },
        lines: [
          {
            id: "l3",
            description: "Module",
            line_type: "material",
            qty: 10,
            unit_rate: 152.5,
            amount: 1525,
            source_bom_line_id: "b1",
          },
          {
            id: "l4",
            description: "New",
            line_type: "labor",
            qty: 2,
            unit_rate: 50,
            amount: 100,
            source_bom_line_id: null,
          },
        ],
      },
    );
    expect(diff.margins.some((m) => m.from === 2 && m.to === 3)).toBe(true);
    expect(diff.totals.some((t) => t.delta === 100)).toBe(true);
    expect(diff.added).toHaveLength(1);
    expect(diff.removed).toHaveLength(1);
    expect(diff.changed[0]?.unit_rate).toEqual({ from: 145, to: 152.5 });
  });
});
