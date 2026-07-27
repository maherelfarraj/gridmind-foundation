// P-198 — Bank reconciliation math and guards.
import { describe, expect, it } from "vitest";

import {
  BULK_SOURCE_STATUSES,
  BulkReconcileSchema,
  ReconcilePaymentSchema,
  bulkReference,
  currentMonth,
  matchedPctStatus,
  monthLabel,
  monthRange,
  reconStatusLabel,
  reconStatusTone,
  summarize,
  type ReconPaymentLike,
} from "@/lib/reconciliation.rules";
import { assertCanReconcile, filterReconRows } from "@/lib/reconciliation.server";

const p = (
  reconciliation_status: ReconPaymentLike["reconciliation_status"],
  amount = 100,
  record_status: ReconPaymentLike["record_status"] = "recorded",
): ReconPaymentLike => ({ reconciliation_status, record_status, amount });

describe("month helpers", () => {
  it("maps a month to an inclusive date range", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2024-02").to).toBe("2024-02-29");
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("defaults to the current month and labels it", () => {
    expect(currentMonth(new Date("2026-07-27T10:00:00Z"))).toBe("2026-07");
    expect(monthLabel("2026-07")).toMatch(/2026/);
  });
});

describe("summarize (matched %)", () => {
  it("excludes excluded rows from the denominator and voided rows entirely", () => {
    const rows = [
      p("matched", 500),
      p("matched", 300),
      p("unmatched", 200),
      p("partial", 150),
      p("excluded", 90),
      p("unmatched", 9999, "voided"),
    ];
    const s = summarize(rows);
    expect(s.total).toBe(5);
    expect(s.excluded).toBe(1);
    expect(s.denominator).toBe(4);
    expect(s.matched_pct).toBeCloseTo(0.5, 10);
    expect(s.matched_amount).toBe(800);
    expect(s.unmatched_amount).toBe(200);
  });

  it("returns null (n/a) when everything is excluded or the month is empty", () => {
    expect(summarize([]).matched_pct).toBeNull();
    expect(summarize([p("excluded")]).matched_pct).toBeNull();
  });

  it("reaches 100% when every in-scope payment is matched", () => {
    const s = summarize([p("matched"), p("matched"), p("excluded")]);
    expect(s.matched_pct).toBe(1);
  });

  it("thresholds at 90%", () => {
    expect(matchedPctStatus(null)).toBe("neutral");
    expect(matchedPctStatus(0.899)).toBe("warning");
    expect(matchedPctStatus(0.9)).toBe("good");
    expect(matchedPctStatus(1)).toBe("good");
  });
});

describe("filters", () => {
  const rows = [
    { id: "1", reconciliation_status: "unmatched", direction: "receivable" },
    { id: "2", reconciliation_status: "matched", direction: "payable" },
    { id: "3", reconciliation_status: "partial", direction: "payable" },
    { id: "4", reconciliation_status: "excluded", direction: "receivable" },
  ] as never as Parameters<typeof filterReconRows>[0];

  it("defaults to unmatched only", () => {
    const out = filterReconRows(rows, { status: "unmatched", direction: "all" });
    expect(out.map((r) => r.id)).toEqual(["1"]);
  });

  it("supports every status chip and the direction filter", () => {
    expect(filterReconRows(rows, { status: "all", direction: "all" })).toHaveLength(4);
    expect(filterReconRows(rows, { status: "matched", direction: "all" })).toHaveLength(1);
    expect(filterReconRows(rows, { status: "excluded", direction: "all" })).toHaveLength(1);
    expect(filterReconRows(rows, { status: "all", direction: "payable" }).map((r) => r.id)).toEqual([
      "2",
      "3",
    ]);
  });
});

describe("schemas", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("requires a note when excluding (single and bulk)", () => {
    expect(ReconcilePaymentSchema.safeParse({ payment_id: id, status: "excluded" }).success).toBe(
      false,
    );
    expect(
      ReconcilePaymentSchema.safeParse({ payment_id: id, status: "excluded", note: "personal card" })
        .success,
    ).toBe(true);
    expect(
      BulkReconcileSchema.safeParse({ payment_ids: [id], status: "excluded" }).success,
    ).toBe(false);
    expect(
      BulkReconcileSchema.safeParse({ payment_ids: [id], status: "excluded", note: "n/a funds" })
        .success,
    ).toBe(true);
  });

  it("accepts matched without a note and rejects unmatched as a target", () => {
    expect(
      ReconcilePaymentSchema.safeParse({ payment_id: id, status: "matched", bank_reference: "S-1" })
        .success,
    ).toBe(true);
    expect(ReconcilePaymentSchema.safeParse({ payment_id: id, status: "unmatched" }).success).toBe(
      false,
    );
  });

  it("limits bulk transitions to unmatched/partial sources", () => {
    expect([...BULK_SOURCE_STATUSES]).toEqual(["unmatched", "partial"]);
  });
});

describe("bulk reference", () => {
  it("suffixes a shared prefix per row, or stays null", () => {
    expect(bulkReference("STMT-07", 0)).toBe("STMT-07-001");
    expect(bulkReference("STMT-07", 11)).toBe("STMT-07-012");
    expect(bulkReference("", 0)).toBeNull();
    expect(bulkReference(null, 3)).toBeNull();
  });
});

describe("role gate", () => {
  const full = { canAll: true, canPayableOnly: false, canWrite: true };
  const proc = { canAll: false, canPayableOnly: true, canWrite: true };
  const none = { canAll: false, canPayableOnly: false, canWrite: false };

  it("lets finance reconcile both directions", () => {
    expect(() => assertCanReconcile(full, "receivable")).not.toThrow();
    expect(() => assertCanReconcile(full, "payable")).not.toThrow();
  });

  it("limits procurement_admin to payable payments", () => {
    expect(() => assertCanReconcile(proc, "payable")).not.toThrow();
    expect(() => assertCanReconcile(proc, "receivable")).toThrow(/payable/i);
  });

  it("blocks users with no write role", () => {
    expect(() => assertCanReconcile(none, "payable")).toThrow(/permission/i);
  });
});

describe("labels", () => {
  it("maps status to label and shared badge tone", () => {
    expect(reconStatusLabel("unmatched")).toBe("Unmatched");
    expect(reconStatusTone("matched")).toBe("positive");
    expect(reconStatusTone("partial")).toBe("attention");
    expect(reconStatusTone("excluded")).toBe("inactive");
  });
});
