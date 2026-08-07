// GC-15 — Governed revenue, WIP and percentage-of-completion recognition.
//
// PURE MATH ONLY — no I/O, no Supabase, no React. Everything here is
// deterministic and unit-testable in isolation.
//
// Doctrine (single source of truth for the module):
//   * This layer is NON-POSTING. It never writes journal entries and never
//     mutates contracts, invoices, payments, costing/forecast/EVM snapshots.
//   * Money is rounded HALF-UP at the currency minor unit exactly once, at
//     the point it leaves the engine. Intermediates stay in minor units.
//   * Source precedence for every measure is explicit (see SOURCE_PRECEDENCE)
//     so no amount can be counted twice.
//   * Unapproved variations/claims are NEVER earned in full. They enter only
//     through the governed constraint percentage.
import { z } from "zod";

import { DEFAULT_MINOR_UNIT, roundMoney, toMinor } from "@/lib/costing.fx";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
/** JSON-safe payload type — server functions must return serialisable data. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export const RECOGNITION_DISCLAIMER =
  "Non-posting management information. Recognition figures are governed controls output and do not create, replace or post accounting journal entries.";

export const RECOGNITION_METHODS = [
  "cost_to_cost",
  "milestone",
  "output",
  "straight_line",
  "completed_contract",
  "manual",
] as const;
export type RecognitionMethod = (typeof RECOGNITION_METHODS)[number];

export const RECOGNITION_STATUSES = ["working", "submitted", "approved", "superseded"] as const;
export type RecognitionStatus = (typeof RECOGNITION_STATUSES)[number];

export const PROGRESS_BASES = ["cost", "evm", "milestone", "output", "time", "manual"] as const;
export type ProgressBasis = (typeof PROGRESS_BASES)[number];

export const ADJUSTMENT_KINDS = [
  "revenue",
  "cost",
  "progress",
  "constraint",
  "loss_provision",
  "retention",
  "advance",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

/**
 * Authoritative precedence when the same economic fact is available from more
 * than one system. Lower rank wins; anything of higher rank is *derived* and
 * must never be added on top of a winning source.
 */
export const SOURCE_PRECEDENCE = {
  contract: 0, // signed contract value / approved variation register
  invoice: 1, // issued customer invoices (billings)
  payment: 2, // recorded receipts (cash)
  evm: 3, // approved EVM/progress report
  forecast: 4, // approved cost forecast / EAC
  accrual: 5, // costing accruals
  adjustment: 6, // governed manual recognition adjustment
} as const;
export type RecognitionSource = keyof typeof SOURCE_PRECEDENCE;

export function sourceRank(source: RecognitionSource): number {
  return SOURCE_PRECEDENCE[source];
}

/** Formula strings surfaced in tooltips, the appendix and the audit pack. */
export const RECOGNITION_FORMULAS = {
  transaction_price:
    "Transaction price = base contract value + approved variations + (unapproved variations & claims × constraint %). Unapproved consideration is never earned in full.",
  progress:
    "cost-to-cost: costs incurred ÷ EAC. milestone: Σ achieved milestone value ÷ Σ milestone value. output: certified output %. straight_line: elapsed ÷ total duration. completed_contract: 0 until complete. manual: authorised override only.",
  cumulative_revenue:
    "Cumulative revenue = transaction price × progress %, capped at the transaction price when the policy caps progress at 100%.",
  period_revenue:
    "Current-period revenue = cumulative revenue − prior approved cumulative revenue. Negative movement is a governed reversal exception, never silently suppressed.",
  contract_asset:
    "Contract asset (WIP / underbilling) = max(0, cumulative revenue − billings to date).",
  contract_liability:
    "Contract liability (deferred revenue / overbilling) = max(0, billings to date − cumulative revenue).",
  loss_provision:
    "Expected loss provision = max(0, EAC − transaction price), recognised in full in the period the loss becomes probable.",
  retention: "Retention receivable = billings to date × retention %.",
  advance: "Advance balance = advance received − (billings to date × advance recovery %).",
} as const;

// ---------------------------------------------------------------------------
// Minor-unit safe arithmetic
// ---------------------------------------------------------------------------
const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Sum in integer minor units, then return a rounded major-unit amount. */
export function addMoney(values: readonly number[], minorUnit = DEFAULT_MINOR_UNIT): number {
  const minor = values.reduce((a, v) => a + toMinor(num(v), minorUnit), 0);
  return roundMoney(minor / 10 ** minorUnit, minorUnit);
}

export function subMoney(a: number, b: number, minorUnit = DEFAULT_MINOR_UNIT): number {
  return addMoney([a, -num(b)], minorUnit);
}

/** Multiply money by a unitless ratio with a single rounding step. */
export function scaleMoney(amount: number, ratio: number, minorUnit = DEFAULT_MINOR_UNIT): number {
  if (!Number.isFinite(ratio)) return 0;
  return roundMoney(num(amount) * ratio, minorUnit);
}

