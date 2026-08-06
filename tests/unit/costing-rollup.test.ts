// GC-01 — deterministic roll-up fixtures for the Costing workspace.
import { describe, expect, it } from "vitest";

import {
  canTransitionAccrual,
  computeCostingRollup,
  costingBand,
  isBookedInvoice,
  isCommittedChangeOrder,
  isCommittedPo,
  isCommittedSubcontract,
  isRecordedPayment,
  monthKey,
  nextAccrualStatus,
  type CostingInput,
} from "@/lib/costing.rules";

const base: CostingInput = {
  budgets: [
    {
      original_amount: 800_000,
      approved_changes: 200_000,
      current_amount: 1_000_000,
      currency_code: "USD",
    },
  ],
  commitments: [
    {
      id: "po1",
      kind: "purchase_order",
      reference: "PO-1",
      counterparty: "V",
      status: "issued",
      amount: 400_000,
      currency_code: "USD",
    },
    {
      id: "po2",
      kind: "purchase_order",
      reference: "PO-2",
      counterparty: "V",
      status: "cancelled",
      amount: 250_000,
      currency_code: "USD",
    },
    {
      id: "po3",
      kind: "purchase_order",
      reference: "PO-3",
      counterparty: "V",
      status: "draft",
      amount: 90_000,
      currency_code: "USD",
    },
    {
      id: "sc1",
      kind: "subcontract",
      reference: "SC-1",
      counterparty: "S",
      status: "active",
      amount: 150_000,
      currency_code: "USD",
    },
    {
      id: "sc2",
      kind: "subcontract",
      reference: "SC-2",
      counterparty: "S",
      status: "terminated",
      amount: 70_000,
      currency_code: "USD",
    },
    {
      id: "co1",
      kind: "change_order",
      reference: "CO-1",
      counterparty: null,
      status: "approved",
      amount: 50_000,
      currency_code: "USD",
    },
    {
      id: "co2",
      kind: "change_order",
      reference: "CO-2",
      counterparty: null,
      status: "incorporated",
      amount: 200_000,
      currency_code: "USD",
    },
    {
      id: "co3",
      kind: "change_order",
      reference: "CO-3",
      counterparty: null,
      status: "rejected",
      amount: 30_000,
      currency_code: "USD",
    },
  ],
  invoices: [
    { id: "i1", direction: "payable", status: "paid", amount: 120_000, currency_code: "USD" },
    {
      id: "i2",
      direction: "payable",
      status: "partially_paid",
      amount: 80_000,
      currency_code: "USD",
    },
    { id: "i3", direction: "payable", status: "draft", amount: 500_000, currency_code: "USD" },
    { id: "i4", direction: "payable", status: "cancelled", amount: 400_000, currency_code: "USD" },
    { id: "i5", direction: "receivable", status: "paid", amount: 900_000, currency_code: "USD" },
  ],
  payments: [
    {
      id: "p1",
      direction: "payable",
      record_status: "recorded",
      amount: 120_000,
      currency_code: "USD",
    },
    {
      id: "p2",
      direction: "payable",
      record_status: "recorded",
      amount: 30_000,
      currency_code: "USD",
    },
    {
      id: "p3",
      direction: "payable",
      record_status: "voided",
      amount: 50_000,
      currency_code: "USD",
    },
    {
      id: "p4",
      direction: "receivable",
      record_status: "recorded",
      amount: 700_000,
      currency_code: "USD",
    },
  ],
  accruals: [
    { id: "a1", status: "approved", amount: 40_000, currency_code: "USD" },
    { id: "a2", status: "draft", amount: 25_000, currency_code: "USD" },
    { id: "a3", status: "reversed", amount: 15_000, currency_code: "USD" },
  ],
  forecasts: [],
};

describe("status predicates", () => {
  it("counts only post-approval, non-cancelled commitments", () => {
    expect(isCommittedPo("issued")).toBe(true);
    expect(isCommittedPo("cancelled")).toBe(false);
    expect(isCommittedPo("draft")).toBe(false);
    expect(isCommittedSubcontract("active")).toBe(true);
    expect(isCommittedSubcontract("terminated")).toBe(false);
    // incorporated COs live in budgets.approved_changes — excluded from committed
    expect(isCommittedChangeOrder("approved")).toBe(true);
    expect(isCommittedChangeOrder("incorporated")).toBe(false);
    expect(isCommittedChangeOrder("rejected")).toBe(false);
  });

  it("books only payable invoices and recorded payable payments", () => {
    expect(isBookedInvoice("payable", "approved")).toBe(true);
    expect(isBookedInvoice("payable", "draft")).toBe(false);
    expect(isBookedInvoice("receivable", "paid")).toBe(false);
    expect(isRecordedPayment("payable", "recorded")).toBe(true);
    expect(isRecordedPayment("payable", "voided")).toBe(false);
    expect(isRecordedPayment("receivable", "recorded")).toBe(false);
  });
});

