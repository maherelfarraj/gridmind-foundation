// P-261 — subcontractor money loop: AP invoice, retention ledger, WIP reflection.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  apDueDate,
  apInvoiceAmount,
  apInvoiceNumber,
  certifiedSubActuals,
  checkRetentionRelease,
  isApInvoiceNumber,
  retentionLedger,
} from "@/lib/subcontract-finance.rules";
import { isAgingEligible } from "@/lib/ar-aging.rules";

describe("AP numbering + terms", () => {
  it("uses a dedicated AP-#### series", () => {
    expect(apInvoiceNumber(1)).toBe("AP-0001");
    expect(apInvoiceNumber(42)).toBe("AP-0042");
    expect(isApInvoiceNumber("AP-0042")).toBe(true);
    expect(isApInvoiceNumber("INV-0042")).toBe(false);
  });

  it("defaults to NET-30 and honours subcontract terms", () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(30);
    expect(apDueDate("2026-07-01", null)).toBe("2026-07-31");
    expect(apDueDate("2026-07-01", 45)).toBe("2026-08-15");
    expect(apDueDate("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("invoices the net payable only — retention never rides the invoice", () => {
    expect(apInvoiceAmount({ net_payable: 90_000 })).toBe(90_000);
  });
});

describe("retention ledger", () => {
  it("held = retained − released, and nets to zero at full release", () => {
    const mid = retentionLedger({ certifiedRetention: [5000, 5000], releases: [3000] });
    expect(mid.retained).toBe(10_000);
    expect(mid.released).toBe(3000);
    expect(mid.held).toBe(7000);
    expect(mid.fullyReleased).toBe(false);

    const end = retentionLedger({ certifiedRetention: [5000, 5000], releases: [3000, 7000] });
    expect(end.held).toBe(0);
    expect(end.fullyReleased).toBe(true);
  });

  it("is cent-exact across fractional retention", () => {
    const l = retentionLedger({ certifiedRetention: [1234.567, 0.005], releases: [1234.57] });
    expect(l.held).toBe(0);
  });
});

describe("retention release guards", () => {
  const base = {
    amount: 1000,
    retentionHeld: 5000,
    defectsLiabilityEnd: "2026-06-30",
    releaseDate: "2026-07-28",
    canOverrideDlp: false,
  };
  it("allows release after the defects-liability end", () => {
    expect(checkRetentionRelease(base)).toEqual({ ok: true });
  });
  it("blocks release before DLP unless overridden by finance", () => {
    const early = { ...base, defectsLiabilityEnd: "2027-01-01" };
    expect(checkRetentionRelease(early)).toEqual({ ok: false, reason: "before_dlp" });
    expect(checkRetentionRelease({ ...early, canOverrideDlp: true })).toEqual({ ok: true });
  });
  it("blocks over-release and non-positive amounts", () => {
    expect(checkRetentionRelease({ ...base, amount: 5000.01 })).toEqual({
      ok: false,
      reason: "exceeds_held",
    });
    expect(checkRetentionRelease({ ...base, amount: 0 })).toEqual({
      ok: false,
      reason: "amount_invalid",
    });
  });
});

describe("WIP / EVM reflection", () => {
  const claims = [
    { status: "certified", certified_at: "2026-07-10T09:00:00Z", this_period_amount: 100_000 },
    { status: "certified", certified_at: "2026-08-02T09:00:00Z", this_period_amount: 50_000 },
    { status: "submitted", certified_at: null, this_period_amount: 25_000 },
  ];
  it("counts certified claims only, as of the snapshot date", () => {
    expect(certifiedSubActuals(claims, "2026-07-31")).toBe(100_000);
    expect(certifiedSubActuals(claims, "2026-08-31")).toBe(150_000);
  });
});

describe("AP aging eligibility", () => {
  const inv = { status: "approved", amount: 90_000, tax_amount: 0, paid_amount: 0 };
  it("includes payable invoices when the engine is pointed at payables", () => {
    expect(isAgingEligible({ ...inv, direction: "payable" }, "payable")).toBe(true);
    expect(isAgingEligible({ ...inv, direction: "receivable" }, "payable")).toBe(false);
  });
  it("keeps the receivable default intact", () => {
    expect(isAgingEligible({ ...inv, direction: "payable" })).toBe(false);
    expect(isAgingEligible({ ...inv, direction: "receivable" })).toBe(true);
  });
  it("drops fully paid invoices from aging", () => {
    expect(
      isAgingEligible({ ...inv, direction: "payable", paid_amount: 90_000 }, "payable"),
    ).toBe(false);
  });
});
