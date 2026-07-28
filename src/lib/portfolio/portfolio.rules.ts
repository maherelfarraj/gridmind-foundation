// P-251 — Portfolio aggregation math (pure, framework-free).
// Doctrine: portfolio ratios are WEIGHTED (sum of numerators / sum of
// denominators). Never average per-project ratios — a 1 MW project must not
// carry the same weight as a 200 MW project.

export interface EvmInput {
  pv: number;
  ev: number;
  ac: number;
  bac?: number;
}

export interface EvmAggregate {
  pv: number;
  ev: number;
  ac: number;
  bac: number;
  spi: number | null;
  cpi: number | null;
  projects_counted: number;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function ratio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

/** Weighted SPI = ΣEV / ΣPV across the portfolio. */
export function weightedSpi(rows: readonly EvmInput[]): number | null {
  return ratio(sum(rows.map((r) => r.ev)), sum(rows.map((r) => r.pv)));
}

/** Weighted CPI = ΣEV / ΣAC across the portfolio. */
export function weightedCpi(rows: readonly EvmInput[]): number | null {
  return ratio(sum(rows.map((r) => r.ev)), sum(rows.map((r) => r.ac)));
}

export function aggregateEvm(rows: readonly EvmInput[]): EvmAggregate {
  return {
    pv: sum(rows.map((r) => r.pv)),
    ev: sum(rows.map((r) => r.ev)),
    ac: sum(rows.map((r) => r.ac)),
    bac: sum(rows.map((r) => r.bac ?? 0)),
    spi: weightedSpi(rows),
    cpi: weightedCpi(rows),
    projects_counted: rows.length,
  };
}

/** TRIR = recordables × 200,000 / exposure hours, hours-weighted across projects. */
export function trir(recordables: number, exposureHours: number): number | null {
  return ratio(recordables * 200000, exposureHours);
}

export interface InvoiceBalanceInput {
  amount: number;
  tax_amount?: number | null;
  paid_amount?: number | null;
}

/** Open balance of an invoice = amount + tax − paid, floored at zero. */
export function openBalance(inv: InvoiceBalanceInput): number {
  const total = inv.amount + (inv.tax_amount ?? 0) - (inv.paid_amount ?? 0);
  return total > 0 ? total : 0;
}

export function sumOpenBalances(rows: readonly InvoiceBalanceInput[]): number {
  return sum(rows.map(openBalance));
}

export interface CashCurvePoint {
  period: string;
  forecast_in: number;
  forecast_out: number;
  actual_in: number;
  actual_out: number;
  forecast_net: number;
  actual_net: number;
}

export interface CashCurveCumulativePoint extends CashCurvePoint {
  cum_forecast_net: number;
  cum_actual_net: number;
}

/** Running totals for the consolidated curve; input must be period-ascending. */
export function withCumulative(points: readonly CashCurvePoint[]): CashCurveCumulativePoint[] {
  let forecast = 0;
  let actual = 0;
  return points.map((p) => {
    forecast += p.forecast_net;
    actual += p.actual_net;
    return { ...p, cum_forecast_net: forecast, cum_actual_net: actual };
  });
}

// P-252 — Performance thresholds for portfolio index tiles/cards.
// >= 0.95 good, 0.85–0.95 warning, < 0.85 bad, null => neutral.
export type PerfTone = "neutral" | "good" | "warning" | "bad";

export const PERF_GOOD = 0.95;
export const PERF_WARN = 0.85;

export function perfTone(index: number | null | undefined): PerfTone {
  if (index === null || index === undefined || !Number.isFinite(index)) return "neutral";
  if (index >= PERF_GOOD) return "good";
  if (index >= PERF_WARN) return "warning";
  return "bad";
}

/** Canonical phase order used by the portfolio gate rail. */
export const PHASE_RAIL = ["development", "ntp", "cod", "handover"] as const;
export type RailPhase = (typeof PHASE_RAIL)[number];

const PHASE_TO_RAIL: Record<string, RailPhase> = {
  development: "development",
  ntp: "ntp",
  engineering: "ntp",
  procurement: "ntp",
  construction: "ntp",
  commissioning: "cod",
  cod: "cod",
  operations: "cod",
  handover: "handover",
  closed: "handover",
};

export function railIndex(phase: string | null | undefined): number {
  const key = PHASE_TO_RAIL[(phase ?? "").toLowerCase()];
  return key ? PHASE_RAIL.indexOf(key) : 0;
}
