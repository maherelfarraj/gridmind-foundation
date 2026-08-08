// GC-17 — Governed risk & contingency drawdown: deterministic quantitative core.
//
// This module is PURE and deterministic. Given the same inputs, seed and
// iteration count it always produces byte-identical results, on server or in a
// test. It never touches the database and never mutates authoritative costing,
// EVM, cash-flow, recognition, contract/claim or FX data.
//
// Sampling uses inverse-CDF transforms driven by a seeded uniform stream so a
// Gaussian copula can impose correlation across risks without changing the
// marginal distributions.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const SIM_ENGINE = "gridmind-mc";
export const SIM_ENGINE_VERSION = "1.0.0";

export const DISTRIBUTION_KINDS = [
  "triangular",
  "pert",
  "uniform",
  "normal",
  "lognormal",
  "discrete",
] as const;
export type DistributionKind = (typeof DISTRIBUTION_KINDS)[number];

export const SIM_SCOPES = ["cost", "schedule", "joint"] as const;
export type SimScope = (typeof SIM_SCOPES)[number];

export const SIM_STATUSES = ["draft", "approved", "superseded", "rejected"] as const;
export type SimStatus = (typeof SIM_STATUSES)[number];

export const MIN_ITERATIONS = 1000;
export const MAX_ITERATIONS = 200000;
export const DEFAULT_ITERATIONS = 10000;

/** Within-group Gaussian copula correlation for named correlation groups. */
export const GROUP_CORRELATION = 0.6;

/** Simulation is stale beyond this many days. */
export const SIM_STALE_DAYS = 30;

export const SIM_FORMULAS = {
  sampling:
    "each risk draws one uniform u ∈ (0,1) per iteration and is inverted through its own CDF; a Bernoulli(probability) gate decides occurrence.",
  correlation:
    "risks sharing a correlation group are coupled by a Gaussian copula: z = √ρ·Z_group + √(1−ρ)·Z_risk, u = Φ(z), with ρ = 0.6.",
  percentile:
    "P(x) is the nearest-rank percentile of the sorted iteration totals (index = ceil(x/100 × n) − 1).",
  precision: "standard error = σ / √n; relative precision = 1.96 × standard error ÷ mean.",
  tornado:
    "sensitivity rank = Pearson correlation between a risk's per-iteration contribution and the iteration total.",
  adequacy:
    "cover ratio = available contingency ÷ P-value exposure; headroom = available − P-value exposure.",
} as const;

// ---------------------------------------------------------------------------
// Seeded RNG — mulberry32 (32-bit, reproducible across engines)
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Open interval (0,1): inverse transforms reject the exact endpoints. */
function openUniform(rng: () => number): number {
  const u = rng();
  if (u <= 0) return Number.EPSILON;
  if (u >= 1) return 1 - Number.EPSILON;
  return u;
}

/** Acklam inverse standard-normal CDF — deterministic, ~1e-9 absolute error. */
export function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw new Error("normInv requires 0 < p < 1");
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  q = p - 0.5;
  const rc = q * q;
  return (
    ((((((a[0]! * rc + a[1]!) * rc + a[2]!) * rc + a[3]!) * rc + a[4]!) * rc + a[5]!) * q) /
    (((((b[0]! * rc + b[1]!) * rc + b[2]!) * rc + b[3]!) * rc + b[4]!) * rc + 1)
  );
}

/** Standard-normal CDF via erf approximation (Abramowitz & Stegun 7.1.26). */
export function normCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// ---------------------------------------------------------------------------
// Distribution definitions + inverse CDFs
// ---------------------------------------------------------------------------
export interface DiscretePoint {
  value: number;
  weight: number;
}

export interface Distribution {
  kind: DistributionKind;
  low: number;
  most_likely: number;
  high: number;
  /** Standard deviation for normal / lognormal. */
  sigma?: number | null;
  points?: DiscretePoint[] | null;
}

