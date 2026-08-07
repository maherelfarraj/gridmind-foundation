// GC-14 — Contingency & quantitative risk exposure: deterministic core tests.
import { describe, expect, it } from "vitest";

import {
  aggregateExposure,
  assessAdequacy,
  computePoolState,
  distributionMean,
  distributionVariance,
  drawdownCurve,
  expectedValue,
  movementCreateSchema,
  movementDecisionSchema,
  riskQuantSchema,
  rollupPools,
  utilizationTone,
  type MovementInput,
  type PoolInput,
  type RiskQuantInput,
} from "@/lib/contingency.rules";

const POOL: PoolInput = {
  id: "p1",
  project_id: "proj",
  name: "Construction contingency",
  basis: "3% of construction cost",
  cost_code_id: null,
  currency_code: "USD",
  original_amount: 1_000_000,
  status: "active",
};

function mv(o: Partial<MovementInput>): MovementInput {
  return {
    id: crypto.randomUUID(),
    pool_id: "p1",
    kind: "draw",
    amount: 0,
    currency_code: "USD",
    effective_date: "2026-03-15",
    status: "approved",
    risk_id: null,
    change_order_id: null,
    ...o,
  };
}

function quant(o: Partial<RiskQuantInput>): RiskQuantInput {
  return {
    risk_id: crypto.randomUUID(),
    currency_code: "USD",
    cost_low: 0,
    cost_most_likely: 0,
    cost_high: 0,
    probability_pct: 0,
    schedule_days_impact: 0,
    distribution: "triangular",
    ...o,
  };
}

describe("computePoolState", () => {
  it("moves the balance only on approved movements", () => {
    const s = computePoolState(POOL, [
      mv({ kind: "draw", amount: 200_000 }),
      mv({ kind: "draw", amount: 50_000, status: "pending" }),
      mv({ kind: "draw", amount: 90_000, status: "rejected" }),
    ]);
    expect(s.drawn).toBe(200_000);
    expect(s.pending_draw).toBe(50_000);
    expect(s.balance).toBe(800_000);
    expect(s.committed_balance).toBe(750_000);
    expect(s.utilization_pct).toBe(20);
    expect(s.over_drawn).toBe(false);
  });

  it("nets releases and transfers", () => {
    const s = computePoolState(POOL, [
      mv({ kind: "draw", amount: 400_000 }),
      mv({ kind: "release", amount: 100_000 }),
      mv({ kind: "transfer_in", amount: 250_000 }),
      mv({ kind: "transfer_out", amount: 50_000 }),
    ]);
    expect(s.balance).toBe(900_000);
    expect(s.utilization_pct).toBe(35);
  });

  it("ignores movements belonging to another pool", () => {
    const s = computePoolState(POOL, [mv({ pool_id: "other", kind: "draw", amount: 999 })]);
    expect(s.balance).toBe(1_000_000);
  });

  it("flags an over-drawn pool", () => {
    const s = computePoolState(POOL, [mv({ kind: "draw", amount: 1_200_000 })]);
    expect(s.balance).toBe(-200_000);
    expect(s.over_drawn).toBe(true);
  });

  it("keeps cent-level arithmetic exact", () => {
    const s = computePoolState({ ...POOL, original_amount: 100.1 }, [
      mv({ kind: "draw", amount: 33.37 }),
      mv({ kind: "draw", amount: 0.03 }),
    ]);
    expect(s.balance).toBe(66.7);
  });

  it("has no utilisation when the pool is empty", () => {
    expect(computePoolState({ ...POOL, original_amount: 0 }, []).utilization_pct).toBeNull();
  });
});

describe("rollupPools", () => {
  it("reconciles pool totals to the project total", () => {
    const a = computePoolState(POOL, [mv({ kind: "draw", amount: 200_000 })]);
    const b = computePoolState({ ...POOL, id: "p2", original_amount: 500_000 }, [
      mv({ pool_id: "p2", kind: "draw", amount: 100_000 }),
      mv({ pool_id: "p2", kind: "draw", amount: 25_000, status: "pending" }),
    ]);
    const r = rollupPools([a, b]);
    expect(r.original_amount).toBe(1_500_000);
    expect(r.drawn).toBe(300_000);
    expect(r.balance).toBe(1_200_000);
    expect(r.pending_draw).toBe(25_000);
    expect(r.committed_balance).toBe(1_175_000);
    expect(r.utilization_pct).toBe(20);
  });
});

describe("drawdownCurve", () => {
  it("buckets approved consumption by month and accumulates", () => {
    const curve = drawdownCurve([
      mv({ kind: "draw", amount: 100, effective_date: "2026-01-10" }),
      mv({ kind: "draw", amount: 50, effective_date: "2026-01-28" }),
      mv({ kind: "release", amount: 30, effective_date: "2026-02-02" }),
      mv({ kind: "draw", amount: 500, effective_date: "2026-02-05", status: "pending" }),
    ]);
    expect(curve).toEqual([
      { period: "2026-01-01", net: 150, cumulative: 150 },
      { period: "2026-02-01", net: -30, cumulative: 120 },
    ]);
  });
});

describe("distribution math", () => {
  it("uses the triangular mean by default", () => {
    expect(distributionMean(quant({ cost_low: 0, cost_most_likely: 30, cost_high: 60 }))).toBe(30);
  });

  it("weights the most likely value under PERT", () => {
    const q = quant({
      cost_low: 0,
      cost_most_likely: 30,
      cost_high: 120,
      distribution: "pert",
    });
    expect(distributionMean(q)).toBe(40);
    expect(distributionVariance(q)).toBe(400);
  });

  it("weights the mean by probability", () => {
    expect(
      expectedValue(
        quant({ cost_low: 100, cost_most_likely: 200, cost_high: 300, probability_pct: 50 }),
      ),
    ).toBe(100);
  });

  it("is zero at zero probability", () => {
    expect(expectedValue(quant({ cost_high: 1_000, cost_most_likely: 500 }))).toBe(0);
  });
});

