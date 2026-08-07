// GC-13 — Governed cash flow, funding and liquidity: deterministic core.
//
// This module is PURE. It never touches the database, never re-rates a frozen
// snapshot and never recomputes authoritative cost. It consumes already
// authoritative rows (actual payments, invoices, accruals, commitments and the
// approved forecast phasing produced by the costing module) and turns them into
// governed cash buckets, liquidity measures and funding headroom.
//
// All money arithmetic goes through the costing minor-unit helpers so that
// project -> CBS -> counterparty -> period and project -> portfolio totals
// reconcile exactly.
import { z } from "zod";
import { fromMinor, roundMoney, toMinor } from "@/lib/costing.fx";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const CASHFLOW_STATUSES = ["working", "submitted", "approved", "superseded"] as const;
export type CashflowStatus = (typeof CASHFLOW_STATUSES)[number];

export const BUCKET_GRANULARITIES = ["month", "week"] as const;
export type BucketGranularity = (typeof BUCKET_GRANULARITIES)[number];

export const CASHFLOW_SOURCES = [
  "actual",
  "invoice",
  "commitment",
  "accrual",
  "forecast",
  "retention",
  "advance",
  "tax",
  "adjustment",
] as const;
export type CashflowSource = (typeof CASHFLOW_SOURCES)[number];

export const DATE_BASES = [
  "actual",
  "due_date",
  "payment_terms",
  "milestone",
  "phasing",
  "fallback",
] as const;
export type DateBasis = (typeof DATE_BASES)[number];

export type CashDirection = "inflow" | "outflow";

/**
 * Source precedence for double-count avoidance, strongest first.
 *
 * A settled payment supersedes the invoice that produced it; an invoice
 * supersedes the accrual and the commitment behind it; an accrual supersedes
 * the remaining forecast for the same cost code and period. Manual governed
 * adjustments are additive by design and never suppress anything.
 */
export const SOURCE_PRECEDENCE: Record<CashflowSource, number> = {
  actual: 100,
  invoice: 80,
  accrual: 60,
  commitment: 40,
  forecast: 20,
  retention: 15,
  advance: 15,
  tax: 10,
  adjustment: 0,
};

export const CASHFLOW_EXCEPTION_CODES = [
  "missing_fx_rate",
  "stale_fx_rate",
  "missing_due_date",
  "missing_payment_terms",
  "fallback_date_used",
  "negative_headroom",
  "unfunded_requirement",
  "unapproved_adjustment",
  "stale_basis",
  "no_forecast_basis",
  "overdue_receipt",
  "facility_expiring",
  "covenant_breach",
  "concentration_risk",
] as const;
export type CashflowExceptionCode = (typeof CASHFLOW_EXCEPTION_CODES)[number];

export type ExceptionSeverity = "blocker" | "warning" | "info";

export type CashJsonValue =
  | string
  | number
  | boolean
  | null
  | CashJsonValue[]
  | { [key: string]: CashJsonValue };

export interface CashflowException {
  code: CashflowExceptionCode;
  severity: ExceptionSeverity;
  message: string;
  context: Record<string, CashJsonValue>;
}

export const CASHFLOW_SNAPSHOT_FROZEN = "cashflow_snapshot_frozen";
export const CASHFLOW_VERSION_CONFLICT = "cashflow_version_conflict";
export const CASHFLOW_APPROVAL_BLOCKED = "cashflow_approval_blocked";

// ---------------------------------------------------------------------------
// Dates and buckets
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;

function utc(iso: string): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? t : NaN;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const t = utc(iso);
  if (!Number.isFinite(t)) return iso;
  return isoOf(t + days * DAY_MS);
}

export function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** ISO weeks start on Monday; bucketing is calendar deterministic and UTC. */
export function weekStart(iso: string): string {
  const t = utc(iso);
  if (!Number.isFinite(t)) return iso;
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  return isoOf(t - back * DAY_MS);
}

export function bucketStartOf(iso: string, granularity: BucketGranularity): string {
  return granularity === "week" ? weekStart(iso) : monthStart(iso);
}

export function bucketEndOf(startIso: string, granularity: BucketGranularity): string {
  if (granularity === "week") return addDays(startIso, 6);
  const y = Number(startIso.slice(0, 4));
  const m = Number(startIso.slice(5, 7));
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return addDays(`${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`, -1);
}

export function nextBucket(startIso: string, granularity: BucketGranularity): string {
  return addDays(bucketEndOf(startIso, granularity), 1);
}

