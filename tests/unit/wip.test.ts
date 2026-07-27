// P-197 — WIP revenue recognition math.
import { describe, expect, it } from "vitest";

import { UNDER_BILLED_THRESHOLD_PCT } from "@/lib/finance/wip-thresholds";
import {
  billingFlag,
  computeWipRows,
  exceedsThreshold,
  isBilledInvoice,
  isCollectedPayment,
  isEarnedPayApp,
  onOrBefore,
  rollupWip,
  type WipContractInput,
  type WipInvoiceInput,
  type WipPayAppInput,
  type WipPaymentInput,
} from "@/lib/wip.rules";

const AS_OF = "2026-06-30";

const contracts: WipContractInput[] = [
  {
    id: "c1",
    contract_number: "CT-001",
    counterparty: "Utility A",
    status: "active",
    value: 1_000_000,
    currency_code: "USD",
    project_id: "p1",
  },
  {
    id: "c2",
    contract_number: "CT-002",
    counterparty: "Utility B",
    status: "signed",
    value: 500_000,
    currency_code: "USD",
    project_id: "p1",
  },
  {
    id: "c3",
    contract_number: "CT-003",
    counterparty: "Draft Co",
    status: "draft",
    value: 900_000,
    currency_code: "USD",
    project_id: "p1",
  },
];

const payApps: WipPayAppInput[] = [
  // c1 earned 400k (300k certified + 100k invoiced), retention 20k
  {
    contract_id: "c1",
    status: "certified",
    period_end: "2026-05-31",
    total_certified: 300_000,
    retention_amount: 15_000,
  },
  {
    contract_id: "c1",
    status: "invoiced",
    period_end: "2026-06-30",
    total_certified: 100_000,
    retention_amount: 5_000,
  },
  // excluded: draft, rejected, future period
  {
    contract_id: "c1",
    status: "draft",
    period_end: "2026-06-30",
    total_certified: 999_999,
    retention_amount: 1,
  },
  {
    contract_id: "c1",
    status: "rejected",
    period_end: "2026-06-30",
    total_certified: 888_888,
    retention_amount: 1,
  },
  {
    contract_id: "c1",
    status: "approved",
    period_end: "2026-07-31",
    total_certified: 777_777,
    retention_amount: 1,
  },
  // c2 earned 100k
  {
    contract_id: "c2",
    status: "approved",
    period_end: "2026-04-30",
    total_certified: 100_000,
    retention_amount: 10_000,
  },
];

const invoices: WipInvoiceInput[] = [
  // c1 billed 250k
  {
    id: "i1",
    contract_id: "c1",
    direction: "receivable",
    status: "paid",
    issue_date: "2026-05-05",
    amount: 150_000,
  },
  {
    id: "i2",
    contract_id: "c1",
    direction: "receivable",
    status: "partially_paid",
    issue_date: "2026-06-10",
    amount: 100_000,
  },
  // excluded: draft, cancelled, payable, future issue date
  {
    id: "i3",
    contract_id: "c1",
    direction: "receivable",
    status: "draft",
    issue_date: "2026-06-10",
    amount: 500_000,
  },
  {
    id: "i4",
    contract_id: "c1",
    direction: "receivable",
    status: "cancelled",
    issue_date: "2026-06-10",
    amount: 400_000,
  },
  {
    id: "i5",
    contract_id: "c1",
    direction: "payable",
    status: "approved",
    issue_date: "2026-06-10",
    amount: 300_000,
  },
  {
    id: "i6",
    contract_id: "c1",
    direction: "receivable",
    status: "approved",
    issue_date: "2026-07-01",
    amount: 200_000,
  },
  // c2 over-billed: 180k billed against 100k earned
  {
    id: "i7",
    contract_id: "c2",
    direction: "receivable",
    status: "sent",
    issue_date: "2026-06-01",
    amount: 180_000,
  },
];

const payments: WipPaymentInput[] = [
  { invoice_id: "i1", record_status: "recorded", payment_date: "2026-05-20", amount: 150_000 },
  { invoice_id: "i2", record_status: "recorded", payment_date: "2026-06-20", amount: 40_000 },
  // excluded: voided, future, and payment against an excluded invoice
  { invoice_id: "i2", record_status: "voided", payment_date: "2026-06-21", amount: 60_000 },
  { invoice_id: "i2", record_status: "recorded", payment_date: "2026-07-02", amount: 25_000 },
  { invoice_id: "i3", record_status: "recorded", payment_date: "2026-06-15", amount: 500_000 },
];

