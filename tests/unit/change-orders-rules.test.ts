// P-081 — Change order rules tests
import { describe, expect, it } from "vitest";
import {
  canTransition,
  exposureBucket,
  exposurePct,
  isBudgetImpactBalanced,
  nextChangeOrderNumber,
  shiftUnstartedTasks,
  sumBudgetImpact,
} from "@/lib/change-orders.rules";

describe("nextChangeOrderNumber", () => {
  it("rolls over year", () => {
    const jan = new Date("2027-01-05T00:00:00Z");
    expect(nextChangeOrderNumber(["CO-2026-0009"], jan)).toBe("CO-2027-0001");
  });
  it("increments same-year max", () => {
    const d = new Date("2026-06-01T00:00:00Z");
    expect(nextChangeOrderNumber(["CO-2026-0001", "CO-2026-0003"], d)).toBe(
      "CO-2026-0004",
    );
  });
});

describe("sumBudgetImpact / isBudgetImpactBalanced", () => {
  it("balances within tolerance", () => {
    const lines = [
      { cost_code_id: "a", amount: 250_000 },
      { cost_code_id: "b", amount: 200_000 },
    ];
    expect(sumBudgetImpact(lines)).toBeCloseTo(450_000);
    expect(isBudgetImpactBalanced(lines, 450_000)).toBe(true);
    expect(isBudgetImpactBalanced(lines, 450_001)).toBe(false);
  });
  it("respects cent tolerance", () => {
    const lines = [{ cost_code_id: "a", amount: 100.001 }];
    expect(isBudgetImpactBalanced(lines, 100.0)).toBe(true);
  });
});

describe("canTransition", () => {
  it("allows draft → submitted", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
  });
  it("blocks approved → draft", () => {
    expect(canTransition("approved", "draft")).toBe(false);
  });
  it("blocks incorporated from any move", () => {
    expect(canTransition("incorporated", "approved")).toBe(false);
  });
  it("allows approved → incorporated", () => {
    expect(canTransition("approved", "incorporated")).toBe(true);
  });
  it("allows submitted → rejected/approved", () => {
    expect(canTransition("submitted", "rejected")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
  });
});

describe("exposurePct / exposureBucket", () => {
  it("ok when ≤ 5%", () => {
    expect(exposureBucket(exposurePct(5, 100))).toBe("ok");
  });
  it("warn when > 5%", () => {
    expect(exposureBucket(exposurePct(6, 100))).toBe("warn");
  });
  it("danger when > 10%", () => {
    expect(exposureBucket(exposurePct(11, 100))).toBe("danger");
  });
  it("returns 0 for zero contract", () => {
    expect(exposurePct(10, 0)).toBe(0);
  });
});

describe("shiftUnstartedTasks", () => {
  const tasks = [
    { id: "1", name: "A", status: "not_started", start_date: "2026-01-01", end_date: "2026-01-10" },
    { id: "2", name: "B", status: "in_progress", start_date: "2026-01-05", end_date: "2026-01-15" },
    { id: "3", name: "C", status: "complete", start_date: "2025-12-01", end_date: "2025-12-05" },
  ];
  it("shifts only not_started by N days preserving duration", () => {
    const r = shiftUnstartedTasks(tasks, 21);
    expect(r.shifted).toHaveLength(1);
    expect(r.skipped).toHaveLength(2);
    expect(r.shifted[0].new_start_date).toBe("2026-01-22");
    expect(r.shifted[0].new_end_date).toBe("2026-01-31");
  });
  it("no-op when days is 0", () => {
    const r = shiftUnstartedTasks(tasks, 0);
    expect(r.shifted).toHaveLength(0);
    expect(r.skipped).toHaveLength(3);
  });
});
