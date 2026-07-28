// P-251 — Portfolio aggregation math proofs.
import { describe, expect, it } from "vitest";

import {
  aggregateEvm,
  openBalance,
  sumOpenBalances,
  trir,
  weightedCpi,
  weightedSpi,
  withCumulative,
} from "@/lib/portfolio/portfolio.rules";

const FIXTURE = [
  { pv: 100, ev: 90, ac: 80, bac: 500 },
  { pv: 200, ev: 220, ac: 240, bac: 900 },
];

describe("portfolio EVM aggregation", () => {
  it("weights SPI by value, never averaging ratios", () => {
    expect(weightedSpi(FIXTURE)).toBeCloseTo(310 / 300, 10);
    const averageOfRatios = (90 / 100 + 220 / 200) / 2; // 1.0 — the wrong answer
    expect(averageOfRatios).toBe(1);
    expect(weightedSpi(FIXTURE)).not.toBeCloseTo(averageOfRatios, 3);
  });

  it("weights CPI by value", () => {
    expect(weightedCpi(FIXTURE)).toBeCloseTo(310 / 320, 10);
  });

  it("sums PV/EV/AC/BAC and counts projects", () => {
    expect(aggregateEvm(FIXTURE)).toMatchObject({
      pv: 300,
      ev: 310,
      ac: 320,
      bac: 1400,
      projects_counted: 2,
    });
  });

  it("returns null instead of dividing by zero", () => {
    expect(weightedSpi([{ pv: 0, ev: 0, ac: 0 }])).toBeNull();
    expect(weightedCpi([])).toBeNull();
  });
});

describe("portfolio TRIR", () => {
  it("is hours-weighted across the portfolio", () => {
    expect(trir(1, 2000)).toBe(100);
    expect(trir(3, 600000)).toBeCloseTo(1, 10);
  });

  it("is null with no exposure hours", () => {
    expect(trir(2, 0)).toBeNull();
  });
});

describe("portfolio AR/AP open balances", () => {
  it("nets tax and payments, flooring at zero", () => {
    expect(openBalance({ amount: 1000, tax_amount: 160, paid_amount: 200 })).toBe(960);
    expect(openBalance({ amount: 400 })).toBe(400);
    expect(openBalance({ amount: 100, tax_amount: 0, paid_amount: 250 })).toBe(0);
  });

  it("sums an invoice set", () => {
    expect(
      sumOpenBalances([{ amount: 1000, tax_amount: 160, paid_amount: 200 }, { amount: 400 }]),
    ).toBe(1360);
  });
});

describe("consolidated cash curve", () => {
  it("accumulates forecast and actual nets in period order", () => {
    const points = [
      {
        period: "2026-07-01",
        forecast_in: 0,
        forecast_out: 2000,
        actual_in: 1705,
        actual_out: 300,
        forecast_net: -2000,
        actual_net: 1405,
      },
      {
        period: "2026-08-01",
        forecast_in: 500,
        forecast_out: 0,
        actual_in: 0,
        actual_out: 0,
        forecast_net: 500,
        actual_net: 0,
      },
    ];
    const cum = withCumulative(points);
    expect(cum.map((p) => p.cum_forecast_net)).toEqual([-2000, -1500]);
    expect(cum.map((p) => p.cum_actual_net)).toEqual([1405, 1405]);
  });
});
