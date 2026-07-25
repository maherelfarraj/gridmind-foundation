import { describe, expect, it } from "vitest";

import {
  amountVariancePct,
  assertInvoicePath,
  computeVariances,
  deriveMatchStatus,
  matchCreatePayload,
  matchOverridePayload,
} from "@/lib/match-rules";

describe("computeVariances", () => {
  it("returns zeros and matched when invoice equals PO exactly", () => {
    const v = computeVariances({
      poTotal: 10000,
      poLines: [{ po_line_no: 1, qty: 100, unit_price: 100 }],
      grnQtyByLine: new Map([[1, 100]]),
      invoiceAmount: 10000,
      invoiceLines: [{ po_line_no: 1, qty: 100, unit_price: 100 }],
    });
    expect(v.amount_variance).toBe(0);
    expect(v.qty_variance_pct).toBe(0);
    expect(v.price_variance_pct).toBe(0);
    expect(deriveMatchStatus({ variances: v, poTotal: 10000, thresholdPct: 5 })).toBe("matched");
  });

  it("+8% on amount blocks payment", () => {
    const v = computeVariances({
      poTotal: 10000,
      poLines: [{ po_line_no: 1, qty: 100, unit_price: 100 }],
      grnQtyByLine: { 1: 100 },
      invoiceAmount: 10800,
    });
    expect(v.amount_variance).toBe(800);
    expect(amountVariancePct(v.amount_variance, 10000)).toBe(8);
    expect(deriveMatchStatus({ variances: v, poTotal: 10000, thresholdPct: 5 })).toBe(
      "variance_blocked",
    );
  });

  it("per-line qty variance uses received qty and picks worst line", () => {
    const v = computeVariances({
      poTotal: 20000,
      poLines: [
        { po_line_no: 1, qty: 100, unit_price: 100 },
        { po_line_no: 2, qty: 100, unit_price: 100 },
      ],
      grnQtyByLine: { 1: 100, 2: 100 },
      invoiceAmount: 20000,
      invoiceLines: [
        { po_line_no: 1, qty: 100, unit_price: 100 },
        { po_line_no: 2, qty: 110, unit_price: 100 },
      ],
    });
    expect(v.qty_variance_pct).toBe(10);
  });

  it("per-line price variance compared to PO unit price", () => {
    const v = computeVariances({
      poTotal: 10000,
      poLines: [{ po_line_no: 1, qty: 100, unit_price: 100 }],
      grnQtyByLine: { 1: 100 },
      invoiceAmount: 10600,
      invoiceLines: [{ po_line_no: 1, qty: 100, unit_price: 106 }],
    });
    expect(v.price_variance_pct).toBe(6);
    expect(deriveMatchStatus({ variances: v, poTotal: 10000, thresholdPct: 5 })).toBe(
      "variance_blocked",
    );
  });

  it("threshold exactly at variance still matches", () => {
    const v = computeVariances({
      poTotal: 10000,
      poLines: [{ po_line_no: 1, qty: 100, unit_price: 100 }],
      grnQtyByLine: { 1: 100 },
      invoiceAmount: 10500,
    });
    expect(deriveMatchStatus({ variances: v, poTotal: 10000, thresholdPct: 5 })).toBe("matched");
  });
});

describe("zod payloads", () => {
  it("rejects empty vendor invoice number", () => {
    expect(() =>
      matchCreatePayload.parse({
        poId: "00000000-0000-0000-0000-000000000000",
        vendor_invoice_number: "",
        invoice_amount: 100,
      }),
    ).toThrow();
  });
  it("rejects non-positive invoice amount", () => {
    expect(() =>
      matchCreatePayload.parse({
        poId: "00000000-0000-0000-0000-000000000000",
        vendor_invoice_number: "INV-1",
        invoice_amount: 0,
      }),
    ).toThrow();
  });
  it("rejects short override note", () => {
    expect(() =>
      matchOverridePayload.parse({
        matchId: "00000000-0000-0000-0000-000000000000",
        resolution_note: "ok",
      }),
    ).toThrow();
  });
});

describe("assertInvoicePath", () => {
  it("accepts a path scoped to {company}/invoices/{match}/", () => {
    expect(() => assertInvoicePath("co/invoices/mid/x.pdf", "co", "mid")).not.toThrow();
  });
  it("rejects wrong prefix and path traversal", () => {
    expect(() => assertInvoicePath("bad/x.pdf", "co", "mid")).toThrow();
    expect(() => assertInvoicePath("co/invoices/mid/../x.pdf", "co", "mid")).toThrow();
  });
});
