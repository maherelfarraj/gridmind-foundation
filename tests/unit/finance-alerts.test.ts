// P-199 — Finance alert rule evaluators + threshold parsing.
import { describe, expect, it } from "vitest";

import {
  bucketTotal,
  defaultThreshold,
  evaluateArAging,
  evaluateOverdueInvoices,
  evaluateUnbilledCertified,
  evaluateUnmatchedPayments,
  parseThreshold,
  severityTone,
} from "@/lib/finance-alerts.rules";

const TODAY = "2026-07-27";

const inv = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "11111111-1111-1111-1111-111111111111",
  invoice_number: "INV-0001",
  direction: "receivable",
  status: "sent",
  due_date: "2026-06-01",
  amount: 1000,
  tax_amount: 0,
  paid_amount: 0,
  ...over,
});

describe("overdue_invoice_days", () => {
  it("fires above the threshold and stays silent below it", () => {
    expect(evaluateOverdueInvoices([inv()], 30, TODAY)).toHaveLength(1);
    expect(evaluateOverdueInvoices([inv()], 90, TODAY)).toHaveLength(0);
  });

  it("marks critical beyond 2x the threshold", () => {
    const [a] = evaluateOverdueInvoices([inv()], 10, TODAY);
    expect(a.severity).toBe("critical");
    const [b] = evaluateOverdueInvoices([inv()], 40, TODAY);
    expect(b.severity).toBe("warning");
  });

  it("ignores payables and fully paid invoices", () => {
    expect(evaluateOverdueInvoices([inv({ direction: "payable" })], 5, TODAY)).toHaveLength(0);
    expect(evaluateOverdueInvoices([inv({ paid_amount: 1000 })], 5, TODAY)).toHaveLength(0);
  });
});

describe("ar_aging_threshold", () => {
  const rows = [inv(), inv({ id: "b", due_date: "2026-07-20" })];

  it("sums balances into the right bucket", () => {
    expect(bucketTotal(rows, "d90_plus", TODAY)).toBe(0);
    expect(bucketTotal(rows, "d31_60", TODAY)).toBe(1000);
    expect(bucketTotal(rows, "d1_30", TODAY)).toBe(1000);
  });

  it("fires once for the company at or above the amount", () => {
    const hit = evaluateArAging("c1", rows, "d31_60", 1000, TODAY);
    expect(hit).toHaveLength(1);
    expect(hit[0].entity_type).toBe("company");
    expect(evaluateArAging("c1", rows, "d31_60", 1001, TODAY)).toHaveLength(0);
  });
});

describe("unbilled_certified_value", () => {
  const row = { contract_id: "k1", contract_number: "CT-1", earned: 500_000, billed: 400_000 };

  it("fires when earned − billed reaches the amount", () => {
    expect(evaluateUnbilledCertified([row], 100_000)).toHaveLength(1);
    expect(evaluateUnbilledCertified([row], 100_001)).toHaveLength(0);
  });

  it("never fires when billing is ahead", () => {
    expect(
      evaluateUnbilledCertified([{ ...row, earned: 100, billed: 900 }], 1),
    ).toHaveLength(0);
  });
});

describe("payment_unmatched_days", () => {
  const pay = (over = {}) => ({
    id: "p1",
    payment_number: "PM-0001",
    record_status: "recorded",
    reconciliation_status: "unmatched",
    payment_date: "2026-07-01",
    ...over,
  });

  it("fires only above the age threshold", () => {
    expect(evaluateUnmatchedPayments([pay()], 20, TODAY)).toHaveLength(1);
    expect(evaluateUnmatchedPayments([pay()], 30, TODAY)).toHaveLength(0);
  });

  it("ignores voided and already matched payments", () => {
    expect(evaluateUnmatchedPayments([pay({ record_status: "voided" })], 1, TODAY)).toHaveLength(
      0,
    );
    expect(
      evaluateUnmatchedPayments([pay({ reconciliation_status: "matched" })], 1, TODAY),
    ).toHaveLength(0);
  });
});

describe("thresholds", () => {
  it("parses per rule type and rejects bad shapes", () => {
    expect(parseThreshold("overdue_invoice_days", { days: 30 })).toEqual({ days: 30 });
    expect(parseThreshold("ar_aging_threshold", { amount_base: 5, bucket: "d90_plus" })).toEqual({
      amount_base: 5,
      bucket: "d90_plus",
    });
    expect(() => parseThreshold("ar_aging_threshold", { amount_base: 5 })).toThrow();
    expect(() => parseThreshold("payment_unmatched_days", { days: -1 })).toThrow();
  });

  it("ships sensible defaults", () => {
    expect(defaultThreshold("unbilled_certified_value")).toEqual({ amount_base: 50000 });
  });

  it("maps severity to tones", () => {
    expect(severityTone("critical")).toBe("critical");
    expect(severityTone("warning")).toBe("attention");
    expect(severityTone("info")).toBe("active");
  });
});
