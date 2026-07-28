// P-238 — Batch 30 receiving-cycle rules: lot/serial expansion, GPS payload
// validation and the receiving dashboard's slippage/exception math.
import { describe, expect, it } from "vitest";

import {
  duplicateSerials,
  grnDraftPayload,
  grnGeoSchema,
  serialRowsFromLines,
  type GrnLine,
} from "@/lib/grn-rules";
import {
  etaSlippage,
  matchExceptions,
  rankBySlippage,
  summarizeReceiving,
} from "@/lib/receiving-dashboard.rules";

function line(over: Partial<GrnLine>): GrnLine {
  return {
    po_line_no: 1,
    description: "DC cable",
    uom: "m",
    qty_ordered: 100,
    qty_received: 100,
    lot_ids: [],
    condition: "ok",
    defect_notes: null,
    ...over,
  };
}

describe("serialRowsFromLines", () => {
  it("splits received qty evenly across serials and de-dupes within a line", () => {
    const rows = serialRowsFromLines([
      line({ po_line_no: 1, qty_received: 100, lot_ids: ["LOT-A", "LOT-B", "LOT-A"] }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.batch_serial)).toEqual(["LOT-A", "LOT-B"]);
    expect(rows.every((r) => r.qty === 50)).toBe(true);
    expect(rows[0].grn_line_no).toBe(1);
    expect(rows[0].sku).toBe("DC cable");
  });

  it("skips lines without serials and blank entries", () => {
    const rows = serialRowsFromLines([
      line({ po_line_no: 1, lot_ids: [] }),
      line({ po_line_no: 2, description: "", qty_received: 4, lot_ids: ["  ", "S1"] }),
    ]);
    expect(rows).toEqual([{ sku: "Line 2", batch_serial: "S1", qty: 4, grn_line_no: 2 }]);
  });

  it("flags serials reused across lines", () => {
    expect(
      duplicateSerials([
        line({ po_line_no: 1, lot_ids: ["S1", "S2"] }),
        line({ po_line_no: 2, lot_ids: ["S2"] }),
      ]),
    ).toEqual(["S2"]);
  });
});

describe("GPS stamp payload", () => {
  it("accepts a valid fix and rejects out-of-range coordinates", () => {
    expect(grnGeoSchema.parse({ lat: 31.95, lng: 35.93, accuracy_m: 8 })).toMatchObject({
      lat: 31.95,
    });
    expect(() => grnGeoSchema.parse({ lat: 120, lng: 35 })).toThrow();
    expect(() => grnGeoSchema.parse({ lat: 31, lng: 200 })).toThrow();
  });

  it("is optional on the draft payload", () => {
    const parsed = grnDraftPayload.parse({ lines: [line({})], photos: [] });
    expect(parsed.geo ?? null).toBeNull();
    const withGeo = grnDraftPayload.parse({
      lines: [line({})],
      photos: [],
      geo: { lat: 31.9, lng: 35.9 },
    });
    expect(withGeo.geo?.lng).toBe(35.9);
  });
});

describe("etaSlippage", () => {
  it("classifies late, at-risk, on-time and unknown", () => {
    expect(etaSlippage({ site_need_date: "2026-09-01", current_eta: "2026-09-15" })).toEqual({
      slip_days: 14,
      severity: "late",
    });
    expect(etaSlippage({ site_need_date: "2026-09-01", current_eta: "2026-08-31" }).severity).toBe(
      "at_risk",
    );
    expect(etaSlippage({ site_need_date: "2026-09-01", current_eta: "2026-08-01" }).severity).toBe(
      "on_time",
    );
    expect(etaSlippage({ site_need_date: null, current_eta: "2026-09-01" })).toEqual({
      slip_days: null,
      severity: "unknown",
    });
  });

  it("ranks worst-first and pushes unknowns last", () => {
    const ranked = rankBySlippage([
      { id: "a", site_need_date: "2026-09-01", current_eta: "2026-09-05" },
      { id: "b", site_need_date: null, current_eta: null },
      { id: "c", site_need_date: "2026-09-01", current_eta: "2026-09-20" },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("match exceptions + summary", () => {
  const matches = [
    { id: "1", status: "matched", payment_release_blocked: false, amount_variance: 0 },
    { id: "2", status: "variance_blocked", payment_release_blocked: true, amount_variance: 500 },
    {
      id: "3",
      status: "approved_with_variance",
      payment_release_blocked: true,
      amount_variance: 20,
    },
  ];

  it("counts anything blocking payment", () => {
    expect(matchExceptions(matches).map((m) => m.id)).toEqual(["2", "3"]);
  });

  it("summarizes the dashboard counters", () => {
    const counts = summarizeReceiving({
      openReceipts: 2,
      matches,
      etas: [
        {
          id: "e1",
          po_number: "PO-0002",
          item_description: "DC cable",
          site_need_date: "2026-09-01",
          current_eta: "2026-09-15",
          eta_confirmed: false,
        },
        {
          id: "e2",
          po_number: "PO-0002",
          item_description: "Cable tray",
          site_need_date: "2026-10-01",
          current_eta: "2026-09-15",
          eta_confirmed: true,
        },
      ],
    });
    expect(counts).toEqual({
      open_receipts: 2,
      match_exceptions: 2,
      unconfirmed_etas: 1,
      late_lines: 1,
    });
  });

  it("counts has_defects receipts as open, not just drafts", () => {
    const openRows = [
      { id: "g1", status: "draft" },
      { id: "g2", status: "has_defects" },
    ];
    const counts = summarizeReceiving({
      openReceipts: openRows.length,
      matches: [],
      etas: [],
    });
    expect(counts.open_receipts).toBe(openRows.length);
  });
});
