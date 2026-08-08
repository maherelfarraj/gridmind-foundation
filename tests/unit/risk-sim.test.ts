// GC-17 — Unit tests for the deterministic risk simulation core.
import { describe, expect, it } from "vitest";

import {
  alertDedupeKey,
  assessContingencyAdequacy,
  burnRate,
  canTransitionAlert,
  canTransitionSim,
  checksum,
  distributionMean,
  evaluateAlerts,
  mulberry32,
  normCdf,
  normInv,
  percentileSorted,
  quantile,
  reconcileContingency,
  runSimulation,
  summarize,
  validateSimInputs,
  type Distribution,
  type SimRiskInput,
} from "@/lib/risk-sim.rules";

const dist = (over: Partial<Distribution> = {}): Distribution => ({
  kind: "triangular",
  low: 100,
  most_likely: 200,
  high: 400,
  sigma: null,
  points: null,
  ...over,
});

const risk = (over: Partial<SimRiskInput> = {}): SimRiskInput => ({
  risk_id: "00000000-0000-0000-0000-000000000001",
  title: "Grid connection delay",
  probability_pct: 50,
  currency_code: "USD",
  fx_rate: 1,
  cost: dist(),
  schedule: dist({ low: 0, most_likely: 10, high: 30 }),
  correlation_group: null,
  is_opportunity: false,
  ...over,
});

