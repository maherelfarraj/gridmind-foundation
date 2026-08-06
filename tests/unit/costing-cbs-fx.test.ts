// GC-02 — CBS hierarchy aggregation + multi-currency FX policy tests.
import { describe, expect, it } from "vitest";

import {
  buildCbsTree,
  descendantIds,
  UNASSIGNED_ID,
  type CbsFacts,
  type CbsRow,
} from "@/lib/costing.cbs";
import {
  canApproveWithFx,
  convertMoney,
  moneyEquals,
  resolveFx,
  reverseSnapshot,
  roundMoney,
  sumMoney,
  toMinor,
} from "@/lib/costing.fx";

const codes = [
  { id: "root", code: "01", name: "Plant", parent_id: null },
  { id: "pv", code: "01.1", name: "PV", parent_id: "root" },
  { id: "bess", code: "01.2", name: "BESS", parent_id: "root" },
  { id: "civil", code: "02", name: "Civil", parent_id: null },
];

function facts(over: Partial<CbsFacts> = {}): CbsFacts {
  return {
    costCodes: codes,
    budgets: [],
    commitments: [],
    invoices: [],
    payments: [],
    accruals: [],
    forecasts: [],
    ...over,
  };
}

const byId = (rows: CbsRow[], id: string) => rows.find((r) => r.id === id)!;

describe("CBS hierarchy aggregation", () => {
  it("rolls descendants into parents deterministically", () => {
    const { rows, total } = buildCbsTree(
      facts({
        budgets: [
          { cost_code_id: "pv", original: 1000, approved_changes: 100, current: 1100 },
          { cost_code_id: "bess", original: 500, approved_changes: 0, current: 500 },
          { cost_code_id: "civil", original: 250, approved_changes: 0, current: 250 },
        ],
      }),
    );
    expect(byId(rows, "root").current).toBe(1600);
    expect(byId(rows, "pv").current).toBe(1100);
    expect(total.current).toBe(1850);
    expect(total.original).toBe(1750);
  });

  it("reconciles project totals through an explicit Unassigned bucket", () => {
    const { rows, total } = buildCbsTree(
      facts({
        budgets: [
          { cost_code_id: "pv", original: 100, approved_changes: 0, current: 100 },
          { cost_code_id: null, original: 40, approved_changes: 0, current: 40 },
        ],
      }),
    );
    const unassigned = byId(rows, UNASSIGNED_ID);
    expect(unassigned.is_unassigned).toBe(true);
    expect(unassigned.current).toBe(40);
    const roots = rows.filter((r) => r.parent_id === null);
    expect(sumMoney(roots.map((r) => r.current))).toBe(total.current);
  });

  it("never double-counts a repeated document id", () => {
    const commitment = {
      id: "po-1",
      cost_code_id: "pv",
      kind: "purchase_order" as const,
      status: "approved",
      amount_base: 900,
    };
    const { total } = buildCbsTree(facts({ commitments: [commitment, { ...commitment }] }));
    expect(total.committed).toBe(900);
  });

  it("excludes non-committed statuses from committed cost", () => {
    const { total } = buildCbsTree(
      facts({
        commitments: [
          {
            id: "po-1",
            cost_code_id: "pv",
            kind: "purchase_order",
            status: "approved",
            amount_base: 100,
          },
          {
            id: "po-2",
            cost_code_id: "pv",
            kind: "purchase_order",
            status: "cancelled",
            amount_base: 500,
          },
          {
            id: "po-3",
            cost_code_id: "pv",
            kind: "purchase_order",
            status: "draft",
            amount_base: 700,
          },
        ],
      }),
    );
    expect(total.committed).toBe(100);
  });

  it("uses forecast ETC where present and residual ETC otherwise", () => {
    const { rows } = buildCbsTree(
      facts({
        budgets: [
          { cost_code_id: "pv", original: 1000, approved_changes: 0, current: 1000 },
          { cost_code_id: "civil", original: 200, approved_changes: 0, current: 200 },
        ],
        forecasts: [{ id: "f1", cost_code_id: "pv", etc_amount_base: 300 }],
      }),
    );
    expect(byId(rows, "pv").etc).toBe(300);
    expect(byId(rows, "civil").etc).toBe(200);
  });

  it("lists descendants of a node including itself", () => {
    const { rows } = buildCbsTree(facts());
    expect(descendantIds(rows, "root").sort()).toEqual(["bess", "pv", "root"]);
  });
});

