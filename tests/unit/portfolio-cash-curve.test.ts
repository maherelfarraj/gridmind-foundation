// P-253 — Consolidated cash curve proofs: consolidation, monthly↔cumulative
// transform, per-project contribution, drill totals, catalog parity.
import { describe, expect, it } from "vitest";

import portfolioAr from "@/lib/i18n/portfolio.ar.json";
import portfolioEn from "@/lib/i18n/portfolio.en.json";
import {
  consolidateCurve,
  cumulativePoints,
  curvePoints,
  monthLabel,
  monthlyPoints,
  movementTotals,
  projectContributionSeries,
  type CashMovement,
  type ProjectCurveRow,
} from "@/lib/portfolio/cash-curve.rules";

const row = (over: Partial<ProjectCurveRow> & { month: string }): ProjectCurveRow => ({
  project_id: "p1",
  project_code: "GSI-EAM-001",
  project_name: "East Amman Hybrid",
  base_currency: "USD",
  forecast_inflow: 0,
  forecast_outflow: 0,
  actual_inflow: 0,
  actual_outflow: 0,
  forecast_net: 0,
  actual_net: 0,
  ...over,
});

const FIXTURE: ProjectCurveRow[] = [
  row({
    month: "2026-07-01",
    actual_inflow: 225000,
    actual_outflow: 25000,
    actual_net: 200000,
  }),
  row({
    month: "2026-07-01",
    project_id: "p2",
    project_code: "GSI-AQB-002",
    project_name: "Aqaba PV",
    actual_inflow: 50000,
    actual_net: 50000,
  }),
  row({
    month: "2026-08-01",
    forecast_inflow: 400000,
    forecast_outflow: 150000,
    forecast_net: 250000,
  }),
];

describe("consolidateCurve", () => {
  it("sums every project into one month-ordered series", () => {
    const months = consolidateCurve(FIXTURE);
    expect(months.map((m) => m.month)).toEqual(["2026-07-01", "2026-08-01"]);
    expect(months[0]).toMatchObject({
      actual_inflow: 275000,
      actual_outflow: 25000,
      actual_net: 250000,
      forecast_net: 0,
    });
    expect(months[1]).toMatchObject({ forecast_net: 250000, actual_net: 0 });
  });

  it("returns an empty series for no rows", () => {
    expect(consolidateCurve([])).toEqual([]);
  });
});

describe("monthly ↔ cumulative transform", () => {
  const months = consolidateCurve(FIXTURE);

  it("monthly view carries each month's own net", () => {
    expect(monthlyPoints(months).map((p) => p.actual)).toEqual([250000, 0]);
    expect(monthlyPoints(months).map((p) => p.forecast)).toEqual([0, 250000]);
  });

  it("cumulative view accumulates in period order", () => {
    expect(cumulativePoints(months).map((p) => p.actual)).toEqual([250000, 250000]);
    expect(cumulativePoints(months).map((p) => p.forecast)).toEqual([0, 250000]);
  });

  it("curvePoints switches between the two", () => {
    expect(curvePoints(months, false)).toEqual(monthlyPoints(months));
    expect(curvePoints(months, true)).toEqual(cumulativePoints(months));
  });
});

describe("per-project contribution", () => {
  it("emits one key per project, month-ordered", () => {
    const s = projectContributionSeries(FIXTURE);
    expect(s.projects.map((p) => p.project_code)).toEqual(["GSI-AQB-002", "GSI-EAM-001"]);
    expect(s.data).toHaveLength(2);
    expect(s.data[0]).toMatchObject({ month: "2026-07-01", p1: 200000, p2: 50000 });
    expect(s.data[1]).toMatchObject({ month: "2026-08-01", p1: 0, p2: 0 });
  });

  it("degrades to a single series with one project — no fake stacking", () => {
    const s = projectContributionSeries(FIXTURE.filter((r) => r.project_id === "p1"));
    expect(s.projects).toHaveLength(1);
    expect(Object.keys(s.data[0])).toEqual(["month", "p1"]);
  });

  it("accumulates per project when cumulative", () => {
    const s = projectContributionSeries(FIXTURE, { cumulative: true });
    expect(s.data.map((d) => d.p1)).toEqual([200000, 200000]);
  });

  it("can switch basis to forecast", () => {
    const s = projectContributionSeries(FIXTURE, { basis: "forecast" });
    expect(s.data.map((d) => d.p1)).toEqual([0, 250000]);
  });
});

describe("drill-panel wiring", () => {
  const movements: CashMovement[] = [
    {
      id: "m1",
      period: "2026-07-15",
      project_id: "p1",
      project_code: "GSI-EAM-001",
      project_name: "East Amman Hybrid",
      direction: "inflow",
      kind: "actual",
      category: "milestone",
      amount: 225000,
      currency_code: "USD",
      amount_base: 225000,
      base_currency: "USD",
      reference_type: "payment",
      reference_id: "pay-1",
      notes: null,
    },
    {
      id: "m2",
      period: "2026-07-20",
      project_id: "p1",
      project_code: "GSI-EAM-001",
      project_name: "East Amman Hybrid",
      direction: "outflow",
      kind: "actual",
      category: "vendor",
      amount: 25000,
      currency_code: "USD",
      amount_base: 25000,
      base_currency: "USD",
      reference_type: "payment_run",
      reference_id: "run-1",
      notes: null,
    },
    {
      id: "m3",
      period: "2026-07-31",
      project_id: "p1",
      project_code: "GSI-EAM-001",
      project_name: "East Amman Hybrid",
      direction: "inflow",
      kind: "forecast",
      category: "milestone",
      amount: 90000,
      currency_code: "USD",
      amount_base: 90000,
      base_currency: "USD",
      reference_type: null,
      reference_id: null,
      notes: null,
    },
  ];

  it("nets base-currency inflow and outflow", () => {
    expect(movementTotals(movements)).toEqual({
      inflow: 315000,
      outflow: 25000,
      net: 290000,
      count: 3,
    });
  });

  it("scopes totals by kind", () => {
    expect(movementTotals(movements, "actual")).toMatchObject({ net: 200000, count: 2 });
    expect(movementTotals(movements, "forecast")).toMatchObject({ net: 90000, count: 1 });
  });

  it("labels months as YYYY-MM for the axis", () => {
    expect(monthLabel("2026-07-01")).toBe("2026-07");
  });
});

describe("cash curve catalog parity", () => {
  const flatten = (obj: Record<string, unknown>, prefix = ""): string[] =>
    Object.entries(obj).flatMap(([key, value]) =>
      value && typeof value === "object"
        ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
        : [`${prefix}${key}`],
    );

  it("en and ar declare the same cash keys", () => {
    const en = flatten((portfolioEn as Record<string, unknown>).cash as Record<string, unknown>);
    const ar = flatten((portfolioAr as Record<string, unknown>).cash as Record<string, unknown>);
    expect(ar.sort()).toEqual(en.sort());
    expect(en.length).toBeGreaterThan(15);
  });

  it("translates the headline terms into Arabic", () => {
    const ar = (portfolioAr as { cash: Record<string, string> }).cash;
    expect(ar.heading).toBe("منحنى التدفق النقدي الموحّد");
    expect(ar.forecast).toBe("متوقع");
    expect(ar.actual).toBe("فعلي");
    expect(ar.cumulative).toBe("تراكمي");
  });
});