describe("date and status predicates", () => {
  it("treats the as-of date as inclusive and missing dates as excluded", () => {
    expect(onOrBefore("2026-06-30", AS_OF)).toBe(true);
    expect(onOrBefore("2026-07-01", AS_OF)).toBe(false);
    expect(onOrBefore(null, AS_OF)).toBe(false);
  });

  it("excludes draft and rejected pay apps", () => {
    expect(
      isEarnedPayApp(
        {
          contract_id: "c1",
          status: "draft",
          period_end: AS_OF,
          total_certified: 1,
          retention_amount: 0,
        },
        AS_OF,
      ),
    ).toBe(false);
    expect(
      isEarnedPayApp(
        {
          contract_id: "c1",
          status: "certified",
          period_end: AS_OF,
          total_certified: 1,
          retention_amount: 0,
        },
        AS_OF,
      ),
    ).toBe(true);
  });

  it("excludes draft/cancelled and payable invoices, and voided payments", () => {
    expect(isBilledInvoice(invoices[2], AS_OF)).toBe(false);
    expect(isBilledInvoice(invoices[3], AS_OF)).toBe(false);
    expect(isBilledInvoice(invoices[4], AS_OF)).toBe(false);
    expect(isCollectedPayment(payments[2], AS_OF)).toBe(false);
  });
});

describe("computeWipRows", () => {
  const rows = computeWipRows(contracts, payApps, invoices, payments, AS_OF);

  it("only includes signed/active contracts", () => {
    expect(rows.map((r) => r.contract_number)).toEqual(["CT-001", "CT-002"]);
  });

  it("matches hand-computed fixtures for c1 (under-billed)", () => {
    const c1 = rows[0];
    expect(c1.earned).toBe(400_000);
    expect(c1.billed).toBe(250_000);
    expect(c1.collected).toBe(190_000);
    expect(c1.wip).toBe(150_000);
    expect(c1.retention_withheld).toBe(20_000);
    expect(c1.percent_complete).toBeCloseTo(0.4, 10);
    expect(c1.flag).toBe("under_billed");
    // 150k / 1M = 15% > 10% threshold
    expect(c1.over_threshold).toBe(true);
  });

  it("handles the negative-WIP (over-billed) case", () => {
    const c2 = rows[1];
    expect(c2.earned).toBe(100_000);
    expect(c2.billed).toBe(180_000);
    expect(c2.collected).toBe(0);
    expect(c2.wip).toBe(-80_000);
    expect(c2.flag).toBe("over_billed");
    expect(c2.over_threshold).toBe(true);
  });

  it("filters all three measures by the as-of date", () => {
    const early = computeWipRows(contracts, payApps, invoices, payments, "2026-05-31");
    const c1 = early[0];
    expect(c1.earned).toBe(300_000);
    expect(c1.billed).toBe(150_000);
    expect(c1.collected).toBe(150_000);
    expect(c1.wip).toBe(150_000);
  });
});

describe("thresholds and rollup", () => {
  it("flags direction from the sign of WIP", () => {
    expect(billingFlag(1)).toBe("under_billed");
    expect(billingFlag(-1)).toBe("over_billed");
    expect(billingFlag(0)).toBe("balanced");
  });

  it("uses the company threshold constant and never divides by zero", () => {
    expect(exceedsThreshold(100, 1_000)).toBe(false); // exactly 10% is not "over"
    expect(exceedsThreshold(101, 1_000)).toBe(true);
    expect(exceedsThreshold(-101, 1_000)).toBe(true);
    expect(exceedsThreshold(500, 0)).toBe(false);
    expect(UNDER_BILLED_THRESHOLD_PCT).toBe(0.1);
  });

  it("rollup equals the sum of the per-contract rows", () => {
    const rows = computeWipRows(contracts, payApps, invoices, payments, AS_OF);
    const r = rollupWip(rows);
    expect(r.contracts).toBe(2);
    expect(r.earned).toBe(rows.reduce((a, x) => a + x.earned, 0));
    expect(r.billed).toBe(rows.reduce((a, x) => a + x.billed, 0));
    expect(r.collected).toBe(rows.reduce((a, x) => a + x.collected, 0));
    expect(r.wip).toBe(r.earned - r.billed);
    expect(r.under_billed).toBe(150_000);
    expect(r.over_billed).toBe(80_000);
    expect(r.retention_withheld).toBe(30_000);
    expect(r.contract_value).toBe(1_500_000);
  });

  it("returns a zeroed rollup with no contracts", () => {
    const r = rollupWip([]);
    expect(r).toMatchObject({ earned: 0, billed: 0, collected: 0, wip: 0, contracts: 0 });
  });
});
