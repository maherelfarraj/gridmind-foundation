import { describe, expect, it } from "vitest";

import {
  computeTcoMatrix,
  DEFAULT_TCO_CONFIG,
  formatRfqNumber,
  nextRfqNumber,
  parseRfqNumber,
  type BidInput,
  type RfqLine,
} from "@/lib/rfq-rules";

describe("RFQ number generator", () => {
  it("returns RFQ-0001 for empty history", () => {
    expect(nextRfqNumber([])).toBe("RFQ-0001");
  });
  it("increments from max, ignoring gaps and malformed rows", () => {
    expect(nextRfqNumber(["RFQ-0001", "RFQ-0003", "DRAFT-XYZ", ""])).toBe("RFQ-0004");
  });
  it("format and parse round-trip", () => {
    expect(formatRfqNumber(42)).toBe("RFQ-0042");
    expect(parseRfqNumber("RFQ-0042")).toBe(42);
    expect(parseRfqNumber("DRAFT-XYZ")).toBeNull();
  });
});

const rfqLines: RfqLine[] = [
  { line_no: 1, description: "PV Modules 580W", qty: 100, uom: "pcs", target_price: 200 },
  { line_no: 2, description: "Inverters 250kW", qty: 10, uom: "pcs", target_price: 15000 },
];

function bid(
  id: string,
  name: string,
  opts: {
    status?: BidInput["status"];
    lines: BidInput["lines"];
    validityDate?: string | null;
  },
): BidInput {
  return {
    bidId: id,
    vendorId: `v-${id}`,
    vendorName: name,
    status: opts.status ?? "submitted",
    validityDate: opts.validityDate ?? null,
    totalPrice: null,
    currencyCode: "USD",
    leadTimeDays: null,
    lines: opts.lines,
  };
}

describe("computeTcoMatrix", () => {
  it("winner per line flips as delay cost changes", () => {
    // Vendor A: cheaper unit price, longer lead (60 days).
    // Vendor B: pricier unit price, shorter lead (30 days).
    const bids: BidInput[] = [
      bid("A", "Slow-Cheap", {
        lines: [
          { line_no: 1, unit_price: 190, qty: 100, lead_time_days: 60 },
          { line_no: 2, unit_price: 14000, qty: 10, lead_time_days: 60 },
        ],
      }),
      bid("B", "Fast-Pricey", {
        lines: [
          { line_no: 1, unit_price: 205, qty: 100, lead_time_days: 30 },
          { line_no: 2, unit_price: 15500, qty: 10, lead_time_days: 30 },
        ],
      }),
    ];

    const low = computeTcoMatrix({
      rfqLines,
      bids,
      config: { delayCostPctPerDay: 0.01, logisticsPct: 0, defectRiskPct: 0 },
    });
    expect(low.winnersByLine.get(1)).toBe("A");

    const high = computeTcoMatrix({
      rfqLines,
      bids,
      config: { delayCostPctPerDay: 0.5, logisticsPct: 0, defectRiskPct: 0 },
    });
    expect(high.winnersByLine.get(1)).toBe("B");
  });

  it("flags missing lines as non-compliant", () => {
    const bids: BidInput[] = [
      bid("A", "Full", {
        lines: [
          { line_no: 1, unit_price: 200, qty: 100, lead_time_days: 30 },
          { line_no: 2, unit_price: 15000, qty: 10, lead_time_days: 30 },
        ],
      }),
      bid("B", "Partial", {
        lines: [{ line_no: 1, unit_price: 180, qty: 100, lead_time_days: 30 }],
      }),
    ];
    const m = computeTcoMatrix({
      rfqLines,
      bids,
      config: DEFAULT_TCO_CONFIG,
    });
    const partial = m.rows.find((r) => r.bidId === "B")!;
    expect(partial.compliant).toBe(false);
    expect(partial.issues.some((i) => i.kind === "missing_line")).toBe(true);
    // Winner per line 1 must still be a compliant bid (A), not the cheaper non-compliant B.
    expect(m.winnersByLine.get(1)).toBe("A");
  });

  it("flags expired validity", () => {
    const bids: BidInput[] = [
      bid("A", "Expired", {
        validityDate: "2000-01-01",
        lines: [{ line_no: 1, unit_price: 200, qty: 100, lead_time_days: 30 }],
      }),
    ];
    const m = computeTcoMatrix({ rfqLines, bids, config: DEFAULT_TCO_CONFIG });
    expect(m.rows[0].issues.some((i) => i.kind === "expired_validity")).toBe(true);
  });

  it("signed price variance vs target price", () => {
    const bids: BidInput[] = [
      bid("A", "Under", {
        lines: [
          { line_no: 1, unit_price: 180, qty: 100, lead_time_days: 30 },
          { line_no: 2, unit_price: 16500, qty: 10, lead_time_days: 30 },
        ],
      }),
    ];
    const m = computeTcoMatrix({ rfqLines, bids, config: DEFAULT_TCO_CONFIG });
    const cell1 = m.rows[0].cells.get(1)!;
    const cell2 = m.rows[0].cells.get(2)!;
    expect(cell1.price_variance_pct).toBeCloseTo(-10, 4); // 180 vs 200
    expect(cell2.price_variance_pct).toBeCloseTo(10, 4); // 16500 vs 15000
  });
});
