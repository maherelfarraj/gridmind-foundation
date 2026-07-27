// P-231 — labor report math: KPIs, rate fallback, discipline matrix, payroll CSV.
import { describe, expect, it } from "vitest";

import {
  aggregateLaborActuals,
  aggregatePerPerson,
  aggregatePerProject,
  buildDisciplineMatrix,
  computeReportKpis,
  monthRange,
  payrollRows,
  resolveRate,
  type RateContext,
  type ReportEntry,
} from "@/lib/timesheets/reports";

const ctx: RateContext = {
  defaultRates: { u1: 30, u2: null },
  disciplines: { cwp1: "electrical" },
};

function entry(over: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: over.id ?? "e1",
    user_id: "u1",
    project_id: "p1",
    cwp_id: null,
    work_date: "2026-07-06",
    week_start: "2026-07-05",
    activity: "regular",
    hours: 8,
    hourly_rate: null,
    status: "approved",
    ...over,
  };
}

describe("resolveRate", () => {
  it("prefers the entry rate over the profile default", () => {
    expect(resolveRate(entry({ hourly_rate: 45 }), ctx)).toBe(45);
  });

  it("falls back to profiles.default_hourly_rate", () => {
    expect(resolveRate(entry(), ctx)).toBe(30);
  });

  it("returns null when neither rate exists", () => {
    expect(resolveRate(entry({ user_id: "u2" }), ctx)).toBeNull();
  });
});

describe("computeReportKpis", () => {
  const entries = [
    entry({ id: "a", hours: 10 }),
    entry({ id: "b", activity: "overtime", hours: 2 }),
    entry({ id: "c", activity: "leave_annual", hours: 8, work_date: "2026-03-02" }),
  ];

  it("sums hours and computes overtime percentage", () => {
    const kpis = computeReportKpis(entries, { backlogCount: 3, year: 2026 });
    expect(kpis.total_hours).toBe(20);
    expect(kpis.overtime_pct).toBeCloseTo(10, 5);
    expect(kpis.backlog_count).toBe(3);
  });

  it("counts leave days YTD from leave activities", () => {
    const kpis = computeReportKpis(entries, { backlogCount: 0, year: 2026 });
    expect(kpis.leave_days_ytd).toBe(1);
  });

  it("returns zero overtime percentage with no hours", () => {
    expect(computeReportKpis([], { backlogCount: 0, year: 2026 }).overtime_pct).toBe(0);
  });
});

describe("aggregatePerProject", () => {
  it("computes labor cost with the fallback rate and flags missing rates", () => {
    const rows = aggregatePerProject(
      [
        entry({ id: "a", hours: 10, hourly_rate: 50, cwp_id: "cwp1" }),
        entry({ id: "b", user_id: "u2", hours: 4 }),
      ],
      ctx,
    );
    const electrical = rows.find((r) => r.discipline === "electrical");
    expect(electrical?.labor_cost).toBe(500);
    const general = rows.find((r) => r.user_id === "u2");
    expect(general?.discipline).toBe("general");
    expect(general?.labor_cost).toBe(0);
    expect(general?.missing_rate_rows).toBe(1);
  });
});

describe("aggregatePerPerson", () => {
  it("stacks hours by activity and totals overtime", () => {
    const [row] = aggregatePerPerson([
      entry({ id: "a", hours: 8 }),
      entry({ id: "b", activity: "overtime", hours: 3 }),
    ]);
    expect(row.hours_by_activity.regular).toBe(8);
    expect(row.overtime_hours).toBe(3);
    expect(row.total_hours).toBe(11);
  });
});

describe("buildDisciplineMatrix", () => {
  it("groups hours by discipline and project", () => {
    const m = buildDisciplineMatrix(
      [entry({ id: "a", cwp_id: "cwp1", hours: 6 }), entry({ id: "b", hours: 2 })],
      ctx,
    );
    expect(m.cells["electrical|p1"]).toBe(6);
    expect(m.cells["general|p1"]).toBe(2);
    expect(m.disciplineTotals.electrical).toBe(6);
  });
});

describe("payrollRows", () => {
  it("emits the exact payroll column set for approved rows", () => {
    const rows = payrollRows([entry({ hourly_rate: 20, hours: 5 })], ctx, {
      people: { u1: "Sara" },
      projects: { p1: "East Amman" },
    });
    expect(Object.keys(rows[0])).toEqual([
      "employee",
      "week_start",
      "project",
      "activity",
      "hours",
      "hourly_rate",
      "cost",
      "approval_status",
    ]);
    expect(rows[0].cost).toBe(100);
    expect(rows[0].employee).toBe("Sara");
  });
});

describe("aggregateLaborActuals", () => {
  it("splits regular and overtime hours and totals cost", () => {
    const out = aggregateLaborActuals(
      "p1",
      "2026-07",
      [entry({ id: "a", hours: 8, hourly_rate: 10 }), entry({ id: "b", activity: "overtime", hours: 2, hourly_rate: 15 })],
      ctx,
    );
    expect(out.regular_hours).toBe(8);
    expect(out.overtime_hours).toBe(2);
    expect(out.total_hours).toBe(10);
    expect(out.labor_cost).toBe(110);
  });
});

describe("monthRange", () => {
  it("covers the full calendar month", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});