describe("seeded RNG", () => {
  it("is reproducible for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it("differs across seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
  it("stays inside [0,1)", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("normInv / normCdf", () => {
  it("inverts the standard normal at known quantiles", () => {
    expect(normInv(0.5)).toBeCloseTo(0, 6);
    expect(normInv(0.8)).toBeCloseTo(0.8416212, 5);
    expect(normInv(0.95)).toBeCloseTo(1.6448536, 5);
    expect(normInv(0.05)).toBeCloseTo(-1.6448536, 5);
  });
  it("round-trips through the CDF", () => {
    for (const p of [0.01, 0.1, 0.35, 0.5, 0.77, 0.99]) {
      expect(normCdf(normInv(p))).toBeCloseTo(p, 4);
    }
  });
  it("rejects out-of-range probabilities", () => {
    expect(() => normInv(0)).toThrow();
    expect(() => normInv(1)).toThrow();
  });
});

describe("distribution quantiles", () => {
  it("uniform is linear", () => {
    const d = dist({ kind: "uniform", low: 0, most_likely: 5, high: 10 });
    expect(quantile(d, 0.5)).toBeCloseTo(5, 9);
    expect(quantile(d, 0.25)).toBeCloseTo(2.5, 9);
  });
  it("triangular stays inside its support and is monotone", () => {
    const d = dist();
    let prev = -Infinity;
    for (let u = 0.01; u < 1; u += 0.01) {
      const v = quantile(d, u);
      expect(v).toBeGreaterThanOrEqual(d.low - 1e-9);
      expect(v).toBeLessThanOrEqual(d.high + 1e-9);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
  it("pert is clamped to the range", () => {
    const d = dist({ kind: "pert" });
    expect(quantile(d, 0.0001)).toBeGreaterThanOrEqual(d.low);
    expect(quantile(d, 0.9999)).toBeLessThanOrEqual(d.high);
  });
  it("normal centres on the most likely value", () => {
    const d = dist({ kind: "normal", most_likely: 100, sigma: 10 });
    expect(quantile(d, 0.5)).toBeCloseTo(100, 6);
    expect(quantile(d, 0.8)).toBeCloseTo(108.416, 2);
  });
  it("lognormal is strictly positive", () => {
    const d = dist({ kind: "lognormal", most_likely: 50, sigma: 0.5 });
    expect(quantile(d, 0.001)).toBeGreaterThan(0);
    expect(quantile(d, 0.5)).toBeCloseTo(50, 6);
  });
  it("discrete respects weights", () => {
    const d = dist({
      kind: "discrete",
      points: [
        { value: 10, weight: 1 },
        { value: 90, weight: 3 },
      ],
    });
    expect(quantile(d, 0.2)).toBe(10);
    expect(quantile(d, 0.9)).toBe(90);
  });
});

describe("distributionMean", () => {
  it("matches the classic formulas", () => {
    expect(distributionMean(dist())).toBeCloseTo((100 + 200 + 400) / 3, 9);
    expect(distributionMean(dist({ kind: "pert" }))).toBeCloseTo((100 + 800 + 400) / 6, 9);
    expect(distributionMean(dist({ kind: "uniform" }))).toBeCloseTo(250, 9);
    expect(
      distributionMean(
        dist({
          kind: "discrete",
          points: [
            { value: 0, weight: 1 },
            { value: 100, weight: 1 },
          ],
        }),
      ),
    ).toBeCloseTo(50, 9);
  });
});

describe("percentiles + summary statistics", () => {
  it("uses nearest rank", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileSorted(sorted, 10)).toBe(1);
    expect(percentileSorted(sorted, 50)).toBe(5);
    expect(percentileSorted(sorted, 80)).toBe(8);
    expect(percentileSorted(sorted, 100)).toBe(10);
  });
  it("orders P10 ≤ P50 ≤ P80 ≤ P90 ≤ P95", () => {
    const s = summarize([5, 1, 9, 3, 7, 2, 8, 4, 6, 10]);
    expect(s.p10).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p80);
    expect(s.p80).toBeLessThanOrEqual(s.p90);
    expect(s.p90).toBeLessThanOrEqual(s.p95);
    expect(s.mean).toBeCloseTo(5.5, 9);
  });
  it("handles the empty case without NaN", () => {
    const s = summarize([]);
    expect(s.mean).toBe(0);
    expect(s.relative_precision).toBe(0);
  });
});

describe("checksum", () => {
  it("is order-insensitive for object keys", () => {
    expect(checksum({ a: 1, b: 2 })).toBe(checksum({ b: 2, a: 1 }));
  });
  it("changes when a value changes", () => {
    expect(checksum({ a: 1 })).not.toBe(checksum({ a: 2 }));
  });
  it("is stable across calls", () => {
    const v = { risks: [{ id: "x", cost: 10 }], seed: 7 };
    expect(checksum(v)).toBe(checksum(v));
  });
});

describe("runSimulation", () => {
  const base = {
    scope: "joint" as const,
    seed: 12345,
    iterations: 2000,
    reporting_currency: "USD",
    budget_threshold: null,
    schedule_threshold_days: null,
  };

  it("is bit-for-bit reproducible for the same seed", () => {
    const risks = [risk(), risk({ risk_id: "00000000-0000-0000-0000-000000000002" })];
    const a = runSimulation(risks, base);
    const b = runSimulation(risks, base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("changes with the seed", () => {
    const risks = [risk()];
    const a = runSimulation(risks, base);
    const b = runSimulation(risks, { ...base, seed: 999 });
    expect(a.cost.p80).not.toBe(b.cost.p80);
  });

  it("keeps percentiles ordered and the mean near the analytic expectation", () => {
    const r = risk({ probability_pct: 100 });
    const res = runSimulation([r], { ...base, iterations: 20000 });
    expect(res.cost.p50).toBeLessThanOrEqual(res.cost.p80);
    expect(res.cost.p80).toBeLessThanOrEqual(res.cost.p95);
    expect(res.cost.mean).toBeGreaterThan(200);
    expect(res.cost.mean).toBeLessThan(280);
  });

  it("scales expected cost by probability", () => {
    const half = runSimulation([risk({ probability_pct: 50 })], { ...base, iterations: 20000 });
    const full = runSimulation([risk({ probability_pct: 100 })], { ...base, iterations: 20000 });
    expect(half.cost.mean).toBeGreaterThan(full.cost.mean * 0.4);
    expect(half.cost.mean).toBeLessThan(full.cost.mean * 0.6);
  });

  it("applies the FX rate to the reporting currency", () => {
    const one = runSimulation([risk({ probability_pct: 100, fx_rate: 1 })], base);
    const two = runSimulation([risk({ probability_pct: 100, fx_rate: 2 })], base);
    expect(two.cost.mean).toBeCloseTo(one.cost.mean * 2, 6);
  });

  it("treats opportunities as negative cost", () => {
    const res = runSimulation([risk({ probability_pct: 100, is_opportunity: true })], base);
    expect(res.cost.mean).toBeLessThan(0);
  });

  it("correlation groups widen the aggregate spread", () => {
    const make = (group: string | null) =>
      [1, 2, 3, 4].map((n) =>
        risk({
          risk_id: `00000000-0000-0000-0000-00000000000${n}`,
          probability_pct: 100,
          correlation_group: group,
        }),
      );
    const independent = runSimulation(make(null), { ...base, iterations: 20000 });
    const correlated = runSimulation(make("grid"), { ...base, iterations: 20000 });
    expect(correlated.cost.sd).toBeGreaterThan(independent.cost.sd);
    expect(correlated.correlation_groups).toEqual(["grid"]);
  });

  it("computes exceedance probabilities against thresholds", () => {
    const res = runSimulation([risk({ probability_pct: 100 })], {
      ...base,
      iterations: 20000,
      budget_threshold: 0,
      schedule_threshold_days: 0,
    });
    expect(res.prob_exceeds_budget).toBeGreaterThan(0.9);
    expect(res.prob_exceeds_finish).toBeGreaterThan(0.5);
  });

  it("ranks the dominant risk at the top of the tornado", () => {
    const small = risk({ risk_id: "00000000-0000-0000-0000-00000000000a", probability_pct: 100 });
    const big = risk({
      risk_id: "00000000-0000-0000-0000-00000000000b",
      title: "Module price shock",
      probability_pct: 100,
      cost: dist({ low: 10000, most_likely: 20000, high: 40000 }),
    });
    const res = runSimulation([small, big], { ...base, iterations: 5000 });
    expect(res.tornado[0]!.risk_id).toBe(big.risk_id);
    expect(res.tornado[0]!.share_pct).toBeGreaterThan(res.tornado[1]!.share_pct);
  });

  it("reports convergence diagnostics", () => {
    const res = runSimulation([risk({ probability_pct: 100 })], { ...base, iterations: 20000 });
    expect(res.cost.standard_error).toBeGreaterThan(0);
    expect(res.cost.relative_precision).toBeLessThan(0.02);
    expect(res.converged).toBe(true);
  });

  it("precision improves with more iterations", () => {
    const r = [risk({ probability_pct: 60 })];
    const coarse = runSimulation(r, { ...base, iterations: 1000 });
    const fine = runSimulation(r, { ...base, iterations: 20000 });
    expect(fine.cost.standard_error).toBeLessThan(coarse.cost.standard_error);
  });
});

describe("validateSimInputs", () => {
  it("accepts a clean set", () => {
    expect(validateSimInputs([risk()])).toEqual([]);
  });
  it("rejects duplicate risks as double counting", () => {
    const problems = validateSimInputs([risk(), risk()]);
    expect(problems.join(" ")).toMatch(/double counting/i);
  });
  it("rejects an inverted range", () => {
    const problems = validateSimInputs([risk({ cost: dist({ low: 500 }) })]);
    expect(problems.length).toBeGreaterThan(0);
  });
  it("rejects zero probability and missing FX", () => {
    expect(validateSimInputs([risk({ probability_pct: 0 })]).length).toBe(1);
    expect(validateSimInputs([risk({ fx_rate: 0 })]).length).toBe(1);
  });
  it("rejects a normal distribution without sigma", () => {
    const problems = validateSimInputs([risk({ cost: dist({ kind: "normal", sigma: null }) })]);
    expect(problems.join(" ")).toMatch(/sigma/);
  });
  it("rejects a discrete distribution without points", () => {
    const problems = validateSimInputs([risk({ cost: dist({ kind: "discrete", points: null }) })]);
    expect(problems.join(" ")).toMatch(/points/);
  });
});

describe("contingency adequacy", () => {
  it("bands healthy / watch / inadequate", () => {
    expect(
      assessContingencyAdequacy({
        available: 120,
        management_reserve: 0,
        p50: 50,
        p80: 100,
        p90: 130,
      }).band,
    ).toBe("healthy");
    expect(
      assessContingencyAdequacy({
        available: 80,
        management_reserve: 0,
        p50: 50,
        p80: 100,
        p90: 130,
      }).band,
    ).toBe("watch");
    expect(
      assessContingencyAdequacy({
        available: 50,
        management_reserve: 0,
        p50: 50,
        p80: 100,
        p90: 130,
      }).band,
    ).toBe("inadequate");
  });
  it("reports headroom and shortfall", () => {
    const a = assessContingencyAdequacy({
      available: 70,
      management_reserve: 40,
      p50: 50,
      p80: 100,
      p90: 130,
    });
    expect(a.headroom_p80).toBe(-30);
    expect(a.shortfall_p80).toBe(30);
    expect(a.cover_p80_with_reserve).toBeCloseTo(1.1, 9);
  });
  it("treats a zero exposure as healthy with null cover", () => {
    const a = assessContingencyAdequacy({
      available: 10,
      management_reserve: 0,
      p50: 0,
      p80: 0,
      p90: 0,
    });
    expect(a.cover_p80).toBeNull();
    expect(a.band).toBe("healthy");
  });
});

describe("reconcileContingency", () => {
  it("reconciles opening to closing", () => {
    const r = reconcileContingency({
      opening: 1000,
      additions: 200,
      transfers_in: 100,
      transfers_out: 50,
      drawdowns: 300,
      releases: 150,
    });
    expect(r.closing).toBe(800);
    expect(r.balanced).toBe(true);
  });
  it("flags a mismatch against a reported closing balance", () => {
    const r = reconcileContingency(
      { opening: 100, additions: 0, transfers_in: 0, transfers_out: 0, drawdowns: 10, releases: 0 },
      95,
    );
    expect(r.balanced).toBe(false);
  });
});

describe("burnRate", () => {
  const asOf = new Date("2026-08-08T00:00:00Z");
  it("returns zero for an empty ledger", () => {
    expect(burnRate([], asOf)).toEqual({ total: 0, per_day: 0, spike: false });
  });
  it("computes velocity and detects a spike", () => {
    const b = burnRate(
      [
        { effective_date: "2026-01-01", amount: 100 },
        { effective_date: "2026-08-01", amount: 5000 },
      ],
      asOf,
    );
    expect(b.total).toBe(5100);
    expect(b.per_day).toBeGreaterThan(0);
    expect(b.spike).toBe(true);
  });
});

describe("lifecycle state machines", () => {
  it("gates simulation transitions", () => {
    expect(canTransitionSim("draft", "approved")).toBe(true);
    expect(canTransitionSim("draft", "superseded")).toBe(false);
    expect(canTransitionSim("approved", "superseded")).toBe(true);
    expect(canTransitionSim("approved", "draft")).toBe(false);
    expect(canTransitionSim("superseded", "approved")).toBe(false);
    expect(canTransitionSim("rejected", "approved")).toBe(false);
  });
  it("gates alert transitions", () => {
    expect(canTransitionAlert("open", "acknowledged")).toBe(true);
    expect(canTransitionAlert("resolved", "open")).toBe(true);
    expect(canTransitionAlert("resolved", "acknowledged")).toBe(false);
  });
});

describe("alerts", () => {
  it("builds a stable dedupe key", () => {
    expect(alertDedupeKey("high_exposure", "p1", "p80")).toBe("gc17:high_exposure:p1:p80");
    expect(alertDedupeKey("high_exposure", null, "p80")).toBe("gc17:high_exposure:portfolio:p80");
  });

  const baseEval = {
    project_id: "p1",
    adequacy: assessContingencyAdequacy({
      available: 200,
      management_reserve: 0,
      p50: 50,
      p80: 100,
      p90: 130,
    }),
    sim: {
      ran_at: "2026-08-01T00:00:00Z",
      prob_exceeds_budget: 0.05,
      prob_exceeds_finish: 0.02,
      converged: true,
      top_contributor: null,
      top_contributor_id: null,
    },
    burn: { per_day: 1, spike: false },
    unlinked_drawdowns: 0,
    overdue_mitigations: 0,
    input_problems: 0,
    missing_fx: 0,
    reserve_expiring: 0,
    now: new Date("2026-08-08T00:00:00Z"),
  };

  it("stays quiet when everything is healthy", () => {
    expect(evaluateAlerts(baseEval)).toEqual([]);
  });

  it("raises inadequacy, breach and unlinked drawdown families", () => {
    const out = evaluateAlerts({
      ...baseEval,
      adequacy: assessContingencyAdequacy({
        available: 10,
        management_reserve: 0,
        p50: 50,
        p80: 100,
        p90: 130,
      }),
      sim: { ...baseEval.sim, prob_exceeds_budget: 0.4, prob_exceeds_finish: 0.3 },
      unlinked_drawdowns: 2,
    });
    const families = out.map((a) => a.family);
    expect(families).toContain("contingency_inadequacy");
    expect(families).toContain("p80_budget_breach");
    expect(families).toContain("p90_schedule_breach");
    expect(families).toContain("unlinked_drawdown");
  });

  it("flags a stale or missing simulation", () => {
    expect(
      evaluateAlerts({ ...baseEval, sim: { ...baseEval.sim, ran_at: null } }).map((a) => a.family),
    ).toContain("stale_simulation");
    expect(
      evaluateAlerts({
        ...baseEval,
        sim: { ...baseEval.sim, ran_at: "2026-01-01T00:00:00Z" },
      }).map((a) => a.family),
    ).toContain("stale_simulation");
  });

  it("flags missing FX with no silent fallback", () => {
    const out = evaluateAlerts({ ...baseEval, missing_fx: 2 });
    const fx = out.find((a) => a.family === "fx_materiality");
    expect(fx?.severity).toBe("critical");
    expect(fx?.detail).toMatch(/no silent fallback/i);
  });

  it("is deterministic for identical input", () => {
    expect(JSON.stringify(evaluateAlerts({ ...baseEval, missing_fx: 1 }))).toBe(
      JSON.stringify(evaluateAlerts({ ...baseEval, missing_fx: 1 })),
    );
  });
});