describe("FX policy", () => {
  const base = "USD";

  it("resolves same-currency rows at parity", () => {
    const fx = resolveFx({ txnCurrency: "USD", baseCurrency: base, onDate: "2026-01-10" });
    expect(fx.rate).toBe(1);
    expect(fx.source).toBe("parity");
    expect(canApproveWithFx(fx)).toBe(true);
  });

  it("flags stale rates but still allows draft use", () => {
    const fx = resolveFx({
      txnCurrency: "EUR",
      baseCurrency: base,
      onDate: "2026-03-01",
      tableRate: { rate: 1.08, as_of: "2025-12-01" },
    });
    expect(fx.stale).toBe(true);
    expect(fx.rate).toBe(1.08);
  });

  it("blocks approval when no rate exists", () => {
    const fx = resolveFx({ txnCurrency: "JOD", baseCurrency: base, onDate: "2026-01-10" });
    expect(fx.missing).toBe(true);
    expect(canApproveWithFx(fx)).toBe(false);
  });

  it("prefers a manual override and records its reason", () => {
    const fx = resolveFx({
      txnCurrency: "JOD",
      baseCurrency: base,
      onDate: "2026-01-10",
      tableRate: { rate: 1.41, as_of: "2026-01-09" },
      override: { rate: 1.4, reason: "Contractual fixed rate" },
    });
    expect(fx.rate).toBe(1.4);
    expect(fx.source).toBe("manual");
    expect(fx.override_reason).toBe("Contractual fixed rate");
  });

  it("rounds conversions once, half-up away from zero", () => {
    expect(convertMoney(100.005, 1)).toBe(100.01);
    expect(convertMoney(-100.005, 1)).toBe(-100.01);
    expect(convertMoney(333.335, 1.5)).toBe(500);
    expect(roundMoney(1.005)).toBe(1.01);
    expect(toMinor(1.005)).toBe(101);
  });

  it("compares money in minor units, not binary floats", () => {
    expect(0.1 + 0.2 === 0.3).toBe(false);
    expect(moneyEquals(0.1 + 0.2, 0.3)).toBe(true);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
  });

  it("reverses using the locked rate without re-rating", () => {
    const reversed = reverseSnapshot({
      amount: 1000,
      amount_base: 1410,
      fx_rate: 1.41,
      fx_rate_date: "2026-01-09",
      fx_source: "table",
    });
    expect(reversed.amount).toBe(-1000);
    expect(reversed.amount_base).toBe(-1410);
    expect(reversed.fx_rate).toBe(1.41);
    expect(reversed.fx_rate_date).toBe("2026-01-09");
  });

  it("nets an approved row and its reversal to zero in project currency", () => {
    const approved = { amount: 1000, amount_base: convertMoney(1000, 1.41) };
    const reversed = reverseSnapshot({
      ...approved,
      fx_rate: 1.41,
      fx_rate_date: "2026-01-09",
      fx_source: "table",
    });
    expect(sumMoney([approved.amount_base, reversed.amount_base])).toBe(0);
  });

  it("mixes currencies into one project-currency roll-up exactly once", () => {
    const eur = convertMoney(1000, 1.1); // 1100 USD
    const jod = convertMoney(500, 1.41); // 705 USD
    const { total } = buildCbsTree(
      facts({
        accruals: [
          { id: "a-eur", cost_code_id: "pv", status: "approved", amount_base: eur },
          { id: "a-jod", cost_code_id: "bess", status: "approved", amount_base: jod },
          { id: "a-draft", cost_code_id: "pv", status: "draft", amount_base: 999 },
          { id: "a-rev", cost_code_id: "pv", status: "reversed", amount_base: -eur },
        ],
      }),
    );
    expect(total.accruals).toBe(1805);
  });
});