/** Percentage of an amount (pct expressed 0..100). */
export function pctOf(amount: number, pct: number, minorUnit = DEFAULT_MINOR_UNIT): number {
  return scaleMoney(amount, num(pct) / 100, minorUnit);
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Ratio with explicit undefined semantics: a zero/invalid denominator is null. */
export function safeRatio(numerator: number, denominator: number): number | null {
  const d = num(denominator);
  if (!Number.isFinite(d) || d === 0) return null;
  return num(numerator) / d;
}

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------
export interface RecognitionMilestone {
  code: string;
  label?: string;
  value: number;
  achieved: boolean;
  achieved_date?: string | null;
}

export interface RecognitionPolicy {
  /** Fallback method when the obligation does not declare one. */
  default_method: RecognitionMethod;
  policy_version: string;
  /** Portion of unapproved variable consideration that may be included (0..100). */
  constraint_pct: number;
  include_unapproved_variations: boolean;
  include_unapproved_claims: boolean;
  loss_provision_enabled: boolean;
  cap_progress_at_100: boolean;
  /** When false, a negative period movement is flagged as an exception. */
  allow_revenue_reversal: boolean;
  minor_unit?: number;
}

export const DEFAULT_POLICY: RecognitionPolicy = {
  default_method: "cost_to_cost",
  policy_version: "v1",
  constraint_pct: 0,
  include_unapproved_variations: false,
  include_unapproved_claims: false,
  loss_provision_enabled: true,
  cap_progress_at_100: true,
  allow_revenue_reversal: false,
  minor_unit: DEFAULT_MINOR_UNIT,
};

export interface ObligationInput {
  id: string;
  code: string;
  label: string;
  contract_id: string | null;
  currency_code: string;
  method?: RecognitionMethod | null;
  progress_basis?: ProgressBasis | null;
  /** Allocated transaction price before variations. */
  base_price: number;
  approved_variations?: number;
  unapproved_variations?: number;
  unapproved_claims?: number;
  /** Obligation-level constraint override (0..100); falls back to the policy. */
  constraint_pct?: number | null;

  cost_incurred?: number;
  cost_to_complete?: number;

  milestones?: RecognitionMilestone[];
  /** Certified output progress 0..1 (output method). */
  output_progress?: number | null;
  /** Approved EVM progress 0..1 (progress_basis = "evm"). */
  evm_progress?: number | null;
  /** Authorised manual progress 0..1 (manual method only). */
  manual_progress?: number | null;

  start_date?: string | null;
  end_date?: string | null;
  /** True once the obligation is fully delivered (completed_contract). */
  is_complete?: boolean;

  prior_revenue?: number;
  billed_to_date?: number;
  cash_received?: number;
  retention_pct?: number;
  advance_amount?: number;
  advance_recovery_pct?: number;

  /** Governed manual adjustments already authorised for this period. */
  adjustments?: { kind: AdjustmentKind; amount: number }[];

  fx_rate?: number | null;
  fx_rate_date?: string | null;
  fx_source?: string | null;
  fx_stale?: boolean;
}

export interface RecognitionLine {
  obligation_id: string;
  code: string;
  label: string;
  contract_id: string | null;
  currency_code: string;
  method: RecognitionMethod;
  progress_basis: ProgressBasis;

  base_price: number;
  approved_variations: number;
  constrained_consideration: number;
  transaction_price: number;

  cost_incurred: number;
  cost_to_complete: number;
  eac: number;

  progress_pct: number;
  progress_capped: boolean;

  prior_revenue: number;
  cumulative_revenue: number;
  period_revenue: number;
  gross_profit: number;
  margin_pct: number | null;
  loss_provision: number;

  billed_to_date: number;
  cash_received: number;
  contract_asset: number;
  contract_liability: number;
  retention_receivable: number;
  advance_balance: number;
  unbilled_receivable: number;
  remaining_revenue: number;

  fx_rate: number | null;
  fx_rate_date: string | null;
  fx_source: string | null;
  fx_stale: boolean;
  cumulative_revenue_reporting: number;
  period_revenue_reporting: number;
  contract_asset_reporting: number;
  contract_liability_reporting: number;

  flags: RecognitionFlag[];
}

export type RecognitionFlag =
  | "revenue_reversal"
  | "loss_making"
  | "progress_capped"
  | "missing_fx"
  | "stale_fx"
  | "unapproved_exposure"
  | "zero_transaction_price"
  | "manual_progress"
  | "overbilled"
  | "underbilled";

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
export function milestoneProgress(milestones: readonly RecognitionMilestone[]): number | null {
  const total = milestones.reduce((a, m) => a + num(m.value), 0);
  if (total <= 0) return null;
  const achieved = milestones.filter((m) => m.achieved).reduce((a, m) => a + num(m.value), 0);
  return clamp01(achieved / total);
}

export function timeProgress(
  start: string | null | undefined,
  end: string | null | undefined,
  asOf: string,
): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  const a = Date.parse(asOf);
  if (!Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(a) || e <= s) return null;
  return clamp01((a - s) / (e - s));
}

export function costToCostProgress(costIncurred: number, eac: number): number | null {
  const r = safeRatio(costIncurred, eac);
  return r === null ? null : r < 0 ? 0 : r;
}

/**
 * Progress for an obligation. Returns null when the method's basis is
 * unavailable — callers must treat null as "no basis" (an exception), never
 * as zero progress.
 */
export function computeProgress(
  o: ObligationInput,
  method: RecognitionMethod,
  asOf: string,
  eac: number,
): number | null {
  switch (method) {
    case "cost_to_cost": {
      if (o.progress_basis === "evm" && o.evm_progress != null) return clamp01(o.evm_progress);
      return costToCostProgress(num(o.cost_incurred), eac);
    }
    case "milestone":
      return milestoneProgress(o.milestones ?? []);
    case "output":
      return o.output_progress == null ? null : clamp01(o.output_progress);
    case "straight_line":
      return timeProgress(o.start_date, o.end_date, asOf);
    case "completed_contract":
      return o.is_complete ? 1 : 0;
    case "manual":
      return o.manual_progress == null ? null : clamp01(o.manual_progress);
  }
}