export const discretePointSchema = z.object({
  value: z.number().finite(),
  weight: z.number().finite().positive(),
});

export const distributionSchema = z
  .object({
    kind: z.enum(DISTRIBUTION_KINDS),
    low: z.number().finite(),
    most_likely: z.number().finite(),
    high: z.number().finite(),
    sigma: z.number().finite().positive().nullable().optional(),
    points: z.array(discretePointSchema).min(1).nullable().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.kind === "discrete") {
      if (!d.points || d.points.length === 0) {
        ctx.addIssue({ code: "custom", message: "discrete distribution requires points" });
      }
      return;
    }
    if (d.kind === "normal" || d.kind === "lognormal") {
      if (!d.sigma || d.sigma <= 0) {
        ctx.addIssue({ code: "custom", message: `${d.kind} distribution requires sigma > 0` });
      }
      if (d.kind === "lognormal" && d.most_likely <= 0) {
        ctx.addIssue({ code: "custom", message: "lognormal median must be > 0" });
      }
      return;
    }
    if (!(d.low <= d.most_likely && d.most_likely <= d.high)) {
      ctx.addIssue({ code: "custom", message: "requires low ≤ most likely ≤ high" });
    }
    if (d.kind === "uniform" && d.high <= d.low) {
      ctx.addIssue({ code: "custom", message: "uniform distribution requires high > low" });
    }
  });

/** Inverse CDF for one distribution at u ∈ (0,1). */
export function quantile(dist: Distribution, u: number): number {
  const { kind, low, most_likely: ml, high } = dist;
  switch (kind) {
    case "uniform":
      return low + u * (high - low);
    case "triangular": {
      if (high === low) return low;
      const c = (ml - low) / (high - low);
      if (u < c) return low + Math.sqrt(u * (high - low) * (ml - low));
      return high - Math.sqrt((1 - u) * (high - low) * (high - ml));
    }
    case "pert": {
      // Deterministic PERT: beta approximated by the moment-matched normal,
      // clamped to the [low, high] support so the range is never breached.
      const mean = (low + 4 * ml + high) / 6;
      const sd = (high - low) / 6;
      const v = mean + sd * normInv(u);
      return Math.min(high, Math.max(low, v));
    }
    case "normal":
      return ml + (dist.sigma ?? 0) * normInv(u);
    case "lognormal": {
      const mu = Math.log(Math.max(ml, Number.EPSILON));
      return Math.exp(mu + (dist.sigma ?? 0) * normInv(u));
    }
    case "discrete": {
      const pts = dist.points ?? [];
      const total = pts.reduce((s, p) => s + p.weight, 0);
      let acc = 0;
      for (const p of pts) {
        acc += p.weight / total;
        if (u <= acc) return p.value;
      }
      return pts[pts.length - 1]?.value ?? 0;
    }
    default:
      return ml;
  }
}

/** Analytic mean of a distribution (used for expected-value cross-checks). */
export function distributionMean(dist: Distribution): number {
  switch (dist.kind) {
    case "uniform":
      return (dist.low + dist.high) / 2;
    case "triangular":
      return (dist.low + dist.most_likely + dist.high) / 3;
    case "pert":
      return (dist.low + 4 * dist.most_likely + dist.high) / 6;
    case "normal":
      return dist.most_likely;
    case "lognormal":
      return Math.exp(
        Math.log(Math.max(dist.most_likely, Number.EPSILON)) + (dist.sigma ?? 0) ** 2 / 2,
      );
    case "discrete": {
      const pts = dist.points ?? [];
      const total = pts.reduce((s, p) => s + p.weight, 0) || 1;
      return pts.reduce((s, p) => s + (p.value * p.weight) / total, 0);
    }
    default:
      return dist.most_likely;
  }
}