export function enumerateBuckets(
  fromIso: string,
  count: number,
  granularity: BucketGranularity,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = bucketStartOf(fromIso, granularity);
  for (let i = 0; i < Math.max(0, count); i += 1) {
    out.push({ start: cursor, end: bucketEndOf(cursor, granularity) });
    cursor = nextBucket(cursor, granularity);
  }
  return out;
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const a = utc(fromIso);
  const b = utc(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

// ---------------------------------------------------------------------------
// Expected cash date derivation
// ---------------------------------------------------------------------------
export interface ExpectedDateInput {
  /** Settled date; when present nothing else is considered. */
  actualDate?: string | null;
  /** Contractual due date on the document. */
  dueDate?: string | null;
  /** Milestone/schedule date driving the event. */
  milestoneDate?: string | null;
  /** Document date the payment-terms lag is applied to. */
  documentDate?: string | null;
  /** Terms in days (payment_terms_days, PO terms, settings default). */
  termsDays?: number | null;
  /** Period bucket used when nothing else is known. */
  fallbackDate: string;
}

export interface ExpectedDate {
  date: string;
  basis: DateBasis;
}

/**
 * Deterministic waterfall: settled date -> contractual due date -> milestone ->
 * document date + terms -> declared fallback. The chosen basis is always
 * reported so the UI and the pack can show why a bucket was picked.
 */
export function expectedCashDate(input: ExpectedDateInput): ExpectedDate {
  if (input.actualDate) return { date: input.actualDate.slice(0, 10), basis: "actual" };
  if (input.dueDate) return { date: input.dueDate.slice(0, 10), basis: "due_date" };
  if (input.milestoneDate) return { date: input.milestoneDate.slice(0, 10), basis: "milestone" };
  if (input.documentDate && input.termsDays != null && Number.isFinite(input.termsDays)) {
    return { date: addDays(input.documentDate.slice(0, 10), Number(input.termsDays)), basis: "payment_terms" };
  }
  return { date: input.fallbackDate.slice(0, 10), basis: "fallback" };
}

// ---------------------------------------------------------------------------
// Cash lines
// ---------------------------------------------------------------------------
export interface CashLine {
  key: string;
  direction: CashDirection;
  source: CashflowSource;
  category: string;
  counterparty: string | null;
  cost_code_id: string | null;
  date: string;
  date_basis: DateBasis;
  amount_native: number;
  currency_code: string;
  fx_rate: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  fx_stale: boolean;
  amount_reporting: number;
  reference_type: string | null;
  reference_id: string | null;
  /**
   * Identity of the underlying economic event. Two lines sharing a
   * `suppression_key` are the same money seen through different lenses; only
   * the strongest source survives.
   */
  suppression_key?: string | null;
}

/**
 * Remove double counting. Within one `suppression_key` only the highest
 * precedence source survives; manual adjustments never participate.
 */
export function dedupeLines(lines: readonly CashLine[]): {
  kept: CashLine[];
  suppressed: CashLine[];
} {
  const best = new Map<string, number>();
  for (const l of lines) {
    if (l.source === "adjustment" || !l.suppression_key) continue;
    const rank = SOURCE_PRECEDENCE[l.source];
    const cur = best.get(l.suppression_key);
    if (cur === undefined || rank > cur) best.set(l.suppression_key, rank);
  }
  const kept: CashLine[] = [];
  const suppressed: CashLine[] = [];
  for (const l of lines) {
    if (l.source === "adjustment" || !l.suppression_key) {
      kept.push(l);
      continue;
    }
    if (SOURCE_PRECEDENCE[l.source] === best.get(l.suppression_key)) kept.push(l);
    else suppressed.push(l);
  }
  return { kept, suppressed };
}

// ---------------------------------------------------------------------------
// Bucketing and measures
// ---------------------------------------------------------------------------
export interface CashBucket {
  start: string;
  end: string;
  inflow: number;
  outflow: number;
  net: number;
  cumulative: number;
  closing_cash: number;
}

export interface BucketOptions {
  granularity: BucketGranularity;
  from: string;
  count: number;
  openingCash: number;
}

export function buildBuckets(lines: readonly CashLine[], opts: BucketOptions): CashBucket[] {
  const frame = enumerateBuckets(opts.from, opts.count, opts.granularity);
  const index = new Map<string, { in: number; out: number }>();
  for (const b of frame) index.set(b.start, { in: 0, out: 0 });

  const firstStart = frame[0]?.start ?? bucketStartOf(opts.from, opts.granularity);
  const lastStart = frame[frame.length - 1]?.start ?? firstStart;

  for (const l of lines) {
    let start = bucketStartOf(l.date, opts.granularity);
    // Clamp outside the horizon so nothing is silently dropped from totals.
    if (utc(start) < utc(firstStart)) start = firstStart;
    if (utc(start) > utc(lastStart)) start = lastStart;
    const cell = index.get(start);
    if (!cell) continue;
    const minor = toMinor(l.amount_reporting);
    if (l.direction === "inflow") cell.in += minor;
    else cell.out += minor;
  }

  let cumulativeMinor = 0;
  const openingMinor = toMinor(opts.openingCash);
  return frame.map((b) => {
    const cell = index.get(b.start) ?? { in: 0, out: 0 };
    const netMinor = cell.in - cell.out;
    cumulativeMinor += netMinor;
    return {
      start: b.start,
      end: b.end,
      inflow: fromMinor(cell.in),
      outflow: fromMinor(cell.out),
      net: fromMinor(netMinor),
      cumulative: fromMinor(cumulativeMinor),
      closing_cash: fromMinor(openingMinor + cumulativeMinor),
    };
  });
}

export interface LiquidityMeasures {
  opening_cash: number;
  total_inflow: number;
  total_outflow: number;
  net_cash_flow: number;
  closing_cash: number;
  peak_funding_need: number;
  peak_funding_bucket: string | null;
  minimum_liquidity: number;
  minimum_liquidity_bucket: string | null;
  burn_rate: number;
  runway_buckets: number | null;
  first_shortfall_bucket: string | null;
}

/**
 * Peak funding need is the deepest cash trough below zero, expressed positive.
 * Burn rate averages net outflow across buckets that consumed cash; runway is
 * how many further buckets the closing balance sustains at that rate.
 */
export function computeLiquidity(
  buckets: readonly CashBucket[],
  openingCash: number,
): LiquidityMeasures {
  const openingMinor = toMinor(openingCash);
  let inMinor = 0;
  let outMinor = 0;
  let worst = Number.POSITIVE_INFINITY;
  let worstBucket: string | null = null;
  let firstShortfall: string | null = null;
  let burnMinor = 0;
  let burnBuckets = 0;

  for (const b of buckets) {
    inMinor += toMinor(b.inflow);
    outMinor += toMinor(b.outflow);
    const closing = toMinor(b.closing_cash);
    if (closing < worst) {
      worst = closing;
      worstBucket = b.start;
    }
    if (closing < 0 && firstShortfall === null) firstShortfall = b.start;
    const net = toMinor(b.net);
    if (net < 0) {
      burnMinor += -net;
      burnBuckets += 1;
    }
  }

  if (!Number.isFinite(worst)) worst = openingMinor;
  const closingMinor = openingMinor + inMinor - outMinor;
  const burnRate = burnBuckets > 0 ? fromMinor(Math.round(burnMinor / burnBuckets)) : 0;
  const runway =
    burnRate > 0 && closingMinor > 0 ? Math.floor(fromMinor(closingMinor) / burnRate) : null;

  return {
    opening_cash: roundMoney(openingCash),
    total_inflow: fromMinor(inMinor),
    total_outflow: fromMinor(outMinor),
    net_cash_flow: fromMinor(inMinor - outMinor),
    closing_cash: fromMinor(closingMinor),
    peak_funding_need: worst < 0 ? fromMinor(-worst) : 0,
    peak_funding_bucket: worst < 0 ? worstBucket : null,
    minimum_liquidity: fromMinor(worst),
    minimum_liquidity_bucket: worstBucket,
    burn_rate: burnRate,
    runway_buckets: runway,
    first_shortfall_bucket: firstShortfall,
  };
}

/** Cash conversion variance: how much of the recognised cost turned into cash. */
export function cashConversionVariance(input: {
  actual_cost: number;
  actual_cash_out: number;
  billed_revenue: number;
  cash_in: number;
}): { payables_lag: number; receivables_lag: number; conversion_pct: number | null } {
  const payables = fromMinor(toMinor(input.actual_cost) - toMinor(input.actual_cash_out));
  const receivables = fromMinor(toMinor(input.billed_revenue) - toMinor(input.cash_in));
  const billed = toMinor(input.billed_revenue);
  const conversion = billed > 0 ? roundMoney((toMinor(input.cash_in) / billed) * 100) : null;
  return { payables_lag: payables, receivables_lag: receivables, conversion_pct: conversion };
}

// ---------------------------------------------------------------------------
// Funding facilities (non-posting model)
// ---------------------------------------------------------------------------
export interface FacilityModel {
  id: string;
  name: string;
  currency_code: string;
  committed_amount: number;
  available_from: string | null;
  expiry_date: string | null;
  status: "planned" | "active" | "expired" | "cancelled";
  drawdown_schedule: { date: string; amount: number }[];
  repayment_schedule: { date: string; amount: number }[];
  covenants: { code: string; label?: string; metric: string; operator: ">=" | "<="; threshold: number }[];
  /** Amount of this facility ring-fenced to the project under review. */
  allocated_amount?: number | null;
  /** Rate into reporting currency; null when unavailable. */
  fx_rate?: number | null;
}

export interface FacilityState {
  id: string;
  name: string;
  currency_code: string;
  committed_reporting: number;
  allocated_reporting: number;
  drawn_reporting: number;
  repaid_reporting: number;
  outstanding_reporting: number;
  headroom_reporting: number;
  utilization_pct: number | null;
  available: boolean;
  expires_in_days: number | null;
  refinancing_window: boolean;
  fx_missing: boolean;
}

const REFINANCING_WINDOW_DAYS = 180;

function scheduleTotal(rows: readonly { date: string; amount: number }[], asOf: string): number {
  let minor = 0;
  for (const r of rows) {
    if (!r?.date || utc(r.date) > utc(asOf)) continue;
    minor += toMinor(Number(r.amount) || 0);
  }
  return minor;
}

export function facilityState(f: FacilityModel, asOf: string): FacilityState {
  const rate = f.fx_rate ?? null;
  const conv = (amount: number) => (rate == null ? 0 : fromMinor(Math.round(toMinor(amount) * rate)));
  const drawnMinor = scheduleTotal(f.drawdown_schedule ?? [], asOf);
  const repaidMinor = scheduleTotal(f.repayment_schedule ?? [], asOf);
  const outstandingNative = fromMinor(Math.max(0, drawnMinor - repaidMinor));
  const allocatedNative = f.allocated_amount ?? f.committed_amount;

  const committed = conv(f.committed_amount);
  const allocated = conv(allocatedNative);
  const outstanding = conv(outstandingNative);
  const headroom = fromMinor(Math.max(0, toMinor(allocated) - toMinor(outstanding)));
  const utilization =
    toMinor(allocated) > 0 ? roundMoney((toMinor(outstanding) / toMinor(allocated)) * 100) : null;

  const expiresIn = f.expiry_date ? daysBetweenIso(asOf, f.expiry_date) : null;
  const startedOk = !f.available_from || utc(f.available_from) <= utc(asOf);
  const notExpired = expiresIn == null || expiresIn >= 0;
  const available = f.status === "active" && startedOk && notExpired;

  return {
    id: f.id,
    name: f.name,
    currency_code: f.currency_code,
    committed_reporting: committed,
    allocated_reporting: allocated,
    drawn_reporting: conv(fromMinor(drawnMinor)),
    repaid_reporting: conv(fromMinor(repaidMinor)),
    outstanding_reporting: outstanding,
    headroom_reporting: headroom,
    utilization_pct: utilization,
    available,
    expires_in_days: expiresIn,
    refinancing_window:
      expiresIn != null && expiresIn >= 0 && expiresIn <= REFINANCING_WINDOW_DAYS,
    fx_missing: rate == null,
  };
}

export interface FundingPosition {
  requirement: number;
  available_funding: number;
  funded_requirement: number;
  unfunded_requirement: number;
  headroom: number;
  utilization_pct: number | null;
  breach: boolean;
  near_breach: boolean;
}

const NEAR_BREACH_PCT = 90;

export function fundingPosition(
  peakFundingNeed: number,
  states: readonly FacilityState[],
  minLiquidity = 0,
): FundingPosition {
  const requirementMinor = toMinor(peakFundingNeed) + toMinor(minLiquidity);
  let availableMinor = 0;
  for (const s of states) if (s.available) availableMinor += toMinor(s.headroom_reporting);
  const funded = Math.min(requirementMinor, availableMinor);
  const unfunded = Math.max(0, requirementMinor - availableMinor);
  const utilization =
    availableMinor > 0 ? roundMoney((requirementMinor / availableMinor) * 100) : null;
  return {
    requirement: fromMinor(requirementMinor),
    available_funding: fromMinor(availableMinor),
    funded_requirement: fromMinor(funded),
    unfunded_requirement: fromMinor(unfunded),
    headroom: fromMinor(availableMinor - requirementMinor),
    utilization_pct: utilization,
    breach: unfunded > 0,
    near_breach: unfunded === 0 && utilization != null && utilization >= NEAR_BREACH_PCT,
  };
}

export interface CovenantCheck {
  facility_id: string;
  code: string;
  metric: string;
  operator: ">=" | "<=";
  threshold: number;
  value: number | null;
  breached: boolean;
  near_breach: boolean;
}

const COVENANT_NEAR_MARGIN = 0.05;

export function checkCovenants(
  facilities: readonly FacilityModel[],
  metrics: Readonly<Record<string, number>>,
): CovenantCheck[] {
  const out: CovenantCheck[] = [];
  for (const f of facilities) {
    for (const c of f.covenants ?? []) {
      const value = Object.prototype.hasOwnProperty.call(metrics, c.metric)
        ? Number(metrics[c.metric])
        : null;
      const threshold = Number(c.threshold);
      let breached = false;
      let near = false;
      if (value != null && Number.isFinite(value)) {
        breached = c.operator === ">=" ? value < threshold : value > threshold;
        if (!breached) {
          const margin = Math.abs(threshold) * COVENANT_NEAR_MARGIN;
          near =
            c.operator === ">=" ? value - threshold <= margin : threshold - value <= margin;
        }
      }
      out.push({
        facility_id: f.id,
        code: c.code,
        metric: c.metric,
        operator: c.operator,
        threshold,
        value,
        breached,
        near_breach: near,
      });
    }
  }
  return out;
}

export interface MaturityRung {
  bucket: string;
  amount: number;
  facilities: string[];
}

export function maturityLadder(
  facilities: readonly FacilityModel[],
  states: readonly FacilityState[],
  granularity: BucketGranularity = "month",
): MaturityRung[] {
  const byId = new Map(states.map((s) => [s.id, s]));
  const map = new Map<string, { minor: number; ids: string[] }>();
  for (const f of facilities) {
    if (!f.expiry_date) continue;
    const bucket = bucketStartOf(f.expiry_date, granularity);
    const state = byId.get(f.id);
    const cell = map.get(bucket) ?? { minor: 0, ids: [] };
    cell.minor += toMinor(state?.outstanding_reporting ?? 0);
    cell.ids.push(f.id);
    map.set(bucket, cell);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, cell]) => ({ bucket, amount: fromMinor(cell.minor), facilities: cell.ids }));
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
export interface ReconciliationRow {
  dimension: "source" | "cost_code" | "counterparty" | "period" | "direction";
  key: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface ReconciliationResult {
  rows: ReconciliationRow[];
  totals: { inflow: number; outflow: number; net: number };
  balanced: boolean;
  differences: { dimension: string; difference: number }[];
}

function groupKey(l: CashLine, dim: ReconciliationRow["dimension"], granularity: BucketGranularity) {
  switch (dim) {
    case "source":
      return l.source;
    case "cost_code":
      return l.cost_code_id ?? "unassigned";
    case "counterparty":
      return l.counterparty ?? "unassigned";
    case "period":
      return bucketStartOf(l.date, granularity);
    default:
      return l.direction;
  }
}

/**
 * Reconcile every analytical dimension back to the same grand total using
 * integer minor units. Any non-zero difference is a hard defect, not a
 * rounding tolerance.
 */
export function reconcileCashflow(
  lines: readonly CashLine[],
  granularity: BucketGranularity = "month",
): ReconciliationResult {
  const dims: ReconciliationRow["dimension"][] = [
    "source",
    "cost_code",
    "counterparty",
    "period",
    "direction",
  ];
  let inMinor = 0;
  let outMinor = 0;
  for (const l of lines) {
    if (l.direction === "inflow") inMinor += toMinor(l.amount_reporting);
    else outMinor += toMinor(l.amount_reporting);
  }

  const rows: ReconciliationRow[] = [];
  const differences: { dimension: string; difference: number }[] = [];

  for (const dim of dims) {
    const map = new Map<string, { in: number; out: number }>();
    for (const l of lines) {
      const key = groupKey(l, dim, granularity);
      const cell = map.get(key) ?? { in: 0, out: 0 };
      if (l.direction === "inflow") cell.in += toMinor(l.amount_reporting);
      else cell.out += toMinor(l.amount_reporting);
      map.set(key, cell);
    }
    let dimIn = 0;
    let dimOut = 0;
    for (const [key, cell] of [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      dimIn += cell.in;
      dimOut += cell.out;
      rows.push({
        dimension: dim,
        key,
        inflow: fromMinor(cell.in),
        outflow: fromMinor(cell.out),
        net: fromMinor(cell.in - cell.out),
      });
    }
    const diff = dimIn - inMinor - (dimOut - outMinor);
    if (diff !== 0) differences.push({ dimension: dim, difference: fromMinor(diff) });
  }

  return {
    rows,
    totals: {
      inflow: fromMinor(inMinor),
      outflow: fromMinor(outMinor),
      net: fromMinor(inMinor - outMinor),
    },
    balanced: differences.length === 0,
    differences,
  };
}

// ---------------------------------------------------------------------------
// Portfolio consolidation
// ---------------------------------------------------------------------------
export interface PortfolioCashRow {
  project_id: string;
  project_code: string;
  project_name: string;
  status: CashflowStatus | null;
  basis: "approved" | "indicative" | "none";
  reporting_currency: string;
  project_currency: string;
  fx_rate: number | null;
  fx_missing: boolean;
  buckets: CashBucket[];
  measures: LiquidityMeasures;
  funding: FundingPosition;
}

export interface PortfolioCashTotals {
  peak_funding_need: number;
  minimum_liquidity: number;
  net_cash_flow: number;
  unfunded_requirement: number;
  available_funding: number;
  headroom: number;
  projects: number;
  approved_projects: number;
  fx_missing_projects: string[];
}

/**
 * Deterministic consolidation across mixed project and facility currencies:
 * each project is translated once at its declared snapshot rate, never
 * re-rated, and projects without a usable rate are excluded from money totals
 * while being reported explicitly.
 */
export function consolidatePortfolio(rows: readonly PortfolioCashRow[]): PortfolioCashTotals {
  let peak = 0;
  let minLiq = 0;
  let net = 0;
  let unfunded = 0;
  let available = 0;
  let approved = 0;
  const fxMissing: string[] = [];

  for (const r of rows) {
    if (r.status === "approved") approved += 1;
    if (r.fx_missing || r.fx_rate == null) {
      fxMissing.push(r.project_id);
      continue;
    }
    peak += toMinor(r.measures.peak_funding_need);
    minLiq += toMinor(r.measures.minimum_liquidity);
    net += toMinor(r.measures.net_cash_flow);
    unfunded += toMinor(r.funding.unfunded_requirement);
    available += toMinor(r.funding.available_funding);
  }

  return {
    peak_funding_need: fromMinor(peak),
    minimum_liquidity: fromMinor(minLiq),
    net_cash_flow: fromMinor(net),
    unfunded_requirement: fromMinor(unfunded),
    available_funding: fromMinor(available),
    headroom: fromMinor(available - peak),
    projects: rows.length,
    approved_projects: approved,
    fx_missing_projects: fxMissing,
  };
}

export interface ConcentrationRow {
  key: string;
  amount: number;
  share_pct: number;
}

export function concentration(
  entries: readonly { key: string; amount: number }[],
): ConcentrationRow[] {
  let total = 0;
  const map = new Map<string, number>();
  for (const e of entries) {
    const minor = toMinor(e.amount);
    total += minor;
    map.set(e.key, (map.get(e.key) ?? 0) + minor);
  }
  return [...map.entries()]
    .map(([key, minor]) => ({
      key,
      amount: fromMinor(minor),
      share_pct: total > 0 ? roundMoney((minor / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Scenarios (non-posting overlay)
// ---------------------------------------------------------------------------
export interface CashScenarioAssumptions {
  receipt_delay_days?: number;
  payment_delay_days?: number;
  cost_phasing_shift_days?: number;
  fx_shock_pct?: number;
  facility_change_pct?: number;
  contingency_draw_amount?: number;
  contingency_draw_date?: string | null;
}

/**
 * Apply a scenario to a COPY of the approved lines. The inputs are never
 * mutated, nothing is written back, and the official snapshot is untouched.
 */
export function applyCashScenario(
  lines: readonly CashLine[],
  a: CashScenarioAssumptions,
): CashLine[] {
  const shocked = 1 + (a.fx_shock_pct ?? 0) / 100;
  const out = lines.map((l) => {
    let date = l.date;
    if (l.direction === "inflow" && a.receipt_delay_days) date = addDays(date, a.receipt_delay_days);
    if (l.direction === "outflow" && a.payment_delay_days) date = addDays(date, a.payment_delay_days);
    if (l.source === "forecast" && a.cost_phasing_shift_days)
      date = addDays(date, a.cost_phasing_shift_days);
    const reporting =
      l.currency_code === "" || shocked === 1
        ? l.amount_reporting
        : fromMinor(Math.round(toMinor(l.amount_reporting) * shocked));
    return { ...l, date, amount_reporting: reporting };
  });

  if (a.contingency_draw_amount && a.contingency_draw_date) {
    out.push({
      key: `scenario-contingency-${a.contingency_draw_date}`,
      direction: "inflow",
      source: "adjustment",
      category: "contingency_draw",
      counterparty: null,
      cost_code_id: null,
      date: a.contingency_draw_date,
      date_basis: "phasing",
      amount_native: roundMoney(a.contingency_draw_amount),
      currency_code: "",
      fx_rate: 1,
      fx_rate_date: a.contingency_draw_date,
      fx_source: "parity",
      fx_stale: false,
      amount_reporting: roundMoney(a.contingency_draw_amount),
      reference_type: "scenario",
      reference_id: null,
      suppression_key: null,
    });
  }
  return out;
}

export interface ScenarioComparison {
  metric: string;
  basis: number | null;
  scenario: number | null;
  delta: number | null;
}

export function compareScenario(
  basis: { measures: LiquidityMeasures; funding: FundingPosition },
  scenario: { measures: LiquidityMeasures; funding: FundingPosition },
): ScenarioComparison[] {
  const pair = (metric: string, a: number | null, b: number | null): ScenarioComparison => ({
    metric,
    basis: a,
    scenario: b,
    delta: a == null || b == null ? null : fromMinor(toMinor(b) - toMinor(a)),
  });
  return [
    pair("peak_funding_need", basis.measures.peak_funding_need, scenario.measures.peak_funding_need),
    pair("minimum_liquidity", basis.measures.minimum_liquidity, scenario.measures.minimum_liquidity),
    pair("net_cash_flow", basis.measures.net_cash_flow, scenario.measures.net_cash_flow),
    pair("headroom", basis.funding.headroom, scenario.funding.headroom),
    pair("unfunded_requirement", basis.funding.unfunded_requirement, scenario.funding.unfunded_requirement),
    {
      metric: "runway_buckets",
      basis: basis.measures.runway_buckets,
      scenario: scenario.measures.runway_buckets,
      delta:
        basis.measures.runway_buckets == null || scenario.measures.runway_buckets == null
          ? null
          : scenario.measures.runway_buckets - basis.measures.runway_buckets,
    },
    {
      metric: "first_shortfall_bucket",
      basis: null,
      scenario: null,
      delta: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Exceptions and alerts
// ---------------------------------------------------------------------------
export interface QualityFacts {
  fxMissingCurrencies: string[];
  fxStaleCurrencies: string[];
  fallbackDatedLines: number;
  totalLines: number;
  hasForecastBasis: boolean;
  basisAgeDays: number | null;
  unapprovedAdjustments: number;
  reconciliationBalanced: boolean;
  overdueReceipts: number;
  funding: FundingPosition;
  covenants: CovenantCheck[];
  facilities: FacilityState[];
  concentrationTop?: ConcentrationRow | null;
}

const STALE_BASIS_DAYS = 45;
const CONCENTRATION_LIMIT_PCT = 40;

export function assessCashQuality(f: QualityFacts): CashflowException[] {
  const out: CashflowException[] = [];
  const push = (
    code: CashflowExceptionCode,
    severity: ExceptionSeverity,
    message: string,
    context: Record<string, CashJsonValue> = {},
  ) => out.push({ code, severity, message, context });

  if (f.fxMissingCurrencies.length > 0)
    push("missing_fx_rate", "blocker", "Required exchange rates are missing.", {
      currencies: f.fxMissingCurrencies,
    });
  if (f.fxStaleCurrencies.length > 0)
    push("stale_fx_rate", "warning", "Exchange rates are older than the staleness limit.", {
      currencies: f.fxStaleCurrencies,
    });
  if (!f.reconciliationBalanced)
    push("stale_basis", "blocker", "Source reconciliation does not balance.", {});
  if (!f.hasForecastBasis)
    push("no_forecast_basis", "warning", "No approved forecast version anchors this snapshot.", {});
  if (f.basisAgeDays != null && f.basisAgeDays > STALE_BASIS_DAYS)
    push("stale_basis", "warning", "The underlying cost basis is stale.", {
      age_days: f.basisAgeDays,
    });
  if (f.fallbackDatedLines > 0)
    push("fallback_date_used", "warning", "Some cash events fell back to the period bucket date.", {
      lines: f.fallbackDatedLines,
      total: f.totalLines,
    });
  if (f.unapprovedAdjustments > 0)
    push("unapproved_adjustment", "warning", "Manual adjustments are awaiting authorization.", {
      count: f.unapprovedAdjustments,
    });
  if (f.overdueReceipts > 0)
    push("overdue_receipt", "warning", "Expected receipts are past their due date.", {
      count: f.overdueReceipts,
    });
  if (f.funding.unfunded_requirement > 0)
    push("unfunded_requirement", "blocker", "Peak funding need exceeds available facilities.", {
      unfunded: f.funding.unfunded_requirement,
    });
  else if (f.funding.headroom < 0)
    push("negative_headroom", "blocker", "Funding headroom is negative.", {
      headroom: f.funding.headroom,
    });
  for (const c of f.covenants) {
    const covenantCtx: Record<string, CashJsonValue> = {
      facility_id: c.facility_id,
      code: c.code,
      metric: c.metric,
      operator: c.operator,
      threshold: c.threshold,
      value: c.value,
    };
    if (c.breached)
      push("covenant_breach", "blocker", `Covenant ${c.code} is breached.`, covenantCtx);
    else if (c.near_breach)
      push("covenant_breach", "warning", `Covenant ${c.code} is close to its threshold.`, covenantCtx);
  }
  for (const s of f.facilities) {
    if (s.refinancing_window)
      push("facility_expiring", "warning", `Facility ${s.name} enters its refinancing window.`, {
        facility_id: s.id,
        expires_in_days: s.expires_in_days,
      });
  }
  if (f.concentrationTop && f.concentrationTop.share_pct > CONCENTRATION_LIMIT_PCT)
    push("concentration_risk", "info", "Cash exposure is concentrated on one counterparty.", {
      key: f.concentrationTop.key,
      share_pct: f.concentrationTop.share_pct,
    });

  return out;
}

/** Stable dedupe identity so repeated calculations do not spam the alert feed. */
export function cashAlertFingerprint(input: {
  projectId: string;
  period: string;
  code: string;
  key?: string | null;
}): string {
  return [input.projectId, input.period, input.code, input.key ?? ""].join("|");
}

export function dedupeExceptions(list: readonly CashflowException[]): CashflowException[] {
  const seen = new Set<string>();
  const out: CashflowException[] = [];
  for (const e of list) {
    const id = `${e.code}|${JSON.stringify(e.context)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

export function hasBlocker(list: readonly CashflowException[]): boolean {
  return list.some((e) => e.severity === "blocker");
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const ALLOWED_TRANSITIONS: Record<CashflowStatus, CashflowStatus[]> = {
  working: ["submitted"],
  submitted: ["working", "approved"],
  approved: ["superseded"],
  superseded: [],
};

export interface TransitionCheck {
  ok: boolean;
  reason?: string;
}

export function checkCashTransition(
  from: CashflowStatus,
  to: CashflowStatus,
  facts: {
    actorId: string;
    preparedBy?: string | null;
    submittedBy?: string | null;
    periodLocked?: boolean;
    blockers?: number;
  },
): TransitionCheck {
  if (!ALLOWED_TRANSITIONS[from].includes(to))
    return { ok: false, reason: "cashflow_invalid_transition" };
  if (to === "approved") {
    if (facts.periodLocked) return { ok: false, reason: "costing_period_locked" };
    if ((facts.blockers ?? 0) > 0) return { ok: false, reason: CASHFLOW_APPROVAL_BLOCKED };
    if (facts.actorId === facts.preparedBy || facts.actorId === facts.submittedBy)
      return { ok: false, reason: "cashflow_self_approval" };
  }
  return { ok: true };
}

export interface SupersedePlan {
  ok: boolean;
  reason?: string;
  nextVersionNo: number;
}

export function cashSupersedePlan(current: {
  status: CashflowStatus;
  version_no: number;
  correction_reason?: string | null;
}): SupersedePlan {
  if (current.status !== "approved")
    return { ok: false, reason: "cashflow_supersede_requires_approved", nextVersionNo: current.version_no };
  if (!current.correction_reason || current.correction_reason.trim().length < 8)
    return { ok: false, reason: "cashflow_correction_reason_required", nextVersionNo: current.version_no };
  return { ok: true, nextVersionNo: current.version_no + 1 };
}

// ---------------------------------------------------------------------------
// Input schemas (shared by server functions and UI forms)
// ---------------------------------------------------------------------------
const monthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "Expected the first day of a month (YYYY-MM-01).");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD).");
const currencySchema = z.string().trim().length(3).toUpperCase();
const reasonSchema = z.string().trim().min(8).max(2000);

export const cashflowQuerySchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema.optional(),
  granularity: z.enum(BUCKET_GRANULARITIES).optional(),
});
export type CashflowQueryInput = z.infer<typeof cashflowQuerySchema>;

export const cashflowSettingsSchema = z.object({
  project_id: z.string().uuid(),
  bucket_granularity: z.enum(BUCKET_GRANULARITIES).optional(),
  horizon_buckets: z.number().int().min(1).max(120).optional(),
  receipt_lag_days: z.number().int().min(0).max(365).optional(),
  payment_lag_days: z.number().int().min(0).max(365).optional(),
  retention_release_lag_days: z.number().int().min(0).max(1095).optional(),
  advance_recovery_pct: z.number().min(0).max(100).optional(),
  include_tax: z.boolean().optional(),
  include_commitments: z.boolean().optional(),
  include_accruals: z.boolean().optional(),
  min_liquidity_amount: z.number().min(0).optional(),
  opening_cash: z.number().optional(),
});
export type CashflowSettingsInput = z.infer<typeof cashflowSettingsSchema>;

export const cashflowCalculateSchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema,
  data_date: dateSchema.optional(),
  granularity: z.enum(BUCKET_GRANULARITIES).optional(),
  horizon_buckets: z.number().int().min(1).max(120).optional(),
  currency: currencySchema.optional(),
  forecast_version_id: z.string().uuid().nullish(),
  evm_report_id: z.string().uuid().nullish(),
});
export type CashflowCalculateInput = z.infer<typeof cashflowCalculateSchema>;

export const cashflowTransitionSchema = z
  .object({
    snapshot_id: z.string().uuid(),
    to: z.enum(CASHFLOW_STATUSES),
    reason: reasonSchema.optional(),
    row_version: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.to === "working" || v.to === "superseded") && !v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required." });
    }
  });
export type CashflowTransitionInput = z.infer<typeof cashflowTransitionSchema>;

export const cashflowSupersedeSchema = z.object({
  snapshot_id: z.string().uuid(),
  reason: reasonSchema,
});

export const cashflowIdSchema = z.object({ id: z.string().uuid() });

export const cashflowAdjustmentDecisionSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["authorize", "void"]),
  reason: z.string().trim().max(2000).optional(),
});

export const cashflowAdjustmentSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid(),
  effective_period: monthSchema,
  bucket_date: dateSchema,
  direction: z.enum(["inflow", "outflow"]),
  category: z.string().trim().min(2).max(80),
  counterparty: z.string().trim().max(160).nullish(),
  amount: z.number().refine((n) => n !== 0, "Amount must not be zero."),
  currency_code: currencySchema,
  reason: reasonSchema,
  evidence_reference: z.string().trim().max(240).nullish(),
});
export type CashflowAdjustmentInput = z.infer<typeof cashflowAdjustmentSchema>;

export const fundingFacilitySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(160),
  lender_name: z.string().trim().max(160).nullish(),
  facility_kind: z.string().trim().max(60).nullish(),
  bank_facility_id: z.string().uuid().nullish(),
  committed_amount: z.number().min(0),
  currency_code: currencySchema,
  available_from: dateSchema.nullish(),
  expiry_date: dateSchema.nullish(),
  status: z.enum(["planned", "active", "expired", "cancelled"]).optional(),
  drawdown_schedule: z.array(z.object({ date: dateSchema, amount: z.number() })).optional(),
  repayment_schedule: z.array(z.object({ date: dateSchema, amount: z.number() })).optional(),
  covenants: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(60),
        label: z.string().trim().max(160).optional(),
        metric: z.string().trim().min(1).max(60),
        operator: z.enum([">=", "<="]),
        threshold: z.number(),
      }),
    )
    .optional(),
  notes: z.string().trim().max(2000).nullish(),
  row_version: z.number().int().positive().optional(),
});
export type FundingFacilityInput = z.infer<typeof fundingFacilitySchema>;

export const fundingAllocationSchema = z.object({
  id: z.string().uuid().optional(),
  facility_id: z.string().uuid(),
  project_id: z.string().uuid(),
  allocated_amount: z.number().min(0),
  currency_code: currencySchema,
  effective_from: dateSchema.nullish(),
  effective_to: dateSchema.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type FundingAllocationInput = z.infer<typeof fundingAllocationSchema>;

export const cashScenarioSchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema.optional(),
  receipt_delay_days: z.number().int().min(-365).max(365).optional(),
  payment_delay_days: z.number().int().min(-365).max(365).optional(),
  cost_phasing_shift_days: z.number().int().min(-365).max(365).optional(),
  fx_shock_pct: z.number().min(-90).max(200).optional(),
  facility_change_pct: z.number().min(-100).max(500).optional(),
  contingency_draw_amount: z.number().min(0).optional(),
  contingency_draw_date: dateSchema.nullish(),
});
export type CashScenarioInput = z.infer<typeof cashScenarioSchema>;

export const portfolioCashFilterSchema = z.object({
  period: monthSchema.optional(),
  granularity: z.enum(BUCKET_GRANULARITIES).optional(),
  currency: currencySchema.optional(),
  project_ids: z.array(z.string().uuid()).max(200).optional(),
  status: z.enum(CASHFLOW_STATUSES).optional(),
  only_approved: z.boolean().optional(),
});
export type PortfolioCashFilter = z.infer<typeof portfolioCashFilterSchema>;

export const cashflowCsvSchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema.optional(),
  kind: z.enum(["buckets", "lines", "reconciliation", "facilities", "exceptions"]),
});
export type CashflowCsvInput = z.infer<typeof cashflowCsvSchema>;