// ---------------------------------------------------------------------------
// Line engine
// ---------------------------------------------------------------------------
export function computeLine(
  o: ObligationInput,
  policy: RecognitionPolicy,
  asOf: string,
): RecognitionLine {
  const mu = policy.minor_unit ?? DEFAULT_MINOR_UNIT;
  const flags: RecognitionFlag[] = [];
  const method = o.method ?? policy.default_method;
  const basis: ProgressBasis =
    o.progress_basis ??
    (method === "cost_to_cost" ? "cost" : method === "manual" ? "manual" : "output");

  const adj = (kind: AdjustmentKind): number =>
    addMoney(
      (o.adjustments ?? []).filter((a) => a.kind === kind).map((a) => a.amount),
      mu,
    );

  // --- transaction price ---------------------------------------------------
  const base = roundMoney(num(o.base_price), mu);
  const approvedVariations = addMoney([num(o.approved_variations)], mu);
  const constraintPct = o.constraint_pct ?? policy.constraint_pct;
  const unapprovedPool = addMoney(
    [
      policy.include_unapproved_variations ? num(o.unapproved_variations) : 0,
      policy.include_unapproved_claims ? num(o.unapproved_claims) : 0,
    ],
    mu,
  );
  const constrained = addMoney([pctOf(unapprovedPool, constraintPct, mu), adj("constraint")], mu);
  const transactionPrice = addMoney([base, approvedVariations, constrained], mu);

  const exposed = addMoney([num(o.unapproved_variations), num(o.unapproved_claims)], mu);
  if (exposed > constrained) flags.push("unapproved_exposure");
  if (transactionPrice === 0) flags.push("zero_transaction_price");

  // --- cost basis ----------------------------------------------------------
  const costIncurred = addMoney([num(o.cost_incurred), adj("cost")], mu);
  const costToComplete = Math.max(0, roundMoney(num(o.cost_to_complete), mu));
  const eac = addMoney([costIncurred, costToComplete], mu);

  // --- progress ------------------------------------------------------------
  const rawProgress = computeProgress({ ...o, cost_incurred: costIncurred }, method, asOf, eac);
  const progressAdj = num(adj("progress"));
  let progress = (rawProgress ?? 0) + progressAdj;
  let capped = false;
  if (policy.cap_progress_at_100 && progress > 1) {
    progress = 1;
    capped = true;
    flags.push("progress_capped");
  }
  if (progress < 0) progress = 0;
  if (method === "manual" || progressAdj !== 0) flags.push("manual_progress");

  // --- revenue -------------------------------------------------------------
  const priorRevenue = roundMoney(num(o.prior_revenue), mu);
  let cumulative = addMoney([scaleMoney(transactionPrice, progress, mu), adj("revenue")], mu);
  if (policy.cap_progress_at_100 && cumulative > transactionPrice) {
    cumulative = transactionPrice;
    if (!capped) {
      capped = true;
      flags.push("progress_capped");
    }
  }
  const periodRevenue = subMoney(cumulative, priorRevenue, mu);
  if (periodRevenue < 0) flags.push("revenue_reversal");

  const grossProfit = subMoney(cumulative, costIncurred, mu);
  const marginRatio = safeRatio(grossProfit, cumulative);
  const margin = marginRatio === null ? null : marginRatio * 100;

  const forecastLoss = subMoney(eac, transactionPrice, mu);
  const lossProvision =
    policy.loss_provision_enabled && forecastLoss > 0
      ? addMoney([forecastLoss, adj("loss_provision")], mu)
      : Math.max(0, adj("loss_provision"));
  if (forecastLoss > 0) flags.push("loss_making");

  // --- billing / cash ------------------------------------------------------
  const billed = roundMoney(num(o.billed_to_date), mu);
  const cash = roundMoney(num(o.cash_received), mu);
  const contractAsset = Math.max(0, subMoney(cumulative, billed, mu));
  const contractLiability = Math.max(0, subMoney(billed, cumulative, mu));
  if (contractAsset > 0) flags.push("underbilled");
  if (contractLiability > 0) flags.push("overbilled");

  const retention = addMoney([pctOf(billed, num(o.retention_pct), mu), adj("retention")], mu);
  const advanceRecovered = pctOf(billed, num(o.advance_recovery_pct), mu);
  const advanceBalance = Math.max(
    0,
    addMoney([num(o.advance_amount), -advanceRecovered, adj("advance")], mu),
  );
  const remaining = Math.max(0, subMoney(transactionPrice, cumulative, mu));

  // --- FX ------------------------------------------------------------------
  const rate = o.fx_rate ?? null;
  if (rate === null) flags.push("missing_fx");
  else if (o.fx_stale) flags.push("stale_fx");
  const conv = (v: number): number => (rate === null ? 0 : scaleMoney(v, rate, mu));

  return {
    obligation_id: o.id,
    code: o.code,
    label: o.label,
    contract_id: o.contract_id,
    currency_code: o.currency_code,
    method,
    progress_basis: basis,
    base_price: base,
    approved_variations: approvedVariations,
    constrained_consideration: constrained,
    transaction_price: transactionPrice,
    cost_incurred: costIncurred,
    cost_to_complete: costToComplete,
    eac,
    progress_pct: progress,
    progress_capped: capped,
    prior_revenue: priorRevenue,
    cumulative_revenue: cumulative,
    period_revenue: periodRevenue,
    gross_profit: grossProfit,
    margin_pct: margin,
    loss_provision: lossProvision,
    billed_to_date: billed,
    cash_received: cash,
    contract_asset: contractAsset,
    contract_liability: contractLiability,
    retention_receivable: retention,
    advance_balance: advanceBalance,
    unbilled_receivable: contractAsset,
    remaining_revenue: remaining,
    fx_rate: rate,
    fx_rate_date: o.fx_rate_date ?? null,
    fx_source: o.fx_source ?? null,
    fx_stale: Boolean(o.fx_stale),
    cumulative_revenue_reporting: conv(cumulative),
    period_revenue_reporting: conv(periodRevenue),
    contract_asset_reporting: conv(contractAsset),
    contract_liability_reporting: conv(contractLiability),
    flags,
  };
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------
export interface RecognitionTotals {
  obligations: number;
  transaction_price: number;
  approved_variations: number;
  constrained_consideration: number;
  cost_incurred: number;
  eac: number;
  cumulative_revenue: number;
  period_revenue: number;
  gross_profit: number;
  margin_pct: number | null;
  loss_provision: number;
  billed_to_date: number;
  cash_received: number;
  contract_asset: number;
  contract_liability: number;
  retention_receivable: number;
  advance_balance: number;
  remaining_revenue: number;
  progress_pct: number | null;
  reporting: {
    cumulative_revenue: number;
    period_revenue: number;
    contract_asset: number;
    contract_liability: number;
  };
}

export function rollupLines(
  lines: readonly RecognitionLine[],
  minorUnit = DEFAULT_MINOR_UNIT,
): RecognitionTotals {
  const s = (pick: (l: RecognitionLine) => number): number => addMoney(lines.map(pick), minorUnit);

  const cumulative = s((l) => l.cumulative_revenue);
  const gross = s((l) => l.gross_profit);
  const marginRatio = safeRatio(gross, cumulative);
  const price = s((l) => l.transaction_price);
  const cost = s((l) => l.cost_incurred);
  const eac = s((l) => l.eac);

  return {
    obligations: lines.length,
    transaction_price: price,
    approved_variations: s((l) => l.approved_variations),
    constrained_consideration: s((l) => l.constrained_consideration),
    cost_incurred: cost,
    eac,
    cumulative_revenue: cumulative,
    period_revenue: s((l) => l.period_revenue),
    gross_profit: gross,
    margin_pct: marginRatio === null ? null : marginRatio * 100,
    loss_provision: s((l) => l.loss_provision),
    billed_to_date: s((l) => l.billed_to_date),
    cash_received: s((l) => l.cash_received),
    contract_asset: s((l) => l.contract_asset),
    contract_liability: s((l) => l.contract_liability),
    retention_receivable: s((l) => l.retention_receivable),
    advance_balance: s((l) => l.advance_balance),
    remaining_revenue: s((l) => l.remaining_revenue),
    progress_pct: safeRatio(cost, eac),
    reporting: {
      cumulative_revenue: s((l) => l.cumulative_revenue_reporting),
      period_revenue: s((l) => l.period_revenue_reporting),
      contract_asset: s((l) => l.contract_asset_reporting),
      contract_liability: s((l) => l.contract_liability_reporting),
    },
  };
}

// ---------------------------------------------------------------------------
// Reconciliation — project → obligation → period, and project → portfolio
// ---------------------------------------------------------------------------
export interface ReconciliationCheck {
  code: string;
  ok: boolean;
  expected: number;
  actual: number;
  delta: number;
}

const TOLERANCE = 0.005;

function check(code: string, expected: number, actual: number): ReconciliationCheck {
  const delta = roundMoney(actual - expected);
  return { code, ok: Math.abs(delta) <= TOLERANCE, expected, actual, delta };
}

/** Proves the roll-up equals the sum of its lines and the identities hold. */
export function reconcile(
  lines: readonly RecognitionLine[],
  totals: RecognitionTotals,
  minorUnit = DEFAULT_MINOR_UNIT,
): ReconciliationCheck[] {
  const sum = (pick: (l: RecognitionLine) => number): number =>
    addMoney(lines.map(pick), minorUnit);
  return [
    check(
      "cumulative_revenue_rollup",
      sum((l) => l.cumulative_revenue),
      totals.cumulative_revenue,
    ),
    check(
      "period_revenue_rollup",
      sum((l) => l.period_revenue),
      totals.period_revenue,
    ),
    check(
      "billed_rollup",
      sum((l) => l.billed_to_date),
      totals.billed_to_date,
    ),
    check(
      "wip_identity",
      subMoney(totals.contract_asset, totals.contract_liability, minorUnit),
      subMoney(totals.cumulative_revenue, totals.billed_to_date, minorUnit),
    ),
    check(
      "gross_profit_identity",
      subMoney(totals.cumulative_revenue, totals.cost_incurred, minorUnit),
      totals.gross_profit,
    ),
    check(
      "period_movement_identity",
      subMoney(
        totals.cumulative_revenue,
        sum((l) => l.prior_revenue),
        minorUnit,
      ),
      totals.period_revenue,
    ),
  ];
}

export function reconciliationFailures(
  checks: readonly ReconciliationCheck[],
): ReconciliationCheck[] {
  return checks.filter((c) => !c.ok);
}

// ---------------------------------------------------------------------------
// Exceptions and approval blockers
// ---------------------------------------------------------------------------
export type ExceptionSeverity = "info" | "warning" | "critical";

export interface RecognitionException {
  code: string;
  severity: ExceptionSeverity;
  message: string;
  context: JsonRecord;
}

export function deriveExceptions(
  lines: readonly RecognitionLine[],
  totals: RecognitionTotals,
  policy: RecognitionPolicy,
  checks: readonly ReconciliationCheck[] = [],
): RecognitionException[] {
  const out: RecognitionException[] = [];
  for (const l of lines) {
    const ctx = { obligation_id: l.obligation_id, code: l.code };
    if (l.flags.includes("missing_fx"))
      out.push({
        code: "missing_fx",
        severity: "critical",
        message: `No FX rate resolved for ${l.code} (${l.currency_code}).`,
        context: ctx,
      });
    if (l.flags.includes("stale_fx"))
      out.push({
        code: "stale_fx",
        severity: "warning",
        message: `FX rate for ${l.code} is stale (${l.fx_rate_date ?? "unknown date"}).`,
        context: ctx,
      });
    if (l.flags.includes("revenue_reversal") && !policy.allow_revenue_reversal)
      out.push({
        code: "revenue_reversal",
        severity: "critical",
        message: `${l.code} recognises negative revenue this period (${l.period_revenue}).`,
        context: { ...ctx, period_revenue: l.period_revenue },
      });
    if (l.flags.includes("loss_making"))
      out.push({
        code: "loss_making",
        severity: "critical",
        message: `${l.code} is loss-making: EAC ${l.eac} exceeds transaction price ${l.transaction_price}.`,
        context: { ...ctx, loss_provision: l.loss_provision },
      });
    if (l.flags.includes("unapproved_exposure"))
      out.push({
        code: "unapproved_variation_exposure",
        severity: "warning",
        message: `${l.code} carries unapproved variation/claim value excluded from the transaction price.`,
        context: ctx,
      });
    if (l.flags.includes("progress_capped"))
      out.push({
        code: "progress_capped",
        severity: "info",
        message: `${l.code} progress was capped at 100%.`,
        context: ctx,
      });
    if (l.flags.includes("manual_progress"))
      out.push({
        code: "manual_basis",
        severity: "warning",
        message: `${l.code} uses a manual progress basis and requires authorisation evidence.`,
        context: ctx,
      });
  }
  if (totals.margin_pct !== null && totals.margin_pct < 0)
    out.push({
      code: "negative_margin",
      severity: "critical",
      message: "Project gross margin is negative.",
      context: { margin_pct: totals.margin_pct },
    });
  for (const c of reconciliationFailures(checks))
    out.push({
      code: "reconciliation_failed",
      severity: "critical",
      message: `Reconciliation check ${c.code} is out by ${c.delta}.`,
      context: { ...c },
    });
  return out;
}

/** Critical exceptions block approval; warnings do not. */
export function approvalBlockers(
  exceptions: readonly RecognitionException[],
): RecognitionException[] {
  return exceptions.filter((e) => e.severity === "critical");
}

export function canApprove(exceptions: readonly RecognitionException[]): boolean {
  return approvalBlockers(exceptions).length === 0;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
const TRANSITIONS: Record<RecognitionStatus, RecognitionStatus[]> = {
  working: ["submitted"],
  submitted: ["working", "approved"],
  approved: ["superseded"],
  superseded: [],
};

export function canTransition(from: RecognitionStatus, to: RecognitionStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function isFrozen(status: RecognitionStatus): boolean {
  return status === "approved" || status === "superseded";
}

/** Segregation of duties: an approver may not be the preparer or submitter. */
export function violatesSegregation(input: {
  approver_id: string;
  prepared_by?: string | null;
  submitted_by?: string | null;
}): boolean {
  return input.approver_id === input.prepared_by || input.approver_id === input.submitted_by;
}

// ---------------------------------------------------------------------------
// Portfolio roll-up
// ---------------------------------------------------------------------------
export interface PortfolioProjectInput {
  project_id: string;
  project_name: string;
  customer?: string | null;
  currency_code: string;
  method: RecognitionMethod;
  status: RecognitionStatus;
  period_month: string;
  data_date: string;
  totals: RecognitionTotals;
  // ---- optional governance signals (alerting only; never used in money math)
  /** True when at least one line could not be translated to reporting currency. */
  fx_missing?: boolean;
  /** Date the retention release became contractually due, if any. */
  retention_due_date?: string | null;
  /** Date of the most recent client billing document. */
  last_billing_date?: string | null;
  /** False when the snapshot's reconciliation identities did not balance. */
  reconciliation_ok?: boolean;
  /** Manual adjustments still awaiting authorisation. */
  pending_adjustments?: number;
  /** When the snapshot entered `submitted`, used for approval-delay ageing. */
  submitted_at?: string | null;
}


export interface PortfolioRecognitionRollup {
  projects: number;
  approved_projects: number;
  revenue: number;
  period_revenue: number;
  gross_profit: number;
  margin_pct: number | null;
  contract_asset: number;
  contract_liability: number;
  loss_provision: number;
  loss_making_projects: number;
  billed_to_date: number;
  cash_received: number;
}

export function rollupPortfolio(
  rows: readonly PortfolioProjectInput[],
  minorUnit = DEFAULT_MINOR_UNIT,
): PortfolioRecognitionRollup {
  const s = (pick: (r: PortfolioProjectInput) => number): number =>
    addMoney(rows.map(pick), minorUnit);
  const revenue = s((r) => r.totals.reporting.cumulative_revenue || r.totals.cumulative_revenue);
  const gross = s((r) => r.totals.gross_profit);
  const marginRatio = safeRatio(gross, revenue);
  return {
    projects: rows.length,
    approved_projects: rows.filter((r) => r.status === "approved").length,
    revenue,
    period_revenue: s((r) => r.totals.reporting.period_revenue || r.totals.period_revenue),
    gross_profit: gross,
    margin_pct: marginRatio === null ? null : marginRatio * 100,
    contract_asset: s((r) => r.totals.reporting.contract_asset || r.totals.contract_asset),
    contract_liability: s(
      (r) => r.totals.reporting.contract_liability || r.totals.contract_liability,
    ),
    loss_provision: s((r) => r.totals.loss_provision),
    loss_making_projects: rows.filter((r) => r.totals.loss_provision > 0).length,
    billed_to_date: s((r) => r.totals.billed_to_date),
    cash_received: s((r) => r.totals.cash_received),
  };
}

export interface ConcentrationSlice {
  key: string;
  revenue: number;
  share_pct: number | null;
}

export function concentrationBy(
  rows: readonly PortfolioProjectInput[],
  dimension: "customer" | "project" | "currency" | "method",
  minorUnit = DEFAULT_MINOR_UNIT,
): ConcentrationSlice[] {
  const buckets = new Map<string, number>();
  for (const r of rows) {
    const key =
      dimension === "customer"
        ? (r.customer ?? "unassigned")
        : dimension === "project"
          ? r.project_name
          : dimension === "currency"
            ? r.currency_code
            : r.method;
    const value = r.totals.reporting.cumulative_revenue || r.totals.cumulative_revenue;
    buckets.set(key, addMoney([buckets.get(key) ?? 0, value], minorUnit));
  }
  const total = addMoney([...buckets.values()], minorUnit);
  return [...buckets.entries()]
    .map(([key, revenue]) => {
      const share = safeRatio(revenue, total);
      return { key, revenue, share_pct: share === null ? null : share * 100 };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// WIP ageing
// ---------------------------------------------------------------------------
export const WIP_AGE_BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type WipAgeBucket = (typeof WIP_AGE_BUCKETS)[number];

export function ageBucket(days: number): WipAgeBucket {
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export function daysBetweenIso(from: string, to: string): number {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

export function ageWip(
  rows: readonly { amount: number; since: string }[],
  asOf: string,
  minorUnit = DEFAULT_MINOR_UNIT,
): Record<WipAgeBucket, number> {
  const out: Record<WipAgeBucket, number> = {
    d0_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
  };
  for (const r of rows) {
    const bucket = ageBucket(daysBetweenIso(r.since, asOf));
    out[bucket] = addMoney([out[bucket], r.amount], minorUnit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Non-posting sensitivity (reuses the scenario doctrine: never writes)
// ---------------------------------------------------------------------------
export interface RecognitionSensitivity {
  /** Multiplier on cost-to-complete (1.1 = 10% EAC deterioration). */
  eac_uplift_pct?: number;
  /** Absolute progress delta in percentage points (-5 = 5pp slower). */
  progress_delta_pp?: number;
  /** Override constraint % on unapproved consideration. */
  constraint_pct?: number;
  /** Billing delay in days — shifts billings out of the period. */
  billing_delay_pct?: number;
  /** FX shock applied to reporting conversion (-10 = 10% weaker). */
  fx_shock_pct?: number;
}

export interface SensitivityResult {
  base: RecognitionTotals;
  stressed: RecognitionTotals;
  delta: {
    cumulative_revenue: number;
    period_revenue: number;
    gross_profit: number;
    contract_asset: number;
    contract_liability: number;
    loss_provision: number;
  };
}

/** Pure what-if: recomputes from inputs and never touches stored snapshots. */
export function applySensitivity(
  obligations: readonly ObligationInput[],
  policy: RecognitionPolicy,
  asOf: string,
  s: RecognitionSensitivity,
): SensitivityResult {
  const minorUnit = policy.minor_unit ?? DEFAULT_MINOR_UNIT;
  const base = rollupLines(
    obligations.map((o) => computeLine(o, policy, asOf)),
    minorUnit,
  );

  const stressedPolicy: RecognitionPolicy = {
    ...policy,
    constraint_pct: s.constraint_pct ?? policy.constraint_pct,
  };
  const fxFactor = 1 + (s.fx_shock_pct ?? 0) / 100;
  const stressedLines = obligations.map((o) => {
    const shifted: ObligationInput = {
      ...o,
      cost_to_complete: scaleMoney(
        num(o.cost_to_complete),
        1 + (s.eac_uplift_pct ?? 0) / 100,
        minorUnit,
      ),
      billed_to_date: scaleMoney(
        num(o.billed_to_date),
        1 - (s.billing_delay_pct ?? 0) / 100,
        minorUnit,
      ),
      fx_rate: o.fx_rate == null ? null : o.fx_rate * fxFactor,
      manual_progress:
        o.manual_progress == null
          ? null
          : clamp01(o.manual_progress + (s.progress_delta_pp ?? 0) / 100),
      adjustments: [
        ...(o.adjustments ?? []),
        ...(s.progress_delta_pp
          ? [{ kind: "progress" as AdjustmentKind, amount: s.progress_delta_pp / 100 }]
          : []),
      ],
    };
    return computeLine(shifted, stressedPolicy, asOf);
  });
  const stressed = rollupLines(stressedLines, minorUnit);

  return {
    base,
    stressed,
    delta: {
      cumulative_revenue: subMoney(stressed.cumulative_revenue, base.cumulative_revenue, minorUnit),
      period_revenue: subMoney(stressed.period_revenue, base.period_revenue, minorUnit),
      gross_profit: subMoney(stressed.gross_profit, base.gross_profit, minorUnit),
      contract_asset: subMoney(stressed.contract_asset, base.contract_asset, minorUnit),
      contract_liability: subMoney(stressed.contract_liability, base.contract_liability, minorUnit),
      loss_provision: subMoney(stressed.loss_provision, base.loss_provision, minorUnit),
    },
  };
}

// ---------------------------------------------------------------------------
// Alerts (deduplicated fingerprints, routed through the alert framework)
// ---------------------------------------------------------------------------
export interface RecognitionAlert {
  rule_type: string;
  severity: ExceptionSeverity;
  fingerprint: string;
  title: string;
  detail: string;
  evidence_url: string;
  context: JsonRecord;
}

export const RECOGNITION_ALERT_RULES = [
  "revenue_margin_erosion",
  "revenue_loss_making",
  "recognition_basis_stale",
  "wip_underbilling_age",
  "contract_liability_movement",
  "unapproved_variation_exposure",
] as const;

export interface AlertThresholds {
  margin_floor_pct: number;
  wip_age_days: number;
  basis_stale_days: number;
  liability_movement_pct: number;
  exposure_amount: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  margin_floor_pct: 5,
  wip_age_days: 60,
  basis_stale_days: 45,
  liability_movement_pct: 20,
  exposure_amount: 100_000,
};

export function fingerprint(parts: readonly (string | number)[]): string {
  return parts.map((p) => String(p).toLowerCase().replace(/\s+/g, "-")).join(":");
}

export function evaluateRecognitionAlerts(
  rows: readonly PortfolioProjectInput[],
  asOf: string,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): RecognitionAlert[] {
  const out: RecognitionAlert[] = [];
  const seen = new Set<string>();
  const push = (a: RecognitionAlert): void => {
    if (seen.has(a.fingerprint)) return;
    seen.add(a.fingerprint);
    out.push(a);
  };

  for (const r of rows) {
    const url = `/projects/${r.project_id}/costing/revenue`;
    const t = r.totals;

    if (t.margin_pct !== null && t.margin_pct < thresholds.margin_floor_pct)
      push({
        rule_type: "revenue_margin_erosion",
        severity: t.margin_pct < 0 ? "critical" : "warning",
        fingerprint: fingerprint(["margin", r.project_id, r.period_month]),
        title: `Margin erosion — ${r.project_name}`,
        detail: `Gross margin ${t.margin_pct.toFixed(1)}% is below the ${thresholds.margin_floor_pct}% floor.`,
        evidence_url: url,
        context: { margin_pct: t.margin_pct, period: r.period_month },
      });

    if (t.loss_provision > 0)
      push({
        rule_type: "revenue_loss_making",
        severity: "critical",
        fingerprint: fingerprint(["loss", r.project_id, r.period_month]),
        title: `Loss-making contract — ${r.project_name}`,
        detail: `Expected loss provision of ${t.loss_provision} ${r.currency_code}.`,
        evidence_url: url,
        context: { loss_provision: t.loss_provision },
      });

    const staleDays = daysBetweenIso(r.data_date, asOf);
    if (staleDays > thresholds.basis_stale_days)
      push({
        rule_type: "recognition_basis_stale",
        severity: "warning",
        fingerprint: fingerprint(["stale", r.project_id, r.period_month]),
        title: `Stale recognition basis — ${r.project_name}`,
        detail: `Data date ${r.data_date} is ${staleDays} days old.`,
        evidence_url: url,
        context: { data_date: r.data_date, days: staleDays },
      });

    if (t.contract_asset > 0 && staleDays > thresholds.wip_age_days)
      push({
        rule_type: "wip_underbilling_age",
        severity: "warning",
        fingerprint: fingerprint(["wip-age", r.project_id, r.period_month]),
        title: `Aged underbilling — ${r.project_name}`,
        detail: `Contract asset of ${t.contract_asset} has been open ${staleDays} days.`,
        evidence_url: url,
        context: { contract_asset: t.contract_asset, days: staleDays },
      });

    const liabilityShare = safeRatio(t.contract_liability, t.transaction_price);
    if (liabilityShare !== null && liabilityShare * 100 > thresholds.liability_movement_pct)
      push({
        rule_type: "contract_liability_movement",
        severity: "warning",
        fingerprint: fingerprint(["liability", r.project_id, r.period_month]),
        title: `Overbilling exposure — ${r.project_name}`,
        detail: `Contract liability is ${(liabilityShare * 100).toFixed(1)}% of the transaction price.`,
        evidence_url: url,
        context: { contract_liability: t.contract_liability },
      });

    if (
      t.constrained_consideration > 0 &&
      t.constrained_consideration >= thresholds.exposure_amount
    )
      push({
        rule_type: "unapproved_variation_exposure",
        severity: "warning",
        fingerprint: fingerprint(["exposure", r.project_id, r.period_month]),
        title: `Constrained consideration — ${r.project_name}`,
        detail: `${t.constrained_consideration} of unapproved value is included under the constraint policy.`,
        evidence_url: url,
        context: { constrained: t.constrained_consideration },
      });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const monthStart = z.string().regex(/^\d{4}-\d{2}-01$/, "Period must be the first day of a month.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const recognitionSettingsSchema = z.object({
  project_id: uuid,
  default_method: z.enum(RECOGNITION_METHODS).default("cost_to_cost"),
  policy_version: z.string().min(1).max(32).default("v1"),
  constraint_pct: z.number().min(0).max(100).default(0),
  include_unapproved_variations: z.boolean().default(false),
  include_unapproved_claims: z.boolean().default(false),
  loss_provision_enabled: z.boolean().default(true),
  cap_progress_at_100: z.boolean().default(true),
  allow_revenue_reversal: z.boolean().default(false),
  retention_pct: z.number().min(0).max(100).default(0),
  advance_recovery_pct: z.number().min(0).max(100).default(0),
  reporting_currency: z.string().length(3).optional().nullable(),
});
export type RecognitionSettingsInput = z.infer<typeof recognitionSettingsSchema>;

export const obligationSchema = z.object({
  id: uuid.optional(),
  project_id: uuid,
  contract_id: uuid.nullable().optional(),
  code: z.string().min(1).max(48),
  name: z.string().min(1).max(200),
  method: z.enum(RECOGNITION_METHODS).default("cost_to_cost"),
  progress_basis: z.enum(PROGRESS_BASES).default("cost"),
  allocation_amount: z.number().min(0).default(0),
  standalone_value: z.number().min(0).nullable().optional(),
  currency_code: z.string().length(3),
  start_date: isoDate.nullable().optional(),
  end_date: isoDate.nullable().optional(),
  milestones: z
    .array(
      z.object({
        code: z.string().min(1),
        label: z.string().optional(),
        value: z.number().min(0),
        achieved: z.boolean().default(false),
        achieved_date: isoDate.nullable().optional(),
      }),
    )
    .default([]),
  constraint_pct: z.number().min(0).max(100).default(0),
  is_loss_making: z.boolean().default(false),
  retention_pct: z.number().min(0).max(100).default(0),
  advance_amount: z.number().min(0).default(0),
  advance_recovery_pct: z.number().min(0).max(100).default(0),
  tax_treatment: z.enum(["exclusive", "inclusive", "exempt"]).default("exclusive"),
  status: z.enum(["draft", "active", "closed"]).default("draft"),
  notes: z.string().max(2000).nullable().optional(),
  row_version: z.number().int().min(1).optional(),
});
export type ObligationWriteInput = z.infer<typeof obligationSchema>;

export const snapshotBuildSchema = z.object({
  project_id: uuid,
  period_month: monthStart,
  data_date: isoDate,
  billing_cutoff: isoDate,
  reporting_currency: z.string().length(3).optional(),
});
export type SnapshotBuildInput = z.infer<typeof snapshotBuildSchema>;

export const snapshotTransitionSchema = z.object({
  snapshot_id: uuid,
  to_status: z.enum(RECOGNITION_STATUSES),
  row_version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});
export type SnapshotTransitionInput = z.infer<typeof snapshotTransitionSchema>;

export const snapshotCorrectionSchema = z.object({
  snapshot_id: uuid,
  reason: z.string().min(8).max(2000),
});
export type SnapshotCorrectionInput = z.infer<typeof snapshotCorrectionSchema>;

export const recognitionAdjustmentSchema = z.object({
  id: uuid.optional(),
  project_id: uuid,
  obligation_id: uuid.nullable().optional(),
  effective_period: monthStart,
  kind: z.enum(ADJUSTMENT_KINDS),
  amount: z.number().refine((v) => v !== 0, "Adjustment amount must not be zero."),
  currency_code: z.string().length(3),
  reason: z.string().min(8).max(2000),
  evidence_reference: z.string().max(400).nullable().optional(),
  row_version: z.number().int().min(1).optional(),
});
export type RecognitionAdjustmentInput = z.infer<typeof recognitionAdjustmentSchema>;

export const adjustmentDecisionSchema = z.object({
  adjustment_id: uuid,
  decision: z.enum(["approve", "void"]),
  row_version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});
export type AdjustmentDecisionInput = z.infer<typeof adjustmentDecisionSchema>;

export const sensitivitySchema = z.object({
  project_id: uuid,
  period_month: monthStart,
  eac_uplift_pct: z.number().min(-90).max(200).default(0),
  progress_delta_pp: z.number().min(-100).max(100).default(0),
  constraint_pct: z.number().min(0).max(100).optional(),
  billing_delay_pct: z.number().min(0).max(100).default(0),
  fx_shock_pct: z.number().min(-50).max(50).default(0),
});
export type SensitivityQueryInput = z.infer<typeof sensitivitySchema>;

export const portfolioRecognitionSchema = z.object({
  period_month: monthStart.optional(),
  status: z.enum([...RECOGNITION_STATUSES, "all"]).default("all"),
  reporting_currency: z.string().length(3).optional(),
});
export type PortfolioRecognitionQuery = z.infer<typeof portfolioRecognitionSchema>;