describe("computeCostingRollup", () => {
  const [r] = computeCostingRollup(base);

  it("rolls up the budget baseline", () => {
    expect(r.original).toBe(800_000);
    expect(r.approved_changes).toBe(200_000);
    expect(r.current).toBe(1_000_000);
  });

  it("computes committed cost from approved commitments only", () => {
    expect(r.committed_po).toBe(400_000);
    expect(r.committed_subcontract).toBe(150_000);
    expect(r.committed_change_order).toBe(50_000);
    expect(r.committed).toBe(600_000);
  });

  it("computes actual, accruals, paid and outstanding", () => {
    expect(r.actual).toBe(200_000);
    expect(r.accruals).toBe(40_000);
    expect(r.paid).toBe(150_000);
    expect(r.outstanding).toBe(50_000);
  });

  it("derives ETC/EAC/VAC and available budget without double counting", () => {
    // no forecast rows -> residual ETC
    expect(r.has_forecast).toBe(false);
    expect(r.etc).toBe(760_000);
    expect(r.eac).toBe(1_000_000);
    expect(r.variance_at_completion).toBe(0);
    // available = current - max(committed, actual + accruals) = 1M - 600k
    expect(r.available).toBe(400_000);
  });

  it("prefers explicit forecast rows for ETC when present", () => {
    const [f] = computeCostingRollup({
      ...base,
      forecasts: [
        { id: "f1", etc_amount: 500_000, currency_code: "USD" },
        { id: "f2", etc_amount: 100_000, currency_code: "USD" },
      ],
    });
    expect(f.has_forecast).toBe(true);
    expect(f.etc).toBe(600_000);
    expect(f.eac).toBe(840_000);
    expect(f.variance_at_completion).toBe(160_000);
  });

  it("never double counts repeated rows", () => {
    const dupes = computeCostingRollup({
      ...base,
      commitments: [...base.commitments, ...base.commitments],
      invoices: [...base.invoices, ...base.invoices],
      payments: [...base.payments, ...base.payments],
      accruals: [...base.accruals, ...base.accruals],
    })[0];
    expect(dupes.committed).toBe(r.committed);
    expect(dupes.actual).toBe(r.actual);
    expect(dupes.paid).toBe(r.paid);
    expect(dupes.accruals).toBe(r.accruals);
  });

  it("splits roll-ups by currency", () => {
    const rows = computeCostingRollup({
      ...base,
      budgets: [
        ...base.budgets,
        {
          original_amount: 100_000,
          approved_changes: 0,
          current_amount: 100_000,
          currency_code: "EUR",
        },
      ],
    });
    expect(rows.map((x) => x.currency_code)).toEqual(["EUR", "USD"]);
    expect(rows.find((x) => x.currency_code === "EUR")?.committed).toBe(0);
  });

  it("returns an empty roll-up set with no data", () => {
    expect(
      computeCostingRollup({
        budgets: [],
        commitments: [],
        invoices: [],
        payments: [],
        accruals: [],
        forecasts: [],
      }),
    ).toEqual([]);
  });

  it("flags an over-run when EAC exceeds the current budget", () => {
    const over = computeCostingRollup({
      ...base,
      forecasts: [{ id: "f1", etc_amount: 900_000, currency_code: "USD" }],
    })[0];
    expect(over.variance_at_completion).toBe(-140_000);
    expect(costingBand(over.variance_at_completion, over.current)).toBe("destructive");
    expect(costingBand(0, over.current)).toBe("ok");
  });
});

describe("accrual lifecycle", () => {
  it("allows draft -> approved -> reversed only", () => {
    expect(canTransitionAccrual("draft", "approve")).toBe(true);
    expect(canTransitionAccrual("draft", "reverse")).toBe(false);
    expect(canTransitionAccrual("approved", "reverse")).toBe(true);
    expect(canTransitionAccrual("approved", "approve")).toBe(false);
    expect(canTransitionAccrual("reversed", "approve")).toBe(false);
    expect(canTransitionAccrual("reversed", "reverse")).toBe(false);
    expect(nextAccrualStatus("draft", "approve")).toBe("approved");
    expect(nextAccrualStatus("approved", "reverse")).toBe("reversed");
  });

  it("drops reversed accruals out of the roll-up", () => {
    const before = computeCostingRollup(base)[0].accruals;
    const after = computeCostingRollup({
      ...base,
      accruals: base.accruals.map((a) => (a.id === "a1" ? { ...a, status: "reversed" } : a)),
    })[0].accruals;
    expect(before).toBe(40_000);
    expect(after).toBe(0);
  });

  it("normalizes a date to its month key", () => {
    expect(monthKey("2026-08-19")).toBe("2026-08-01");
  });
});
