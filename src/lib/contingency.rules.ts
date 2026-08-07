// GC-14 — Governed contingency & quantitative risk exposure: deterministic core.
//
// This module is PURE. It never touches the database, never mutates costing,
// forecast, EVM or cash-flow snapshots, and never re-rates frozen data. It
// consumes authoritative rows (contingency pools, approved/pending movements
// and per-risk quantifications) and derives pool balances, drawdown burn and
// risk-adjusted exposure.
//
// All money arithmetic goes through the costing minor-unit helpers so that
// pool -> project -> portfolio totals reconcile exactly.
import { z } from "zod";

import { fromMinor, roundMoney, toMinor } from "@/lib/costing.fx";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const POOL_STATUSES = ["draft", "active", "closed"] as const;
export type PoolStatus = (typeof POOL_STATUSES)[number];

export const MOVEMENT_KINDS = ["draw", "release", "transfer_in", "transfer_out"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_STATUSES = ["pending", "approved", "rejected"] as const;
export type MovementStatus = (typeof MOVEMENT_STATUSES)[number];

export const RISK_DISTRIBUTIONS = ["triangular", "pert"] as const;
export type RiskDistribution = (typeof RISK_DISTRIBUTIONS)[number];

/** Sign a movement kind applies to the pool balance. */
export const MOVEMENT_SIGN: Record<MovementKind, -1 | 1> = {
  draw: -1,
  release: 1,
  transfer_in: 1,
  transfer_out: -1,
};

/** Adequacy thresholds: cover ratio = balance ÷ P80 exposure. */
export const ADEQUACY_HEALTHY = 1;
export const ADEQUACY_WATCH = 0.75;

/** Utilisation above this share of the original pool is a warning. */
export const UTILIZATION_WARN_PCT = 80;

export const CONTINGENCY_FORMULAS = {
  balance:
    "balance = original + approved releases + transfers in − approved draws − transfers out. Pending movements never move the balance.",
  emv: "expected value = probability × mean(cost range). Triangular mean = (low + most likely + high) ÷ 3; PERT mean = (low + 4×most likely + high) ÷ 6.",
  exposure:
    "P50/P80 exposure aggregates independent risks by moment matching: mean = Σ expected value, σ = √(Σ variance); P80 = mean + 0.8416σ.",
  cover: "cover ratio = pool balance ÷ P80 exposure. Below 1.00 the pool is under-funded.",
} as const;

/** Standard-normal quantiles used for the deterministic exposure bands. */
const Z_P50 = 0;
const Z_P80 = 0.8416212335729143;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface PoolInput {
  id: string;
  project_id: string;
  name: string;
  basis: string | null;
  cost_code_id: string | null;
  currency_code: string;
  original_amount: number;
  status: PoolStatus;
}

export interface MovementInput {
  id: string;
  pool_id: string;
  kind: MovementKind;
  amount: number;
  currency_code: string;
  effective_date: string; // YYYY-MM-DD
  status: MovementStatus;
  risk_id: string | null;
  change_order_id: string | null;
}

export interface RiskQuantInput {
  risk_id: string;
  currency_code: string;
  cost_low: number;
  cost_most_likely: number;
  cost_high: number;
  probability_pct: number;
  schedule_days_impact: number;
  distribution: RiskDistribution;
  /** Risks that are closed or already realized drop out of forward exposure. */
  risk_status?: "open" | "mitigating" | "realized" | "closed";
}

export interface PoolState {
  id: string;
  name: string;
  currency_code: string;
  status: PoolStatus;
  original_amount: number;
  drawn: number;
  released: number;
  transferred_in: number;
  transferred_out: number;
  pending_draw: number;
  balance: number;
  /** Balance if every pending draw were approved today. */
  committed_balance: number;
  utilization_pct: number | null;
  over_drawn: boolean;
}

export interface ExposureState {
  quantified: number;
  expected_value: number;
  p50: number;
  p80: number;
  sigma: number;
  schedule_days_expected: number;
}

export interface AdequacyState {
  balance: number;
  p80: number;
  cover_ratio: number | null;
  tone: "good" | "warning" | "bad" | "neutral";
}

// ---------------------------------------------------------------------------
// Pool balances
// ---------------------------------------------------------------------------
function sumMinor(values: number[]): number {
  return values.reduce((acc, v) => acc + toMinor(v), 0);
}

/**
 * Derive a pool's state from its movements.
 *
 * Only APPROVED movements move the balance — pending requests are surfaced
 * separately so approvers can see the committed position without the ledger
 * pretending money already moved.
 */
export function computePoolState(pool: PoolInput, movements: MovementInput[]): PoolState {
  const mine = movements.filter((m) => m.pool_id === pool.id);
  const approved = mine.filter((m) => m.status === "approved");
  const byKind = (kind: MovementKind, rows: MovementInput[]) =>
    fromMinor(sumMinor(rows.filter((m) => m.kind === kind).map((m) => m.amount)));

  const drawn = byKind("draw", approved);
  const released = byKind("release", approved);
  const transferred_in = byKind("transfer_in", approved);
  const transferred_out = byKind("transfer_out", approved);
  const pending_draw = byKind(
    "draw",
    mine.filter((m) => m.status === "pending"),
  );

  const balanceMinor =
    toMinor(pool.original_amount) +
    toMinor(released) +
    toMinor(transferred_in) -
    toMinor(drawn) -
    toMinor(transferred_out);
  const balance = fromMinor(balanceMinor);

  const consumedMinor = toMinor(drawn) + toMinor(transferred_out) - toMinor(released);
  const originalMinor = toMinor(pool.original_amount);

  return {
    id: pool.id,
    name: pool.name,
    currency_code: pool.currency_code,
    status: pool.status,
    original_amount: roundMoney(pool.original_amount),
    drawn,
    released,
    transferred_in,
    transferred_out,
    pending_draw,
    balance,
    committed_balance: fromMinor(balanceMinor - toMinor(pending_draw)),
    utilization_pct:
      originalMinor > 0 ? roundMoney((consumedMinor / originalMinor) * 100, 1) : null,
    over_drawn: balanceMinor < 0,
  };
}

export function rollupPools(states: PoolState[]): {
  original_amount: number;
  drawn: number;
  balance: number;
  committed_balance: number;
  pending_draw: number;
  utilization_pct: number | null;
} {
  const original = sumMinor(states.map((s) => s.original_amount));
  const drawn = sumMinor(states.map((s) => s.drawn));
  const released = sumMinor(states.map((s) => s.released));
  const out = sumMinor(states.map((s) => s.transferred_out));
  const balance = sumMinor(states.map((s) => s.balance));
  return {
    original_amount: fromMinor(original),
    drawn: fromMinor(drawn),
    balance: fromMinor(balance),
    committed_balance: fromMinor(sumMinor(states.map((s) => s.committed_balance))),
    pending_draw: fromMinor(sumMinor(states.map((s) => s.pending_draw))),
    utilization_pct: original > 0 ? roundMoney(((drawn + out - released) / original) * 100, 1) : null,
  };
}

/** Cumulative approved drawdown by month, oldest first. */
export function drawdownCurve(
  movements: MovementInput[],
): { period: string; net: number; cumulative: number }[] {
  const approved = movements.filter((m) => m.status === "approved");
  const buckets = new Map<string, number>();
  for (const m of approved) {
    const period = `${m.effective_date.slice(0, 7)}-01`;
    // Drawdown is consumption, so a draw counts positive on this curve.
    const signed = -MOVEMENT_SIGN[m.kind] * toMinor(m.amount);
    buckets.set(period, (buckets.get(period) ?? 0) + signed);
  }
  let running = 0;
  return [...buckets.keys()]
    .sort()
    .map((period) => {
      running += buckets.get(period)!;
      return { period, net: fromMinor(buckets.get(period)!), cumulative: fromMinor(running) };
    });
}

// ---------------------------------------------------------------------------
// Quantitative exposure
// ---------------------------------------------------------------------------
/** Distribution mean of the cost range (before probability weighting). */
export function distributionMean(q: RiskQuantInput): number {
  const { cost_low: a, cost_most_likely: m, cost_high: b } = q;
  return q.distribution === "pert" ? (a + 4 * m + b) / 6 : (a + m + b) / 3;
}

/** Variance of the cost range; PERT uses the classic ((b−a)/6)² form. */
export function distributionVariance(q: RiskQuantInput): number {
  const { cost_low: a, cost_most_likely: m, cost_high: b } = q;
  if (q.distribution === "pert") return ((b - a) / 6) ** 2;
  return (a * a + m * m + b * b - a * m - a * b - m * b) / 18;
}

/** Probability-weighted expected value of a single risk. */
export function expectedValue(q: RiskQuantInput): number {
  return roundMoney((q.probability_pct / 100) * distributionMean(q));
}

/**
 * Variance of a Bernoulli-gated cost: Var = p·σ² + p(1−p)·μ².
 * Closed and realized risks are excluded upstream, not here.
 */
export function riskVariance(q: RiskQuantInput): number {
  const p = q.probability_pct / 100;
  const mu = distributionMean(q);
  return p * distributionVariance(q) + p * (1 - p) * mu * mu;
}

function isForwardLooking(q: RiskQuantInput): boolean {
  return q.risk_status !== "closed" && q.risk_status !== "realized";
}

/**
 * Aggregate independent risks into deterministic P50/P80 bands by moment
 * matching (no sampling, so the result is stable and auditable).
 */
export function aggregateExposure(quants: RiskQuantInput[]): ExposureState {
  const rows = quants.filter(isForwardLooking);
  const meanMinor = rows.reduce((acc, q) => acc + toMinor(expectedValue(q)), 0);
  const mean = fromMinor(meanMinor);
  const variance = rows.reduce((acc, q) => acc + riskVariance(q), 0);
  const sigma = Math.sqrt(Math.max(variance, 0));
  const days = rows.reduce((acc, q) => acc + (q.probability_pct / 100) * q.schedule_days_impact, 0);
  return {
    quantified: rows.length,
    expected_value: mean,
    p50: roundMoney(mean + Z_P50 * sigma),
    p80: roundMoney(mean + Z_P80 * sigma),
    sigma: roundMoney(sigma),
    schedule_days_expected: roundMoney(days, 1),
  };
}

/** Is the remaining contingency enough to cover the P80 exposure? */
export function assessAdequacy(balance: number, exposure: ExposureState): AdequacyState {
  const p80 = exposure.p80;
  if (p80 <= 0) {
    return { balance, p80, cover_ratio: null, tone: balance < 0 ? "bad" : "neutral" };
  }
  const ratio = roundMoney(balance / p80, 2);
  const tone: AdequacyState["tone"] =
    ratio >= ADEQUACY_HEALTHY ? "good" : ratio >= ADEQUACY_WATCH ? "warning" : "bad";
  return { balance, p80, cover_ratio: ratio, tone };
}

export function utilizationTone(pct: number | null): "good" | "warning" | "neutral" {
  if (pct === null) return "neutral";
  return pct >= UTILIZATION_WARN_PCT ? "warning" : "good";
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date YYYY-MM-DD");
const currency = z.string().trim().regex(/^[A-Z]{3}$/, "3-letter ISO code");
const money = z.number().min(0).max(1_000_000_000_000);

export const poolWritableSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  basis: z.string().trim().max(2000).nullable().optional(),
  cost_code_id: z.string().uuid().nullable().optional(),
  currency_code: currency,
  original_amount: money,
  status: z.enum(POOL_STATUSES).default("draft"),
});