describe("aggregateExposure", () => {
  it("sums expected values and widens P80 above P50", () => {
    const e = aggregateExposure([
      quant({
        cost_low: 100_000,
        cost_most_likely: 200_000,
        cost_high: 300_000,
        probability_pct: 50,
        schedule_days_impact: 20,
      }),
      quant({
        cost_low: 0,
        cost_most_likely: 50_000,
        cost_high: 100_000,
        probability_pct: 20,
        schedule_days_impact: 10,
      }),
    ]);
    expect(e.quantified).toBe(2);
    expect(e.expected_value).toBe(110_000);
    expect(e.p50).toBe(110_000);
    expect(e.p80).toBeGreaterThan(e.p50);
    expect(e.schedule_days_expected).toBe(12);
  });

  it("drops closed and realized risks from forward exposure", () => {
    const e = aggregateExposure([
      quant({
        cost_low: 10,
        cost_most_likely: 10,
        cost_high: 10,
        probability_pct: 100,
        risk_status: "closed",
      }),
      quant({
        cost_low: 10,
        cost_most_likely: 10,
        cost_high: 10,
        probability_pct: 100,
        risk_status: "realized",
      }),
      quant({
        cost_low: 10,
        cost_most_likely: 10,
        cost_high: 10,
        probability_pct: 100,
        risk_status: "open",
      }),
    ]);
    expect(e.quantified).toBe(1);
    expect(e.expected_value).toBe(10);
  });

  it("has no spread when every risk is certain and fixed", () => {
    const e = aggregateExposure([
      quant({ cost_low: 500, cost_most_likely: 500, cost_high: 500, probability_pct: 100 }),
    ]);
    expect(e.sigma).toBe(0);
    expect(e.p80).toBe(500);
  });

  it("is empty-safe", () => {
    expect(aggregateExposure([])).toMatchObject({ quantified: 0, expected_value: 0, p80: 0 });
  });
});

describe("assessAdequacy", () => {
  it("is healthy at or above full cover", () => {
    expect(assessAdequacy(100, { ...aggregateExposure([]), p80: 100 }).tone).toBe("good");
  });

  it("warns between 0.75 and 1.00 cover", () => {
    const a = assessAdequacy(80, { ...aggregateExposure([]), p80: 100 });
    expect(a.cover_ratio).toBe(0.8);
    expect(a.tone).toBe("warning");
  });

  it("is adverse below 0.75 cover", () => {
    expect(assessAdequacy(50, { ...aggregateExposure([]), p80: 100 }).tone).toBe("bad");
  });

  it("is neutral with no quantified exposure", () => {
    const a = assessAdequacy(100, aggregateExposure([]));
    expect(a.cover_ratio).toBeNull();
    expect(a.tone).toBe("neutral");
  });

  it("flags a negative balance even without exposure", () => {
    expect(assessAdequacy(-1, aggregateExposure([])).tone).toBe("bad");
  });
});

describe("utilizationTone", () => {
  it("warns at or above the threshold", () => {
    expect(utilizationTone(85)).toBe("warning");
    expect(utilizationTone(20)).toBe("good");
    expect(utilizationTone(null)).toBe("neutral");
  });
});

describe("schemas", () => {
  const base = {
    project_id: crypto.randomUUID(),
    pool_id: crypto.randomUUID(),
    kind: "draw" as const,
    amount: 1000,
    currency_code: "USD",
    effective_date: "2026-03-01",
    reason: "Cable rerouting",
  };

  it("accepts a well formed draw", () => {
    expect(movementCreateSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    expect(movementCreateSchema.safeParse({ ...base, amount: 0 }).success).toBe(false);
  });

  it("requires a counterparty pool on transfers", () => {
    expect(movementCreateSchema.safeParse({ ...base, kind: "transfer_out" }).success).toBe(false);
  });

  it("rejects a self transfer", () => {
    const r = movementCreateSchema.safeParse({
      ...base,
      kind: "transfer_in",
      counterparty_pool_id: base.pool_id,
    });
    expect(r.success).toBe(false);
  });

  it("requires a note when rejecting a movement", () => {
    const id = crypto.randomUUID();
    expect(movementDecisionSchema.safeParse({ id, status: "rejected" }).success).toBe(false);
    expect(
      movementDecisionSchema.safeParse({ id, status: "rejected", decision_note: "Out of scope" })
        .success,
    ).toBe(true);
    expect(movementDecisionSchema.safeParse({ id, status: "approved" }).success).toBe(true);
  });

  it("enforces the low ≤ most likely ≤ high cost range", () => {
    const q = {
      project_id: crypto.randomUUID(),
      risk_id: crypto.randomUUID(),
      currency_code: "USD",
      cost_low: 100,
      cost_most_likely: 50,
      cost_high: 200,
      probability_pct: 40,
    };
    expect(riskQuantSchema.safeParse(q).success).toBe(false);
    expect(riskQuantSchema.safeParse({ ...q, cost_most_likely: 150 }).success).toBe(true);
  });

  it("bounds probability to 0-100", () => {
    const q = {
      project_id: crypto.randomUUID(),
      risk_id: crypto.randomUUID(),
      currency_code: "USD",
      cost_low: 0,
      cost_most_likely: 1,
      cost_high: 2,
      probability_pct: 140,
    };
    expect(riskQuantSchema.safeParse(q).success).toBe(false);
  });
});
