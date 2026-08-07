// GC-13 — Portfolio consolidated curve and non-posting stress overlay proofs.
import { describe, expect, it } from "vitest";

import financeAr from "@/lib/i18n/finance.ar.json";
import financeEn from "@/lib/i18n/finance.en.json";
import portfolioAr from "@/lib/i18n/portfolio.ar.json";
import portfolioEn from "@/lib/i18n/portfolio.en.json";
import {
  aggregatePortfolioCurve,
  computeLiquidity,
  fundingPosition,
  portfolioStress,
  stressPortfolioCurve,
  type CashBucket,
  type PortfolioCashRow,
} from "@/lib/cashflow.rules";

function bucket(start: string, inflow: number, outflow: number): CashBucket {
  return {
    start,
    end: start,
    inflow,
    outflow,
    net: inflow - outflow,
    cumulative: 0,
    closing_cash: 0,
  };
}

function row(over: Partial<PortfolioCashRow> & { project_id: string }): PortfolioCashRow {
  const buckets = over.buckets ?? [];
  const measures = over.measures ?? computeLiquidity(buckets, 0);
  return {
    project_code: over.project_id.toUpperCase(),
    project_name: over.project_id,
    status: "approved",
    basis: "approved",
    reporting_currency: "USD",
    project_currency: "USD",
    fx_rate: 1,
    fx_missing: false,
    buckets,
    measures,
    funding: over.funding ?? fundingPosition(measures.peak_funding_need, []),
    ...over,
  } as PortfolioCashRow;
}

describe("aggregatePortfolioCurve", () => {
  it("unions bucket frames and recomputes cumulative and closing balances", () => {
    const a = row({
      project_id: "a",
      buckets: [bucket("2026-01-01", 100, 40), bucket("2026-02-01", 0, 80)],
    });
    const b = row({
      project_id: "b",
      buckets: [bucket("2026-02-01", 20, 10), bucket("2026-03-01", 5, 0)],
    });
    const curve = aggregatePortfolioCurve([a, b]);
    expect(curve.map((c) => c.start)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(curve[0]?.net).toBe(60);
    expect(curve[1]?.inflow).toBe(20);
    expect(curve[1]?.outflow).toBe(90);
    expect(curve[2]?.cumulative).toBe(60 - 70 + 5);
  });

  it("excludes projects without a usable rate instead of re-rating them", () => {
    const good = row({ project_id: "a", buckets: [bucket("2026-01-01", 100, 0)] });
    const bad = row({
      project_id: "b",
      fx_rate: null,
      fx_missing: true,
      buckets: [bucket("2026-01-01", 999, 0)],
    });
    expect(aggregatePortfolioCurve([good, bad])[0]?.inflow).toBe(100);
  });

  it("returns an empty curve for an empty portfolio", () => {
    expect(aggregatePortfolioCurve([])).toEqual([]);
  });
});

describe("stressPortfolioCurve", () => {
  const curve = aggregatePortfolioCurve([
    row({
      project_id: "a",
      buckets: [bucket("2026-01-01", 100, 50), bucket("2026-02-01", 100, 50)],
    }),
  ]);

  it("is the identity transform with no assumptions", () => {
    expect(stressPortfolioCurve(curve, {})).toEqual(curve);
  });

  it("slips receipts to the right without losing money", () => {
    const out = stressPortfolioCurve(curve, { receipt_delay_buckets: 1 });
    expect(out[0]?.inflow).toBe(0);
    expect(out[1]?.inflow).toBe(200);
    const total = out.reduce((s, b) => s + b.inflow, 0);
    expect(total).toBe(200);
  });

  it("clamps slippage inside the horizon rather than dropping cash", () => {
    const out = stressPortfolioCurve(curve, { receipt_delay_buckets: 99 });
    expect(out.reduce((s, b) => s + b.inflow, 0)).toBe(200);
  });

  it("applies outflow uplift and a symmetric fx shock", () => {
    const out = stressPortfolioCurve(curve, { outflow_uplift_pct: 10, fx_shock_pct: 100 });
    expect(out[0]?.outflow).toBe(110);
    expect(out[0]?.inflow).toBe(200);
  });

  it("never mutates the governed input curve", () => {
    const snapshot = JSON.stringify(curve);
    stressPortfolioCurve(curve, { receipt_delay_buckets: 2, outflow_uplift_pct: 50 });
    expect(JSON.stringify(curve)).toBe(snapshot);
  });
});

describe("portfolioStress", () => {
  const rows = [
    row({
      project_id: "a",
      buckets: [bucket("2026-01-01", 50, 200), bucket("2026-02-01", 100, 0)],
    }),
  ];

  it("produces a comparison with zero deltas for a null scenario", () => {
    const res = portfolioStress(rows, 1000, {});
    const peak = res.comparison.find((c) => c.metric === "peak_funding_need");
    expect(peak?.delta).toBe(0);
    expect(res.basis_curve).toEqual(res.stressed_curve);
  });

  it("worsens peak funding need when outflows rise", () => {
    const res = portfolioStress(rows, 1000, { outflow_uplift_pct: 50 });
    const peak = res.comparison.find((c) => c.metric === "peak_funding_need");
    expect(peak?.basis).toBe(150);
    expect(peak?.scenario).toBe(250);
    expect(peak?.delta).toBe(100);
  });

  it("reflects facility reductions in headroom", () => {
    const res = portfolioStress(rows, 1000, { facility_change_pct: -50 });
    const headroom = res.comparison.find((c) => c.metric === "headroom");
    expect(headroom?.basis).toBe(850);
    expect(headroom?.scenario).toBe(350);
  });

  it("is deterministic across repeated evaluation", () => {
    const a = portfolioStress(rows, 1000, { fx_shock_pct: 12, receipt_delay_buckets: 1 });
    const b = portfolioStress(rows, 1000, { fx_shock_pct: 12, receipt_delay_buckets: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("i18n catalog parity for the new cash-flow surfaces", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    typeof o === "object" && o !== null
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          typeof v === "object" && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
        )
      : [];

  it("portfolio cash-flow keys match between EN and AR", () => {
    const en = keys((portfolioEn as Record<string, never>)["costing"]["cashFlow"]);
    const ar = keys((portfolioAr as Record<string, never>)["costing"]["cashFlow"]);
    expect(ar.sort()).toEqual(en.sort());
    expect(en).toContain("stress.watermark");
    expect(en).toContain("curve.title");
    expect(en).toContain("filters.onlyApproved");
  });

  it("cash-flow appendix keys match between EN and AR", () => {
    const en = keys((financeEn as Record<string, never>)["costing"]["cashFlow"]["appendix"]);
    const ar = keys((financeAr as Record<string, never>)["costing"]["cashFlow"]["appendix"]);
    expect(ar.sort()).toEqual(en.sort());
    for (const k of ["basis.approved", "scenarioWatermark", "precedence", "approvedBy"]) {
      expect(en).toContain(k);
    }
  });
});