// ---------------------------------------------------------------------------
// Simulation inputs
// ---------------------------------------------------------------------------
export interface SimRiskInput {
  risk_id: string;
  title: string;
  /** 0..100 */
  probability_pct: number;
  currency_code: string;
  /** Multiplier converting source currency to the reporting currency. */
  fx_rate: number;
  cost: Distribution;
  schedule: Distribution;
  correlation_group: string | null;
  /** Opportunities reduce cost/duration. */
  is_opportunity: boolean;
}

export const simRiskInputSchema = z.object({
  risk_id: z.string().uuid(),
  title: z.string().min(1),
  probability_pct: z.number().min(0).max(100),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  fx_rate: z.number().finite().positive(),
  cost: distributionSchema,
  schedule: distributionSchema,
  correlation_group: z.string().trim().min(1).nullable(),
  is_opportunity: z.boolean(),
});

export const simRequestSchema = z.object({
  project_id: z.string().uuid(),
  scope: z.enum(SIM_SCOPES).default("joint"),
  seed: z
    .number()
    .int()
    .min(0)
    .max(2 ** 31 - 1),
  iterations: z.number().int().min(MIN_ITERATIONS).max(MAX_ITERATIONS).default(DEFAULT_ITERATIONS),
  reporting_currency: z.string().regex(/^[A-Z]{3}$/),
  fx_rate_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  budget_threshold: z.number().finite().nonnegative().nullable().default(null),
  schedule_threshold_days: z.number().finite().nonnegative().nullable().default(null),
  assumptions: z.string().max(4000).default(""),
  exclusions: z.string().max(4000).default(""),
  idempotency_key: z.string().min(8).max(120).nullable().default(null),
});
export type SimRequest = z.infer<typeof simRequestSchema>;

/**
 * Rejects double counting and impossible inputs before any iteration runs.
 * Returns human-readable problems; an empty array means the input set is valid.
 */
