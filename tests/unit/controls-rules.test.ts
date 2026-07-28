// P-180 — Pure planning & controls rules.
import { describe, expect, it } from "vitest";

import {
  compareToBaseline,
  criticalPathTaskIds,
  disciplineProgress,
  formatPerManhour,
  mondayOf,
  pickRule,
  productivityRows,
  taskDurationDays,
  weightedProgressPct,
  type CpTask,
  type WeightingRule,
} from "@/lib/controls.rules";

const task = (
  id: string,
  start: string,
  end: string,
  preds: string[] = [],
  status = "in_progress",
): CpTask => ({ id, start_date: start, end_date: end, predecessor_ids: preds, status });

describe("critical path", () => {
  it("picks the longest predecessor chain, deterministically", () => {
    const tasks = [
      task("a", "2026-01-01", "2026-01-10"), // 10d
      task("b", "2026-01-11", "2026-01-15", ["a"]), // 5d
      task("c", "2026-01-11", "2026-01-30", ["a"]), // 20d
      task("d", "2026-02-01", "2026-02-05", ["c"]), // 5d
    ];
    expect(criticalPathTaskIds(tasks)).toEqual(["a", "c", "d"]);
    expect(criticalPathTaskIds([...tasks].reverse())).toEqual(["a", "c", "d"]);
  });

  it("ignores complete tasks and survives cycles", () => {
    const tasks = [
      task("a", "2026-01-01", "2026-01-10", [], "complete"),
      task("b", "2026-01-11", "2026-01-20", ["a", "c"]),
      task("c", "2026-01-11", "2026-01-14", ["b"]),
    ];
    const cp = criticalPathTaskIds(tasks);
    expect(cp).not.toContain("a");
    expect(cp.length).toBeGreaterThan(0);
  });

  it("counts inclusive durations", () => {
    expect(taskDurationDays("2026-01-01", "2026-01-01")).toBe(1);
    expect(taskDurationDays("2026-01-01", "2026-01-10")).toBe(10);
  });
});

describe("baseline compare", () => {
  it("computes variance and flags slippage over 7 days", () => {
    const rows = compareToBaseline(
      [
        {
          id: "t1",
          name: "Piling",
          start_date: "2026-01-05",
          end_date: "2026-01-20",
          progress_pct: 40,
        },
        {
          id: "t2",
          name: "Trenching",
          start_date: "2026-01-01",
          end_date: "2026-01-10",
          progress_pct: 60,
        },
      ],
      [
        {
          task_id: "t1",
          name: "Piling",
          start_date: "2026-01-01",
          end_date: "2026-01-10",
          progress_pct: 50,
        },
        {
          task_id: "t2",
          name: "Trenching",
          start_date: "2026-01-01",
          end_date: "2026-01-08",
          progress_pct: 50,
        },
      ],
    );
    const t1 = rows.find((r) => r.taskId === "t1")!;
    expect(t1.startVarianceDays).toBe(4);
    expect(t1.finishVarianceDays).toBe(10);
    expect(t1.slipping).toBe(true);
    expect(t1.progressDelta).toBe(-10);
    expect(rows.find((r) => r.taskId === "t2")!.slipping).toBe(false);
  });
});

describe("quantity progress", () => {
  const rules: WeightingRule[] = [
    {
      id: "r1",
      project_id: null,
      discipline: "civil",
      uom: "m3",
      target_qty: 1000,
      is_active: true,
    },
    {
      id: "r2",
      project_id: "p1",
      discipline: "civil",
      uom: "m3",
      target_qty: 500,
      is_active: true,
    },
  ];

  it("prefers the project rule over the company default", () => {
    expect(pickRule(rules, "civil", "m3")?.id).toBe("r2");
  });

  it("clamps progress at 100%", () => {
    const p = disciplineProgress([{ discipline: "civil", uom: "m3", quantity: 900 }], rules);
    expect(p.get("civil")).toBe(100);
  });

  it("computes proportional progress", () => {
    const p = disciplineProgress([{ discipline: "civil", uom: "m3", quantity: 125 }], rules);
    expect(p.get("civil")).toBe(25);
  });

  it("weights CWP rollup by weight", () => {
    expect(
      weightedProgressPct([
        { weight: 3, progress_pct: 100 },
        { weight: 1, progress_pct: 0 },
      ]),
    ).toBe(75);
    expect(weightedProgressPct([])).toBe(0);
  });
});

describe("productivity", () => {
  it("returns null units/manhour when hours are zero", () => {
    const rows = productivityRows([
      { bucket: "civil", qty: 100, hours: 50 },
      { bucket: "electrical", qty: 20, hours: 0 },
    ]);
    expect(rows.find((r) => r.bucket === "civil")!.unitsPerManhour).toBe(2);
    expect(rows.find((r) => r.bucket === "electrical")!.unitsPerManhour).toBeNull();
    expect(formatPerManhour(null)).toBe("—");
  });
});

describe("mondayOf", () => {
  it("snaps any date back to its Monday", () => {
    expect(mondayOf("2026-07-26")).toBe("2026-07-20"); // Sunday
    expect(mondayOf("2026-07-20")).toBe("2026-07-20"); // Monday
    expect(mondayOf("2026-07-24")).toBe("2026-07-20"); // Friday
  });
});
