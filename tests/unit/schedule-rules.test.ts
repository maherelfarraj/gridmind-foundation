// P-073 — Unit tests for schedule rules.
import { describe, expect, it } from "vitest";

import {
  avgFinishVariance,
  bandForFinishVariance,
  barColorForStatus,
  buildSnapshotEntries,
  computeVariance,
  daysBetween,
  isOverdue,
  weightedProgress,
  wouldCreateCycle,
  type ScheduleTaskLite,
} from "@/lib/schedule.rules";

function task(id: string, preds: string[] = []): {
  id: string;
  predecessor_ids: string[];
} {
  return { id, predecessor_ids: preds };
}

describe("barColorForStatus", () => {
  it("returns destructive for overdue in_progress", () => {
    expect(barColorForStatus("in_progress", true)).toBe("bg-destructive");
  });
  it("returns primary for in_progress on time", () => {
    expect(barColorForStatus("in_progress", false)).toBe("bg-primary");
  });
  it("returns muted-foreground for completed", () => {
    expect(barColorForStatus("completed", false)).toBe("bg-muted-foreground");
  });
  it("returns secondary for not_started", () => {
    expect(barColorForStatus("not_started", false)).toBe("bg-secondary");
  });
  it("returns warning for on_hold", () => {
    expect(barColorForStatus("on_hold", false)).toBe("bg-warning");
  });
});

describe("isOverdue", () => {
  const today = new Date("2026-07-24");
  it("flags in_progress past end + < 100%", () => {
    expect(
      isOverdue(
        { end_date: "2026-07-01", progress_pct: 50, status: "in_progress" },
        today,
      ),
    ).toBe(true);
  });
  it("does not flag completed", () => {
    expect(
      isOverdue(
        { end_date: "2026-07-01", progress_pct: 100, status: "completed" },
        today,
      ),
    ).toBe(false);
  });
  it("does not flag if progress 100", () => {
    expect(
      isOverdue(
        { end_date: "2026-07-01", progress_pct: 100, status: "in_progress" },
        today,
      ),
    ).toBe(false);
  });
  it("does not flag if end in future", () => {
    expect(
      isOverdue(
        { end_date: "2026-08-01", progress_pct: 20, status: "in_progress" },
        today,
      ),
    ).toBe(false);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects self-reference", () => {
    expect(wouldCreateCycle("A", ["A"], [task("A")])).toBe(true);
  });
  it("detects A→B→A", () => {
    // B currently depends on A. If we set A.preds = [B], cycle.
    const all = [task("A"), task("B", ["A"])];
    expect(wouldCreateCycle("A", ["B"], all)).toBe(true);
  });
  it("detects long chain A→B→C→A", () => {
    const all = [task("A"), task("B", ["A"]), task("C", ["B"])];
    expect(wouldCreateCycle("A", ["C"], all)).toBe(true);
  });
  it("allows non-cyclic dependencies", () => {
    const all = [task("A"), task("B"), task("C")];
    expect(wouldCreateCycle("C", ["A", "B"], all)).toBe(false);
  });
  it("allows removing predecessors", () => {
    const all = [task("A", ["B"]), task("B")];
    expect(wouldCreateCycle("A", [], all)).toBe(false);
  });
});

describe("computeVariance", () => {
  it("returns null variance when no baseline", () => {
    const v = computeVariance(
      { start_date: "2026-01-01", end_date: "2026-01-10" },
      undefined,
    );
    expect(v).toEqual({ start_var_days: null, finish_var_days: null });
  });
  it("computes positive variance (late)", () => {
    const v = computeVariance(
      { start_date: "2026-01-05", end_date: "2026-01-20" },
      {
        task_id: "t1",
        code: null,
        name: "x",
        start_date: "2026-01-01",
        end_date: "2026-01-10",
        progress_pct: 0,
      },
    );
    expect(v.start_var_days).toBe(4);
    expect(v.finish_var_days).toBe(10);
  });
  it("computes negative variance (early)", () => {
    const v = computeVariance(
      { start_date: "2026-01-01", end_date: "2026-01-05" },
      {
        task_id: "t1",
        code: null,
        name: "x",
        start_date: "2026-01-01",
        end_date: "2026-01-10",
        progress_pct: 0,
      },
    );
    expect(v.finish_var_days).toBe(-5);
  });
});

describe("weightedProgress", () => {
  it("weights by task duration", () => {
    const tasks = [
      { start_date: "2026-01-01", end_date: "2026-01-10", progress_pct: 50 },
      { start_date: "2026-01-01", end_date: "2026-01-05", progress_pct: 100 },
    ];
    const p = weightedProgress(tasks);
    // durations 10 and 5 (inclusive), weighted avg = (10*50 + 5*100) / 15 = 66.6...
    expect(p).toBeGreaterThan(66);
    expect(p).toBeLessThan(67);
  });
  it("returns 0 for empty list", () => {
    expect(weightedProgress([])).toBe(0);
  });
});

describe("avgFinishVariance + band", () => {
  const snap = [
    {
      task_id: "t1",
      code: null,
      name: "a",
      start_date: "2026-01-01",
      end_date: "2026-01-10",
      progress_pct: 0,
    },
    {
      task_id: "t2",
      code: null,
      name: "b",
      start_date: "2026-01-01",
      end_date: "2026-01-05",
      progress_pct: 0,
    },
  ];
  it("returns null when no snapshot", () => {
    expect(avgFinishVariance([{ id: "t1", end_date: "2026-01-11" }], null)).toBe(
      null,
    );
  });
  it("averages variances", () => {
    const v = avgFinishVariance(
      [
        { id: "t1", end_date: "2026-01-20" }, // +10
        { id: "t2", end_date: "2026-01-05" }, // 0
      ],
      snap,
    );
    expect(v).toBe(5);
  });
  it("bands correctly", () => {
    expect(bandForFinishVariance(null)).toBe("ok");
    expect(bandForFinishVariance(0)).toBe("ok");
    expect(bandForFinishVariance(5)).toBe("warning");
    expect(bandForFinishVariance(20)).toBe("destructive");
  });
});

describe("buildSnapshotEntries + daysBetween", () => {
  it("captures required fields", () => {
    const entries = buildSnapshotEntries([
      {
        id: "t1",
        name: "task",
        start_date: "2026-01-01",
        end_date: "2026-01-05",
        progress_pct: 20,
        code: "1.1",
      },
    ]);
    expect(entries).toEqual([
      {
        task_id: "t1",
        code: "1.1",
        name: "task",
        start_date: "2026-01-01",
        end_date: "2026-01-05",
        progress_pct: 20,
      },
    ]);
  });
  it("daysBetween is inclusive of direction", () => {
    expect(daysBetween("2026-01-01", "2026-01-10")).toBe(9);
    expect(daysBetween("2026-01-10", "2026-01-01")).toBe(-9);
  });
});
