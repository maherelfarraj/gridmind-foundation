// P-200 — Unit tests for period-close rules and the 409 enforcement error.
import { describe, expect, it } from "vitest";

import {
  isPeriodClosedError,
  periodClosedError,
  periodKey,
  periodMonth,
} from "@/lib/finance/periods";
import {
  buildChecklist,
  canClose,
  comparisonLines,
  emptyTotals,
  monthEnd,
  monthLabel,
  monthStart,
  periodStatusTone,
  recentMonths,
  shiftMonth,
  type ChecklistFacts,
} from "@/lib/periods.rules";

const facts = (over: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  blocked_matches: 0,
  unmatched_payments: 0,
  open_alerts: 0,
  unbilled_contracts: 0,
  unbilled_reviewed: false,
  ...over,
});

describe("month math", () => {
  it("normalises any date to the first of its month", () => {
    expect(periodMonth("2026-03-17")).toBe("2026-03-01");
    expect(monthStart("2026-03-17")).toBe("2026-03-01");
    expect(periodKey("2026-03-17")).toBe("2026-03");
  });

  it("computes month end including leap years", () => {
    expect(monthEnd("2026-03-01")).toBe("2026-03-31");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2024-02-01")).toBe("2024-02-29");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonth("2025-12-01", 2)).toBe("2026-02-01");
  });

  it("lists recent months newest first", () => {
    expect(recentMonths("2026-03-17", 3)).toEqual(["2026-03-01", "2026-02-01", "2026-01-01"]);
  });

  it("labels months for humans", () => {
    expect(monthLabel("2026-03-01")).toBe("March 2026");
  });
});

describe("close checklist", () => {
  it("passes when nothing is outstanding", () => {
    const items = buildChecklist(facts());
    expect(items).toHaveLength(4);
    expect(canClose(items)).toBe(true);
  });

  it("blocks on unresolved matches, payments and alerts", () => {
    const items = buildChecklist(
      facts({ blocked_matches: 2, unmatched_payments: 1, open_alerts: 3 }),
    );
    expect(canClose(items)).toBe(false);
    expect(items.filter((i) => !i.pass).map((i) => i.key)).toEqual([
      "payables_matched",
      "unmatched_resolved",
      "alerts_acknowledged",
    ]);
    expect(items[0].detail).toBe("2 blocked matches outstanding");
  });

  it("requires a manual review acknowledgement when WIP contracts exist", () => {
    const blocked = buildChecklist(facts({ unbilled_contracts: 4 }));
    expect(blocked.find((i) => i.key === "unbilled_reviewed")!.pass).toBe(false);
    const cleared = buildChecklist(facts({ unbilled_contracts: 4, unbilled_reviewed: true }));
    expect(cleared.find((i) => i.key === "unbilled_reviewed")!.pass).toBe(true);
    expect(canClose(cleared)).toBe(true);
  });

  it("skips the manual item entirely when no contract is over threshold", () => {
    const items = buildChecklist(facts({ unbilled_contracts: 0 }));
    expect(items.find((i) => i.key === "unbilled_reviewed")!.pass).toBe(true);
  });

  it("gives each item a label, hint and deep link", () => {
    for (const item of buildChecklist(facts())) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.hint.length).toBeGreaterThan(0);
      expect(item.link.startsWith("/")).toBe(true);
    }
  });
});

describe("period closed error", () => {
  it("is a typed 409 that enforcement code can detect", () => {
    const err = periodClosedError("2026-02-14");
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe("finance_period_closed");
    expect(isPeriodClosedError(err)).toBe(true);
    expect(err.message).toContain("2026-02");
  });

  it("does not misclassify unrelated errors", () => {
    expect(isPeriodClosedError(new Error("network down"))).toBe(false);
    expect(isPeriodClosedError(null)).toBe(false);
  });
});

describe("comparison report", () => {
  it("computes deltas against the prior month", () => {
    const current = { ...emptyTotals("2026-03-01"), revenue: 1000, collected: 400, wip: 250 };
    const prior = { ...emptyTotals("2026-02-01"), revenue: 600, collected: 500, wip: 100 };
    current.aging.d31_60 = 300;
    prior.aging.d31_60 = 120;

    const lines = comparisonLines(current, prior);
    const byMetric = Object.fromEntries(lines.map((l) => [l.metric, l]));
    expect(byMetric["Revenue (issued receivables)"].delta).toBe(400);
    expect(byMetric["Collected (payments recorded)"].delta).toBe(-100);
    expect(byMetric["WIP (earned − billed)"].delta).toBe(150);
    expect(lines.find((l) => l.metric.includes("31-60"))!.delta).toBe(180);
  });

  it("treats a missing prior month as zeros", () => {
    const current = { ...emptyTotals("2026-01-01"), revenue: 900 };
    const lines = comparisonLines(current, null);
    expect(lines[0]).toMatchObject({ current: 900, prior: 0, delta: 900 });
  });
});

describe("status tone", () => {
  it("maps period status to badge tone", () => {
    expect(periodStatusTone("closed")).toBe("positive");
    expect(periodStatusTone("closing")).toBe("attention");
    expect(periodStatusTone("open")).toBe("active");
  });
});
