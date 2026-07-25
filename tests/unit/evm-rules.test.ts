import { describe, expect, it } from "vitest";
import { computeEvm, indexHealth, plannedPercentAtDate } from "@/lib/evm.rules";

describe("plannedPercentAtDate", () => {
  it("returns 0 before start", () => {
    expect(plannedPercentAtDate("2026-01-10", "2026-01-20", "2026-01-05")).toBe(0);
  });
  it("returns 100 after end", () => {
    expect(plannedPercentAtDate("2026-01-10", "2026-01-20", "2026-02-01")).toBe(100);
  });
  it("interpolates linearly at midpoint", () => {
    expect(plannedPercentAtDate("2026-01-10", "2026-01-20", "2026-01-15")).toBe(50);
  });
});

describe("computeEvm", () => {
  it("splits BAC evenly across tasks without explicit budgets", () => {
    const r = computeEvm({
      bac: 1000,
      snapshotDate: "2026-01-15",
      actualCost: 400,
      tasks: [
        {
          id: "a",
          start_date: "2026-01-10",
          end_date: "2026-01-20",
          progress_pct: 50,
          budgeted_amount: null,
        },
        {
          id: "b",
          start_date: "2026-01-10",
          end_date: "2026-01-20",
          progress_pct: 25,
          budgeted_amount: null,
        },
      ],
    });
    // Even share = 500 each. At midpoint PV = 500*0.5 + 500*0.5 = 500.
    // EV = 500*0.5 + 500*0.25 = 375.
    expect(r.pv).toBe(500);
    expect(r.ev).toBe(375);
    expect(r.ac).toBe(400);
    expect(r.spi).toBe(0.75);
    expect(r.cpi).toBeCloseTo(0.938, 3);
    expect(r.eac).toBeCloseTo(1066.67, 1);
  });

  it("uses explicit task budget when set and splits residual", () => {
    const r = computeEvm({
      bac: 1000,
      snapshotDate: "2026-01-20",
      actualCost: 0,
      tasks: [
        {
          id: "a",
          start_date: "2026-01-10",
          end_date: "2026-01-20",
          progress_pct: 100,
          budgeted_amount: 600,
        },
        {
          id: "b",
          start_date: "2026-01-10",
          end_date: "2026-01-20",
          progress_pct: 0,
          budgeted_amount: null,
        },
      ],
    });
    // Explicit=600 for A, residual=400 for B.
    expect(r.pv).toBe(1000); // both fully planned by end date
    expect(r.ev).toBe(600);
  });

  it("returns null SPI/CPI on zero denominators", () => {
    const r = computeEvm({
      bac: 0,
      snapshotDate: "2026-01-15",
      actualCost: 0,
      tasks: [],
    });
    expect(r.spi).toBeNull();
    expect(r.cpi).toBeNull();
    expect(r.eac).toBeNull();
  });
});

describe("indexHealth", () => {
  it("classifies thresholds", () => {
    expect(indexHealth(1.05)).toBe("good");
    expect(indexHealth(1.0)).toBe("good");
    expect(indexHealth(0.95)).toBe("warn");
    expect(indexHealth(0.9)).toBe("warn");
    expect(indexHealth(0.89)).toBe("bad");
    expect(indexHealth(null)).toBe("unknown");
  });
});
