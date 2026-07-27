// P-194 — Payment rules: overpayment, status transitions, void reversal, overdue.
import { describe, expect, it } from "vitest";

import {
  RecordPaymentSchema,
  VoidPaymentSchema,
  acceptsPayment,
  invoiceBalance,
  invoiceTotal,
  isOverdue,
  isOverpayment,
  statusAfterPayment,
  statusAfterVoid,
} from "@/lib/payments.rules";

const inv = (over: Partial<{ amount: number; tax_amount: number; paid_amount: number }> = {}) => ({
  amount: 1000,
  tax_amount: 160,
  paid_amount: 0,
  ...over,
});

describe("money math", () => {
  it("totals and balances with cents-integer precision", () => {
    expect(invoiceTotal(inv())).toBe(1160);
    expect(invoiceBalance(inv({ paid_amount: 460.1 }))).toBe(699.9);
    expect(invoiceBalance({ amount: 0.1, tax_amount: 0.2, paid_amount: 0 })).toBe(0.3);
  });
});

describe("overpayment guard", () => {
  it("allows payment up to the total (within epsilon)", () => {
    expect(isOverpayment(inv(), 1160)).toBe(false);
    expect(isOverpayment(inv({ paid_amount: 1159.999 }), 0.001)).toBe(false);
  });
  it("rejects anything above the total", () => {
    expect(isOverpayment(inv(), 1160.01)).toBe(true);
    expect(isOverpayment(inv({ paid_amount: 1000 }), 200)).toBe(true);
  });
});

describe("accepted statuses", () => {
  it("only approved/sent/partially_paid accept payments", () => {
    for (const s of ["approved", "sent", "partially_paid"]) expect(acceptsPayment(s)).toBe(true);
    for (const s of ["draft", "submitted", "under_review", "disputed", "cancelled", "paid"])
      expect(acceptsPayment(s)).toBe(false);
  });
});

describe("status after payment", () => {
  it("flips to partially_paid then paid at zero balance", () => {
    expect(statusAfterPayment(inv(), 500)).toBe("partially_paid");
    expect(statusAfterPayment(inv({ paid_amount: 500 }), 660)).toBe("paid");
  });
});

describe("void reversal", () => {
  it("reverses paid_amount and reopens the invoice", () => {
    expect(statusAfterVoid({ ...inv({ paid_amount: 1160 }), status: "paid" }, 660)).toEqual({
      status: "partially_paid",
      paid_amount: 500,
    });
    expect(
      statusAfterVoid({ ...inv({ paid_amount: 500 }), status: "partially_paid" }, 500),
    ).toEqual({ status: "sent", paid_amount: 0 });
  });
  it("never drives paid_amount negative", () => {
    expect(statusAfterVoid({ ...inv({ paid_amount: 100 }), status: "paid" }, 250).paid_amount).toBe(
      0,
    );
  });
});

describe("overdue flag", () => {
  const base = { amount: 100, tax_amount: 0, paid_amount: 0, due_date: "2026-01-01" };
  it("is true only when past due with an open balance in an eligible status", () => {
    expect(isOverdue({ ...base, status: "sent" }, "2026-02-01")).toBe(true);
    expect(isOverdue({ ...base, status: "sent" }, "2026-01-01")).toBe(false);
    expect(isOverdue({ ...base, status: "draft" }, "2026-02-01")).toBe(false);
    expect(isOverdue({ ...base, status: "paid", paid_amount: 100 }, "2026-02-01")).toBe(false);
    expect(isOverdue({ ...base, status: "partially_paid", paid_amount: 100 }, "2026-02-01")).toBe(
      false,
    );
    expect(isOverdue({ ...base, status: "sent", due_date: null }, "2026-02-01")).toBe(false);
  });
});

describe("zod schemas", () => {
  it("rejects zero/negative amounts", () => {
    const good = {
      invoice_id: "11111111-1111-1111-1111-111111111111",
      amount: 10,
      payment_date: "2026-05-01",
      method: "bank_transfer" as const,
    };
    expect(RecordPaymentSchema.safeParse(good).success).toBe(true);
    expect(RecordPaymentSchema.safeParse({ ...good, amount: 0 }).success).toBe(false);
    expect(RecordPaymentSchema.safeParse({ ...good, amount: -5 }).success).toBe(false);
    expect(RecordPaymentSchema.safeParse({ ...good, payment_date: "05/01/2026" }).success).toBe(
      false,
    );
  });
  it("requires a void reason", () => {
    expect(
      VoidPaymentSchema.safeParse({
        payment_id: "11111111-1111-1111-1111-111111111111",
        reason: "",
      }).success,
    ).toBe(false);
  });
});