export const poolCreateSchema = poolWritableSchema.extend({
  project_id: z.string().uuid(),
});
export type PoolCreateInput = z.infer<typeof poolCreateSchema>;

export const poolUpdateSchema = poolWritableSchema.partial().extend({
  id: z.string().uuid(),
});
export type PoolUpdateInput = z.infer<typeof poolUpdateSchema>;

export const movementCreateSchema = z
  .object({
    project_id: z.string().uuid(),
    pool_id: z.string().uuid(),
    kind: z.enum(MOVEMENT_KINDS),
    amount: z.number().positive().max(1_000_000_000_000),
    currency_code: currency,
    effective_date: isoDate,
    reason: z.string().trim().min(1, "A reason is required").max(2000),
    risk_id: z.string().uuid().nullable().optional(),
    change_order_id: z.string().uuid().nullable().optional(),
    counterparty_pool_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      (v.kind !== "transfer_in" && v.kind !== "transfer_out") || Boolean(v.counterparty_pool_id),
    { message: "Transfers need a counterparty pool.", path: ["counterparty_pool_id"] },
  )
  .refine((v) => v.counterparty_pool_id !== v.pool_id, {
    message: "A pool cannot transfer to itself.",
    path: ["counterparty_pool_id"],
  });
export type MovementCreateInput = z.infer<typeof movementCreateSchema>;

export const movementDecisionSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["approved", "rejected"]),
    decision_note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.status !== "rejected" || Boolean(v.decision_note), {
    message: "A note is required when rejecting a movement.",
    path: ["decision_note"],
  });
export type MovementDecisionInput = z.infer<typeof movementDecisionSchema>;

export const riskQuantSchema = z
  .object({
    project_id: z.string().uuid(),
    risk_id: z.string().uuid(),
    currency_code: currency,
    cost_low: money,
    cost_most_likely: money,
    cost_high: money,
    probability_pct: z.number().min(0).max(100),
    schedule_days_impact: z.number().int().min(0).max(3650).default(0),
    distribution: z.enum(RISK_DISTRIBUTIONS).default("triangular"),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => v.cost_low <= v.cost_most_likely && v.cost_most_likely <= v.cost_high, {
    message: "Cost range must satisfy low ≤ most likely ≤ high.",
    path: ["cost_high"],
  });
export type RiskQuantWriteInput = z.infer<typeof riskQuantSchema>;
