// P-195 — AR aging engine unit tests.
import { describe, expect, it } from "vitest";

import {
  balanceOf,
  bucketFor,
  daysPastDue,
  expectedCash,
  forecastByMonth,
  groupByClient,
  groupByProject,
  isAgingEligible,
  overdueOf,
  sumBuckets,
  toAgingRow,
  totalOf,
  type AgingInvoiceInput,
} from "@/lib/ar-aging.rules";
import { AGING_WEIGHTS } from "@/lib/finance/aging-weights";

const TODAY = "2026-07-27";

function inv(over: Partial<AgingInvoiceInput> = {}): AgingInvoiceInput {
  return {
    id: over.id ?? "i1",
    invoice_number: "INV-0001",
    status: "sent",
    direction: "receivable",
    due_date: TODAY,
    amount: 1000,
    tax_amount: 0,
    paid_amount: 0,
    currency_code: "USD",
    fx_rate_to_base: 1,
    project_id: "p1",
    project_name: "East Amman",
    client_name: "NEPCO",
    reminder_count: 0,
    ...over,
  };
}

describe("balance + eligibility", () => {
  it("balance = amount + tax − paid", () => {
    expect(balanceOf({ amount: 1000, tax_amount: 160, paid_amount: 400 })).toBe(760);
  });

  it("excludes payables, non-open statuses and zero balances", () => {
    expect(isAgingEligible({ ...inv(), direction: "payable" } as never)).toBe(false);
    expect(isAgingEligible({ ...inv({ status: "draft" }) } as never)).toBe(false);
    expect(isAgingEligible({ ...inv({ paid_amount: 1000 }) } as never)).toBe(false);
    expect(
      isAgingEligible({ ...inv({ status: "partially_paid", paid_amount: 400 }) } as never),
    ).toBe(true);
  });
});

describe("bucket boundaries", () => {
  it("ages exactly at 0/1/30/31/60/61/90/91", () => {
    expect(bucketFor(-5)).toBe("current");
    expect(bucketFor(0)).toBe("current");
    expect(bucketFor(1)).toBe("d1_30");
    expect(bucketFor(30)).toBe("d1_30");
    expect(bucketFor(31)).toBe("d31_60");
    expect(bucketFor(60)).toBe("d31_60");
    expect(bucketFor(61)).toBe("d61_90");
    expect(bucketFor(90)).toBe("d61_90");
    expect(bucketFor(91)).toBe("d90_plus");
  });

  it("days past due is today − due date", () => {
    expect(daysPastDue("2026-07-27", TODAY)).toBe(0);
    expect(daysPastDue("2026-06-27", TODAY)).toBe(30);
    expect(daysPastDue("2026-08-06", TODAY)).toBe(-10);
    expect(daysPastDue(null, TODAY)).toBe(0);
  });
});

describe("FX conversion", () => {
  it("converts with the rate and flags missing rates without defaulting to 1", () => {
    const converted = toAgingRow(inv({ currency_code: "JOD", fx_rate_to_base: 1.41 }), TODAY);
    expect(converted.base_balance).toBe(1410);
    expect(converted.fx_missing).toBe(false);

    const missing = toAgingRow(inv({ currency_code: "XOF", fx_rate_to_base: null }), TODAY);
    expect(missing.fx_missing).toBe(true);
    expect(missing.base_balance).toBe(1000);
  });
});

describe("grouping and expected cash", () => {
  const rows = [
    toAgingRow(inv({ id: "a", due_date: "2026-07-30" }), TODAY), // current 1000
    toAgingRow(inv({ id: "b", due_date: "2026-07-01", client_name: "NEPCO" }), TODAY), // 26d
    toAgingRow(
      inv({
        id: "c",
        due_date: "2026-01-01",
        client_name: "Other",
        project_id: "p2",
        project_name: "Zarqa",
      }),
      TODAY,
    ), // 90+
  ];

  it("groups by client and project", () => {
    const byClient = groupByClient(rows);
    expect(byClient.map((g) => g.label)).toEqual(["NEPCO", "Other"]);
    expect(byClient[0].total).toBe(2000);
    expect(
      groupByProject(rows)
        .map((g) => g.label)
        .sort(),
    ).toEqual(["East Amman", "Zarqa"]);
  });

  it("totals, overdue and probability-weighted expected cash", () => {
    const totals = sumBuckets(groupByClient(rows));
    expect(totalOf(totals)).toBe(3000);
    expect(overdueOf(totals)).toBe(2000);
    expect(expectedCash(totals)).toBeCloseTo(
      1000 * AGING_WEIGHTS.current + 1000 * AGING_WEIGHTS.d1_30 + 1000 * AGING_WEIGHTS.d90_plus,
      2,
    );
  });

  it("labels missing clients as Unlinked", () => {
    expect(groupByClient([toAgingRow(inv({ client_name: null }), TODAY)])[0].label).toBe(
      "Unlinked",
    );
  });
});

describe("forecast", () => {
  it("projects overdue into the current month and caps at the horizon", () => {
    const rows = [
      toAgingRow(inv({ id: "a", due_date: "2026-05-01" }), TODAY),
      toAgingRow(inv({ id: "b", due_date: "2026-09-15" }), TODAY),
      toAgingRow(inv({ id: "c", due_date: "2027-06-01" }), TODAY),
    ];
    const f = forecastByMonth(rows, TODAY);
    expect(f.map((m) => m.month)).toEqual(["2026-07", "2026-09"]);
    expect(f[0].expected).toBeCloseTo(1000 * AGING_WEIGHTS.d61_90, 2);
    expect(f[1].expected).toBeCloseTo(1000 * AGING_WEIGHTS.current, 2);
  });
});
