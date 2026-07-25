// P-075 — Budget rules unit tests.
import { describe, expect, it } from "vitest";

import {
  budgetUpsertSchema,
  buildPoSnapshotEntry,
  costCodeCreateSchema,
  flattenTree,
  formatMoney,
  groupCostCodesByParent,
  sumSnapshot,
  totalsByCurrency,
  variance,
  varianceBand,
} from "@/lib/budget.rules";

describe("costCodeCreateSchema", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    code: "01-1000",
    name: "Engineering",
  };
  it("accepts a dotted or dashed code", () => {
    expect(costCodeCreateSchema.safeParse(base).success).toBe(true);
    expect(
      costCodeCreateSchema.safeParse({ ...base, code: "1.2.3" }).success,
    ).toBe(true);
  });
  it("rejects malformed code", () => {
    expect(
      costCodeCreateSchema.safeParse({ ...base, code: "01 1000" }).success,
    ).toBe(false);
    expect(
      costCodeCreateSchema.safeParse({ ...base, code: "01--" }).success,
    ).toBe(false);
  });
  it("rejects empty name", () => {
    expect(
      costCodeCreateSchema.safeParse({ ...base, name: "   " }).success,
    ).toBe(false);
  });
});

describe("budgetUpsertSchema", () => {
  const base = {
    projectId: "00000000-0000-0000-0000-000000000001",
    cost_code_id: "00000000-0000-0000-0000-000000000002",
    original_amount: 100,
    currency_code: "USD",
  };
  it("accepts a positive amount", () => {
    expect(budgetUpsertSchema.safeParse(base).success).toBe(true);
  });
  it("rejects negative amounts", () => {
    expect(
      budgetUpsertSchema.safeParse({ ...base, original_amount: -1 }).success,
    ).toBe(false);
  });
  it("rejects short currency code", () => {
    expect(
      budgetUpsertSchema.safeParse({ ...base, currency_code: "US" }).success,
    ).toBe(false);
  });
});

describe("variance + band", () => {
  it("subtracts committed and actual from current", () => {
    expect(variance(1000, 400, 200)).toBe(400);
    expect(variance(500, 600, 0)).toBe(-100);
  });
  it("bands by ratio", () => {
    expect(varianceBand(400, 1000)).toBe("ok");
    expect(varianceBand(-10, 1000)).toBe("warning");
    expect(varianceBand(-100, 1000)).toBe("destructive");
    expect(varianceBand(-1, 0)).toBe("destructive");
    expect(varianceBand(0, 0)).toBe("ok");
  });
});

describe("po snapshot", () => {
  it("builds and sums entries", () => {
    const entries = [
      buildPoSnapshotEntry({
        id: "po1",
        po_number: "PO-0001",
        total_amount: "123.45",
        currency_code: "USD",
      }),
      buildPoSnapshotEntry({
        id: "po2",
        po_number: "PO-0002",
        vendor_name: "ACME",
        total_amount: 76.55,
        currency_code: "USD",
      }),
    ];
    expect(entries[0].amount).toBe(123.45);
    expect(entries[1].vendor).toBe("ACME");
    expect(sumSnapshot(entries)).toBe(200);
  });
});

describe("tree grouping", () => {
  const rows = [
    { id: "a", code: "01", name: "Eng", description: null, parent_id: null, wbs_item_id: null, is_active: true },
    { id: "b", code: "01-1", name: "Civil", description: null, parent_id: "a", wbs_item_id: null, is_active: true },
    { id: "c", code: "02", name: "Equip", description: null, parent_id: null, wbs_item_id: null, is_active: true },
    { id: "d", code: "01-2", name: "Elec", description: null, parent_id: "a", wbs_item_id: null, is_active: true },
  ];
  it("groups children under parents and sorts", () => {
    const tree = groupCostCodesByParent(rows);
    expect(tree.map((n) => n.code)).toEqual(["01", "02"]);
    expect(tree[0].children.map((c) => c.code)).toEqual(["01-1", "01-2"]);
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);
  });
  it("flattens in preorder", () => {
    const tree = groupCostCodesByParent(rows);
    expect(flattenTree(tree).map((n) => n.code)).toEqual([
      "01",
      "01-1",
      "01-2",
      "02",
    ]);
  });
});

describe("totalsByCurrency", () => {
  it("sums per currency and computes variance", () => {
    const totals = totalsByCurrency([
      {
        cost_code_id: "a",
        original_amount: 100,
        approved_changes: 0,
        current_amount: 100,
        committed_amount: 30,
        actual_amount: 20,
        currency_code: "USD",
      },
      {
        cost_code_id: "b",
        original_amount: 200,
        approved_changes: 0,
        current_amount: 200,
        committed_amount: 100,
        actual_amount: 0,
        currency_code: "USD",
      },
      {
        cost_code_id: "c",
        original_amount: 50,
        approved_changes: 0,
        current_amount: 50,
        committed_amount: 60,
        actual_amount: 0,
        currency_code: "EUR",
      },
    ]);
    const usd = totals.find((t) => t.currency_code === "USD")!;
    const eur = totals.find((t) => t.currency_code === "EUR")!;
    expect(usd.current).toBe(300);
    expect(usd.committed).toBe(130);
    expect(usd.variance).toBe(150);
    expect(eur.variance).toBe(-10);
  });
});

describe("formatMoney", () => {
  it("uses Intl currency formatting", () => {
    expect(formatMoney(1234.5, "USD")).toContain("1,234.5");
  });
});