export function validateSimInputs(risks: SimRiskInput[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of risks) {
    if (seen.has(r.risk_id)) problems.push(`Risk ${r.title} appears twice — double counting.`);
    seen.add(r.risk_id);
    const cost = distributionSchema.safeParse(r.cost);
    if (!cost.success) problems.push(`${r.title}: cost ${cost.error.issues[0]?.message}`);
    const sched = distributionSchema.safeParse(r.schedule);
    if (!sched.success) problems.push(`${r.title}: schedule ${sched.error.issues[0]?.message}`);
    if (r.probability_pct <= 0) problems.push(`${r.title}: probability must be greater than 0.`);
    if (!(r.fx_rate > 0)) problems.push(`${r.title}: missing FX rate to the reporting currency.`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Percentiles + statistics
// ---------------------------------------------------------------------------
export const PERCENTILES = [10, 50, 80, 90, 95] as const;
export type PercentileKey = `p${(typeof PERCENTILES)[number]}`;

/** Nearest-rank percentile over an already-sorted ascending array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface Stats {
  mean: number;
  sd: number;
  min: number;
  max: number;
  p10: number;
  p50: number;
  p80: number;
  p90: number;
  p95: number;
  standard_error: number;
  relative_precision: number;
}

export function summarize(values: number[]): Stats {
  const n = values.length;
  if (n === 0) {
    return {
      mean: 0,
      sd: 0,
      min: 0,
      max: 0,
      p10: 0,
      p50: 0,
      p80: 0,
      p90: 0,
      p95: 0,
      standard_error: 0,
      relative_precision: 0,
    };
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const sorted = [...values].sort((a, b) => a - b);
  const se = n > 0 ? sd / Math.sqrt(n) : 0;
  return {
    mean,
    sd,
    min: sorted[0]!,
    max: sorted[n - 1]!,
    p10: percentileSorted(sorted, 10),
    p50: percentileSorted(sorted, 50),
    p80: percentileSorted(sorted, 80),
    p90: percentileSorted(sorted, 90),
    p95: percentileSorted(sorted, 95),
    standard_error: se,
    relative_precision: mean !== 0 ? (1.96 * se) / Math.abs(mean) : 0,
  };
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

// ---------------------------------------------------------------------------
// Deterministic input checksum (FNV-1a 64-bit, hex)
// ---------------------------------------------------------------------------
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export function checksum(value: unknown): string {
  const s = canonicalize(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------
export interface TornadoEntry {
  risk_id: string;
  title: string;
  correlation: number;
  mean_contribution: number;
  share_pct: number;
}

export interface SimResult {
  engine: string;
  engine_version: string;
  seed: number;
  iterations: number;
  scope: SimScope;
  reporting_currency: string;
  cost: Stats;
  schedule: Stats;
  /** Probability the simulated cost exceeds the supplied budget threshold. */
  prob_exceeds_budget: number | null;
  prob_exceeds_finish: number | null;
  /** Joint cost/schedule band at P80 (cost) and P80 (days). */
  joint_p80: { cost: number; days: number };
  tornado: TornadoEntry[];
  risk_count: number;
  correlation_groups: string[];
  converged: boolean;
}

export function runSimulation(
  risks: SimRiskInput[],
  req: Pick<
    SimRequest,
    | "scope"
    | "seed"
    | "iterations"
    | "reporting_currency"
    | "budget_threshold"
    | "schedule_threshold_days"
  >,
): SimResult {
  const n = req.iterations;
  const groups = Array.from(
    new Set(risks.map((r) => r.correlation_group).filter((g): g is string => !!g)),
  ).sort();

  // One RNG stream per source keeps results stable when unrelated risks change
  // count: streams are keyed by index, and group factors get their own stream.
  const groupRng = new Map<string, () => number>();
  groups.forEach((g, i) => groupRng.set(g, mulberry32(req.seed + 1_000_003 * (i + 1))));

  const occRng = risks.map((_, i) => mulberry32(req.seed + 7919 * (i + 1)));
  const costRng = risks.map((_, i) => mulberry32(req.seed + 104729 * (i + 1)));
  const schedRng = risks.map((_, i) => mulberry32(req.seed + 224737 * (i + 1)));

  const costTotals = new Array<number>(n);
  const schedTotals = new Array<number>(n);
  const contributions: number[][] = risks.map(() => new Array<number>(n).fill(0));
  const rootRho = Math.sqrt(GROUP_CORRELATION);
  const compRho = Math.sqrt(1 - GROUP_CORRELATION);

  for (let it = 0; it < n; it++) {
    const groupZ = new Map<string, number>();
    for (const g of groups) groupZ.set(g, normInv(openUniform(groupRng.get(g)!)));

    let cost = 0;
    let days = 0;
    for (let i = 0; i < risks.length; i++) {
      const r = risks[i]!;
      const occurred = occRng[i]!() * 100 < r.probability_pct;
      if (!occurred) continue;

      const zc = normInv(openUniform(costRng[i]!));
      const zs = normInv(openUniform(schedRng[i]!));
      const gz = r.correlation_group ? (groupZ.get(r.correlation_group) ?? 0) : 0;
      const uc = r.correlation_group ? normCdf(rootRho * gz + compRho * zc) : normCdf(zc);
      const us = r.correlation_group ? normCdf(rootRho * gz + compRho * zs) : normCdf(zs);

      const sign = r.is_opportunity ? -1 : 1;
      const c = sign * quantile(r.cost, Math.min(1 - 1e-12, Math.max(1e-12, uc))) * r.fx_rate;
      const d = sign * quantile(r.schedule, Math.min(1 - 1e-12, Math.max(1e-12, us)));
      cost += c;
      days += d;
      contributions[i]![it] = c;
    }
    costTotals[it] = cost;
    schedTotals[it] = days;
  }

  const cost = summarize(costTotals);
  const schedule = summarize(schedTotals);

  const meanTotal = cost.mean === 0 ? 1 : cost.mean;
  const tornado: TornadoEntry[] = risks
    .map((r, i) => {
      const contrib = contributions[i]!;
      let s = 0;
      for (const v of contrib) s += v;
      const meanContribution = s / n;
      return {
        risk_id: r.risk_id,
        title: r.title,
        correlation: pearson(contrib, costTotals),
        mean_contribution: meanContribution,
        share_pct: (meanContribution / meanTotal) * 100,
      };
    })
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  const countAbove = (values: number[], threshold: number) => {
    let c = 0;
    for (const v of values) if (v > threshold) c++;
    return c / values.length;
  };

  return {
    engine: SIM_ENGINE,
    engine_version: SIM_ENGINE_VERSION,
    seed: req.seed,
    iterations: n,
    scope: req.scope,
    reporting_currency: req.reporting_currency,
    cost,
    schedule,
    prob_exceeds_budget:
      req.budget_threshold === null ? null : countAbove(costTotals, req.budget_threshold),
    prob_exceeds_finish:
      req.schedule_threshold_days === null
        ? null
        : countAbove(schedTotals, req.schedule_threshold_days),
    joint_p80: { cost: cost.p80, days: schedule.p80 },
    tornado,
    risk_count: risks.length,
    correlation_groups: groups,
    converged: cost.relative_precision <= 0.02,
  };
}

// ---------------------------------------------------------------------------
// Contingency adequacy + reconciliation
// ---------------------------------------------------------------------------
export interface AdequacyInput {
  available: number;
  management_reserve: number;
  p50: number;
  p80: number;
  p90: number;
}

export interface AdequacyResult {
  cover_p50: number | null;
  cover_p80: number | null;
  cover_p90: number | null;
  headroom_p80: number;
  shortfall_p80: number;
  /** Cover including management reserve. */
  cover_p80_with_reserve: number | null;
  band: "healthy" | "watch" | "inadequate";
}

export function assessContingencyAdequacy(input: AdequacyInput): AdequacyResult {
  const ratio = (denom: number) => (denom > 0 ? input.available / denom : null);
  const headroom = input.available - input.p80;
  const withReserve =
    input.p80 > 0 ? (input.available + input.management_reserve) / input.p80 : null;
  const cover80 = ratio(input.p80);
  const band: AdequacyResult["band"] =
    cover80 === null || cover80 >= 1 ? "healthy" : cover80 >= 0.75 ? "watch" : "inadequate";
  return {
    cover_p50: ratio(input.p50),
    cover_p80: cover80,
    cover_p90: ratio(input.p90),
    headroom_p80: headroom,
    shortfall_p80: headroom < 0 ? -headroom : 0,
    cover_p80_with_reserve: withReserve,
    band,
  };
}

export interface ReconciliationLine {
  opening: number;
  additions: number;
  transfers_in: number;
  transfers_out: number;
  drawdowns: number;
  releases: number;
}

export interface ReconciliationResult extends ReconciliationLine {
  closing: number;
  balanced: boolean;
}

/** opening + additions + transfers in − transfers out − drawdowns − releases. */
export function reconcileContingency(
  line: ReconciliationLine,
  reportedClosing?: number,
): ReconciliationResult {
  const closing =
    line.opening +
    line.additions +
    line.transfers_in -
    line.transfers_out -
    line.drawdowns -
    line.releases;
  const balanced = reportedClosing === undefined || Math.abs(closing - reportedClosing) < 0.005;
  return { ...line, closing, balanced };
}

/** Drawdown velocity: approved drawdown per elapsed day over the window. */
export function burnRate(
  drawdowns: { effective_date: string; amount: number }[],
  asOf: Date,
): {
  total: number;
  per_day: number;
  spike: boolean;
} {
  if (drawdowns.length === 0) return { total: 0, per_day: 0, spike: false };
  const dates = drawdowns.map((d) => Date.parse(d.effective_date)).filter((n) => !Number.isNaN(n));
  const first = Math.min(...dates);
  const days = Math.max(1, Math.round((asOf.getTime() - first) / 86_400_000));
  const total = drawdowns.reduce((s, d) => s + d.amount, 0);
  const perDay = total / days;
  const last30 = drawdowns
    .filter((d) => asOf.getTime() - Date.parse(d.effective_date) <= 30 * 86_400_000)
    .reduce((s, d) => s + d.amount, 0);
  return { total, per_day: perDay, spike: perDay > 0 && last30 / 30 > perDay * 2 };
}

// ---------------------------------------------------------------------------
// Lifecycle state machines
// ---------------------------------------------------------------------------
export const SIM_TRANSITIONS: Record<SimStatus, SimStatus[]> = {
  draft: ["approved", "rejected"],
  approved: ["superseded"],
  rejected: [],
  superseded: [],
};

export function canTransitionSim(from: SimStatus, to: SimStatus): boolean {
  return (SIM_TRANSITIONS[from] ?? []).includes(to);
}

export const ALERT_FAMILIES = [
  "high_exposure",
  "probability_impact_increase",
  "new_top_contributor",
  "p80_budget_breach",
  "p90_schedule_breach",
  "contingency_inadequacy",
  "burn_rate_spike",
  "unlinked_drawdown",
  "overdue_mitigation",
  "stale_simulation",
  "input_quality",
  "fx_materiality",
  "double_count",
  "funding_mismatch",
  "reserve_expiry",
  "sod_exception",
] as const;
export type AlertFamily = (typeof ALERT_FAMILIES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "snoozed", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  open: ["acknowledged", "snoozed", "resolved"],
  acknowledged: ["snoozed", "resolved"],
  snoozed: ["open", "acknowledged", "resolved"],
  resolved: ["open"],
};

export function canTransitionAlert(from: AlertStatus, to: AlertStatus): boolean {
  return (ALERT_TRANSITIONS[from] ?? []).includes(to);
}

/** Stable de-duplication key for the shared alert register. */
export function alertDedupeKey(
  family: AlertFamily,
  projectId: string | null,
  subject: string,
): string {
  return `gc17:${family}:${projectId ?? "portfolio"}:${subject}`;
}

export interface AlertCandidate {
  family: AlertFamily;
  project_id: string | null;
  subject: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  evidence_entity_type?: string;
  evidence_entity_id?: string;
  payload?: Record<string, unknown>;
}

export interface AlertEvaluationInput {
  project_id: string;
  adequacy: AdequacyResult;
  sim: {
    ran_at: string | null;
    prob_exceeds_budget: number | null;
    prob_exceeds_finish: number | null;
    converged: boolean;
    top_contributor: string | null;
    top_contributor_id: string | null;
  };
  burn: { per_day: number; spike: boolean };
  unlinked_drawdowns: number;
  overdue_mitigations: number;
  input_problems: number;
  missing_fx: number;
  reserve_expiring: number;
  now: Date;
}

/** Deterministic alert derivation — pure, so the register is reproducible. */
export function evaluateAlerts(input: AlertEvaluationInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const pid = input.project_id;
  const push = (c: AlertCandidate) => out.push(c);

  if (input.adequacy.band === "inadequate") {
    push({
      family: "contingency_inadequacy",
      project_id: pid,
      subject: "p80",
      severity: "critical",
      title: "Contingency below P80 exposure",
      detail: `Cover ratio ${(input.adequacy.cover_p80 ?? 0).toFixed(2)} against the approved P80 range.`,
      payload: { shortfall: input.adequacy.shortfall_p80 },
    });
  } else if (input.adequacy.band === "watch") {
    push({
      family: "high_exposure",
      project_id: pid,
      subject: "p80",
      severity: "warning",
      title: "Contingency cover under watch",
      detail: `Cover ratio ${(input.adequacy.cover_p80 ?? 0).toFixed(2)}.`,
    });
  }

  if ((input.sim.prob_exceeds_budget ?? 0) > 0.2) {
    push({
      family: "p80_budget_breach",
      project_id: pid,
      subject: "budget",
      severity: "critical",
      title: "Budget exceedance probability above 20%",
      detail: `Simulated probability ${((input.sim.prob_exceeds_budget ?? 0) * 100).toFixed(1)}%.`,
    });
  }
  if ((input.sim.prob_exceeds_finish ?? 0) > 0.1) {
    push({
      family: "p90_schedule_breach",
      project_id: pid,
      subject: "finish",
      severity: "warning",
      title: "Schedule exceedance probability above 10%",
      detail: `Simulated probability ${((input.sim.prob_exceeds_finish ?? 0) * 100).toFixed(1)}%.`,
    });
  }
  if (input.sim.top_contributor && input.sim.top_contributor_id) {
    push({
      family: "new_top_contributor",
      project_id: pid,
      subject: input.sim.top_contributor_id,
      severity: "info",
      title: `Top risk contributor: ${input.sim.top_contributor}`,
      detail: "Highest sensitivity to total simulated cost.",
      evidence_entity_type: "risk",
      evidence_entity_id: input.sim.top_contributor_id,
    });
  }
  if (!input.sim.ran_at) {
    push({
      family: "stale_simulation",
      project_id: pid,
      subject: "none",
      severity: "warning",
      title: "No approved simulation",
      detail: "Quantitative ranges have never been approved for this project.",
    });
  } else {
    const ageDays = Math.floor((input.now.getTime() - Date.parse(input.sim.ran_at)) / 86_400_000);
    if (ageDays > SIM_STALE_DAYS) {
      push({
        family: "stale_simulation",
        project_id: pid,
        subject: "age",
        severity: "warning",
        title: "Simulation is stale",
        detail: `Last approved run is ${ageDays} days old.`,
      });
    }
  }
  if (!input.sim.converged) {
    push({
      family: "input_quality",
      project_id: pid,
      subject: "convergence",
      severity: "warning",
      title: "Simulation precision below target",
      detail: "Relative precision exceeds 2% — increase iterations.",
    });
  }
  if (input.burn.spike) {
    push({
      family: "burn_rate_spike",
      project_id: pid,
      subject: "burn",
      severity: "warning",
      title: "Contingency burn-rate spike",
      detail: `Recent drawdown velocity is more than double the run rate (${input.burn.per_day.toFixed(2)}/day).`,
    });
  }
  if (input.unlinked_drawdowns > 0) {
    push({
      family: "unlinked_drawdown",
      project_id: pid,
      subject: "unlinked",
      severity: "critical",
      title: "Drawdowns without a linked risk, claim or change",
      detail: `${input.unlinked_drawdowns} movement(s) lack an authoritative link.`,
    });
  }
  if (input.overdue_mitigations > 0) {
    push({
      family: "overdue_mitigation",
      project_id: pid,
      subject: "overdue",
      severity: "warning",
      title: "Overdue mitigations or reviews",
      detail: `${input.overdue_mitigations} risk(s) past their review or target close date.`,
    });
  }
  if (input.input_problems > 0) {
    push({
      family: "double_count",
      project_id: pid,
      subject: "inputs",
      severity: "warning",
      title: "Quantification input problems",
      detail: `${input.input_problems} validation problem(s) block a clean run.`,
    });
  }
  if (input.missing_fx > 0) {
    push({
      family: "fx_materiality",
      project_id: pid,
      subject: "fx",
      severity: "critical",
      title: "Missing FX rates",
      detail: `${input.missing_fx} risk(s) have no rate to the reporting currency — no silent fallback applied.`,
    });
  }
  if (input.reserve_expiring > 0) {
    push({
      family: "reserve_expiry",
      project_id: pid,
      subject: "reserve",
      severity: "info",
      title: "Management reserve expiring",
      detail: `${input.reserve_expiring} reserve pool(s) expire within 60 days.`,
    });
  }
  return out;
}
