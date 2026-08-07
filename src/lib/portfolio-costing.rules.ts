// GC-08 — Portfolio Cost & Close: pure consolidation rules.
//
// Nothing here recomputes a project's cost position. Every project measure
// arrives from an already-frozen forecast snapshot (`forecast_versions.totals`,
// project currency, rates locked at snapshot time). This module only
//   1. derives the same balance measures the project module publishes
//      (see costing.rules: available / percent consumed),
//   2. translates project currency into ONE company reporting currency at an
//      explicit consolidation rate, and
//   3. classifies close state and variance.
//
// Hard rules: a missing consolidation rate is never 1.0, and a translated
// figure is never re-translated.
import { z } from "zod";

import { convertMoney, roundMoney, sumMoney, type FxSource } from "@/lib/costing.fx";
import { evaluateMateriality, type MaterialityPolicy } from "@/lib/costing.periods";
import type { CostingPeriodState } from "@/lib/costing.periods";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
/** Frozen snapshot header totals, in project currency. */
export interface PortfolioSnapshotTotals {
  budget_current: number;
  committed: number;
  actual: number;
  accruals: number;
  etc: number;
  eac: number;
  vac: number;
}

/**
 * Ledger-sourced measures the frozen snapshot never carried. They are read
 * as-at the period end, in project currency. `null` means "not translatable"
 * — a required rate was missing — and is rendered as unavailable, never zero.
 */
export interface PortfolioLedgerMeasures {
  budget_original: number | null;
  budget_approved_changes: number | null;
  paid: number | null;
  /** Currencies whose rate into project currency was missing. */
  fx_missing: string[];
}

export type ConsolidationBasis = "period_end" | "latest";

export interface ConsolidationRate {
  rate: number | null;
  as_of: string | null;
  source: FxSource;
  stale: boolean;
  missing: boolean;
}

export type SnapshotBasisKind = "approved" | "indicative" | "none";

export interface PortfolioVersionRef {
  id: string;
  version_no: number;
  status: string;
  label: string | null;
  approved_at: string | null;
  reporting_period: string;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------
export interface PortfolioMeasures {
  budget_original: number | null;
  budget_approved_changes: number | null;
  budget_current: number;
  committed: number;
  actual: number;
  accruals: number;
  etc: number;
  eac: number;
  vac: number;
  /** current − max(committed, actual + accruals) — the project module's rule. */
  available: number;
  paid: number | null;
  /** actual − paid; null when paid is unavailable. */
  outstanding: number | null;
  /** EAC ÷ current budget, 0-1. Null when there is no budget. */
  percent_consumed: number | null;
}

export const EMPTY_TOTALS: PortfolioSnapshotTotals = {
  budget_current: 0,
  committed: 0,
  actual: 0,
  accruals: 0,
  etc: 0,
  eac: 0,
  vac: 0,
};

export function deriveMeasures(
  totals: PortfolioSnapshotTotals,
  ledger: PortfolioLedgerMeasures,
): PortfolioMeasures {
  const available = roundMoney(
    totals.budget_current - Math.max(totals.committed, sumMoney([totals.actual, totals.accruals])),
  );
  return {
    budget_original: ledger.budget_original,
    budget_approved_changes: ledger.budget_approved_changes,
    budget_current: roundMoney(totals.budget_current),
    committed: roundMoney(totals.committed),
    actual: roundMoney(totals.actual),
    accruals: roundMoney(totals.accruals),
    etc: roundMoney(totals.etc),
    eac: roundMoney(totals.eac),
    vac: roundMoney(totals.vac),
    available,
    paid: ledger.paid === null ? null : roundMoney(ledger.paid),
    outstanding: ledger.paid === null ? null : roundMoney(totals.actual - ledger.paid),
    percent_consumed:
      totals.budget_current === 0
        ? null
        : Math.round((totals.eac / totals.budget_current) * 1e4) / 1e4,
  };
}

/** Translate a whole measure set once, at one explicit rate. */
export function translateMeasures(
  m: PortfolioMeasures,
  rate: ConsolidationRate,
): PortfolioMeasures | null {
  if (rate.missing || rate.rate === null || rate.rate <= 0) return null;
  const r = rate.rate;
  const c = (v: number | null) => (v === null ? null : convertMoney(v, r));
  return {
    budget_original: c(m.budget_original),
    budget_approved_changes: c(m.budget_approved_changes),
    budget_current: convertMoney(m.budget_current, r),
    committed: convertMoney(m.committed, r),
    actual: convertMoney(m.actual, r),
    accruals: convertMoney(m.accruals, r),
    etc: convertMoney(m.etc, r),
    eac: convertMoney(m.eac, r),
    vac: convertMoney(m.vac, r),
    available: convertMoney(m.available, r),
    paid: c(m.paid),
    outstanding: c(m.outstanding),
    // Ratios are currency-free: keep the project-currency ratio, do not re-derive.
    percent_consumed: m.percent_consumed,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
export interface PortfolioVariance {
  /** EAC movement against the previous period's approved snapshot. */
  delta_eac_prior: number | null;
  /** EAC movement against the project's first approved (baseline) snapshot. */
  delta_eac_baseline: number | null;
  /** Materiality verdict for the prior-period movement. */
  material: boolean;
  delta_pct_prior: number | null;
  explanation: string | null;
}

export interface PortfolioCloseState {
  state: CostingPeriodState;
  checklist_total: number;
  checklist_done: number;
  checklist_overdue: number;
  checklist_pct: number | null;
  exceptions_blockers: number;
  exceptions_warnings: number;
  blockers: { key: string; count: number }[];
  ready: boolean;
  owners: string[];
  last_action_at: string | null;
}

export interface PortfolioProjectRow {
  project_id: string;
  code: string;
  name: string;
  currency: string;
  version: PortfolioVersionRef | null;
  basis: SnapshotBasisKind;
  /** Project-currency measures, straight off the frozen snapshot. */
  project: PortfolioMeasures;
  /** Reporting-currency translation. Null when the rate is missing. */
  reporting: PortfolioMeasures | null;
  rate: ConsolidationRate;
  ledger_fx_missing: string[];
  close: PortfolioCloseState;
  variance: PortfolioVariance;
}

export function buildVariance(args: {
  currentEac: number | null;
  priorEac: number | null;
  baselineEac: number | null;
  policy: MaterialityPolicy;
  explanation: string | null;
}): PortfolioVariance {
  const { currentEac, priorEac, baselineEac } = args;
  if (currentEac === null) {
    return {
      delta_eac_prior: null,
      delta_eac_baseline: null,
      material: false,
      delta_pct_prior: null,
      explanation: args.explanation,
    };
  }
  const verdict = priorEac === null ? null : evaluateMateriality(priorEac, currentEac, args.policy);
  return {
    delta_eac_prior: priorEac === null ? null : roundMoney(currentEac - priorEac),
    delta_eac_baseline: baselineEac === null ? null : roundMoney(currentEac - baselineEac),
    material: verdict?.material ?? false,
    delta_pct_prior: verdict?.deltaPct ?? null,
    explanation: args.explanation,
  };
}

// ---------------------------------------------------------------------------
// Consolidation
// ---------------------------------------------------------------------------
export interface ConsolidationExclusion {
  project_id: string;
  code: string;
  reason: "fx_rate_missing" | "no_snapshot";
  currency: string;
}

export interface PortfolioConsolidation {
  currency: string;
  totals: PortfolioMeasures;
  included: number;
  excluded: ConsolidationExclusion[];
  /** Projects contributing an indicative (not yet approved) snapshot. */
  indicative: number;
  /** Ledger measures dropped from the totals because a rate was missing. */
  partial: ("budget_original" | "budget_approved_changes" | "paid")[];
}

function sumNullable(values: (number | null)[]): { value: number | null } {
  if (values.some((v) => v === null)) return { value: null };
  return { value: sumMoney(values as number[]) };
}

export function consolidate(
  rows: readonly PortfolioProjectRow[],
  currency: string,
): PortfolioConsolidation {
  const excluded: ConsolidationExclusion[] = [];
  const included: PortfolioProjectRow[] = [];

  for (const r of rows) {
    if (r.basis === "none") {
      excluded.push({
        project_id: r.project_id,
        code: r.code,
        reason: "no_snapshot",
        currency: r.currency,
      });
      continue;
    }
    if (!r.reporting) {
      excluded.push({
        project_id: r.project_id,
        code: r.code,
        reason: "fx_rate_missing",
        currency: r.currency,
      });
      continue;
    }
    included.push(r);
  }

  const m = included.map((r) => r.reporting!);
  const budget_current = sumMoney(m.map((x) => x.budget_current));
  const committed = sumMoney(m.map((x) => x.committed));
  const actual = sumMoney(m.map((x) => x.actual));
  const accruals = sumMoney(m.map((x) => x.accruals));
  const eac = sumMoney(m.map((x) => x.eac));
  const original = sumNullable(m.map((x) => x.budget_original));
  const changes = sumNullable(m.map((x) => x.budget_approved_changes));
  const paid = sumNullable(m.map((x) => x.paid));

  const partial: ("budget_original" | "budget_approved_changes" | "paid")[] = [];
  if (original.value === null) partial.push("budget_original");
  if (changes.value === null) partial.push("budget_approved_changes");
  if (paid.value === null) partial.push("paid");

  const totals: PortfolioMeasures = {
    budget_original: original.value,
    budget_approved_changes: changes.value,
    budget_current,
    committed,
    actual,
    accruals,
    etc: sumMoney(m.map((x) => x.etc)),
    eac,
    vac: sumMoney(m.map((x) => x.vac)),
    // Portfolio available is the sum of project availables — the no-double-count
    // rule is applied per project, never re-applied on aggregates.
    available: sumMoney(m.map((x) => x.available)),
    paid: paid.value,
    outstanding: paid.value === null ? null : roundMoney(actual - paid.value),
    percent_consumed: budget_current === 0 ? null : Math.round((eac / budget_current) * 1e4) / 1e4,
  };

  return {
    currency,
    totals,
    included: included.length,
    excluded,
    indicative: included.filter((r) => r.basis === "indicative").length,
    partial,
  };
}

/**
 * An official (board-grade) consolidation requires every in-scope project to
 * contribute an APPROVED snapshot translated at a real rate. Anything else is
 * management-view only and must be labelled as such.
 */
export interface OfficialGate {
  official: boolean;
  reasons: {
    key: "missing_rate" | "no_snapshot" | "indicative_snapshot" | "period_open";
    count: number;
  }[];
}

export function officialGate(
  rows: readonly PortfolioProjectRow[],
  consolidation: PortfolioConsolidation,
): OfficialGate {
  const reasons: OfficialGate["reasons"] = [];
  const missingRate = consolidation.excluded.filter((e) => e.reason === "fx_rate_missing").length;
  const noSnapshot = consolidation.excluded.filter((e) => e.reason === "no_snapshot").length;
  const open = rows.filter((r) => r.close.state === "open").length;
  if (missingRate > 0) reasons.push({ key: "missing_rate", count: missingRate });
  if (noSnapshot > 0) reasons.push({ key: "no_snapshot", count: noSnapshot });
  if (consolidation.indicative > 0) {
    reasons.push({ key: "indicative_snapshot", count: consolidation.indicative });
  }
  if (open > 0) reasons.push({ key: "period_open", count: open });
  return { official: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Close oversight summary
// ---------------------------------------------------------------------------
export interface CloseMatrixSummary {
  projects: number;
  open: number;
  soft_locked: number;
  hard_closed: number;
  ready: number;
  blocked: number;
  overdue_items: number;
  blocker_exceptions: number;
  warning_exceptions: number;
  /** 0-100 across all projects' checklists. */
  progress_pct: number | null;
}

export function closeMatrixSummary(rows: readonly PortfolioProjectRow[]): CloseMatrixSummary {
  const total = rows.reduce((a, r) => a + r.close.checklist_total, 0);
  const done = rows.reduce((a, r) => a + r.close.checklist_done, 0);
  return {
    projects: rows.length,
    open: rows.filter((r) => r.close.state === "open").length,
    soft_locked: rows.filter((r) => r.close.state === "soft_locked").length,
    hard_closed: rows.filter((r) => r.close.state === "hard_closed").length,
    ready: rows.filter((r) => r.close.ready).length,
    blocked: rows.filter((r) => !r.close.ready && r.close.state !== "hard_closed").length,
    overdue_items: rows.reduce((a, r) => a + r.close.checklist_overdue, 0),
    blocker_exceptions: rows.reduce((a, r) => a + r.close.exceptions_blockers, 0),
    warning_exceptions: rows.reduce((a, r) => a + r.close.exceptions_warnings, 0),
    progress_pct: total === 0 ? null : Math.round((done / total) * 1000) / 10,
  };
}

/** Biggest EAC movers against the prior approved period, worst first. */
export function topMovers(rows: readonly PortfolioProjectRow[], limit = 5): PortfolioProjectRow[] {
  return rows
    .filter((r) => r.variance.delta_eac_prior !== null && r.variance.delta_eac_prior !== 0)
    .slice()
    .sort(
      (a, b) =>
        Math.abs(b.variance.delta_eac_prior!) - Math.abs(a.variance.delta_eac_prior!) ||
        a.code.localeCompare(b.code),
    )
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Reconciliation — portfolio must tie back to each project workspace
// ---------------------------------------------------------------------------
export interface ReconciliationLine {
  project_id: string;
  code: string;
  currency: string;
  project_eac: number;
  rate: number | null;
  reporting_eac: number | null;
  ok: boolean;
}

export interface Reconciliation {
  lines: ReconciliationLine[];
  reporting_total: number;
  /** Sum of line translations minus the published total; must be 0. */
  difference: number;
  ok: boolean;
}

export function reconcile(
  rows: readonly PortfolioProjectRow[],
  consolidation: PortfolioConsolidation,
): Reconciliation {
  const lines: ReconciliationLine[] = rows.map((r) => {
    const expected = r.reporting ? convertMoney(r.project.eac, r.rate.rate ?? 0) : null;
    return {
      project_id: r.project_id,
      code: r.code,
      currency: r.currency,
      project_eac: r.project.eac,
      rate: r.rate.rate,
      reporting_eac: r.reporting?.eac ?? null,
      ok: expected === (r.reporting?.eac ?? null),
    };
  });
  const sum = sumMoney(lines.map((l) => l.reporting_eac ?? 0));
  const difference = roundMoney(sum - consolidation.totals.eac);
  return {
    lines,
    reporting_total: consolidation.totals.eac,
    difference,
    ok: difference === 0 && lines.every((l) => l.ok),
  };
}

// ---------------------------------------------------------------------------
// Deterministic CSV export
// ---------------------------------------------------------------------------
const CSV_HEADERS = [
  "project_code",
  "project_name",
  "project_currency",
  "period",
  "snapshot_basis",
  "version_no",
  "version_status",
  "fx_rate",
  "fx_rate_date",
  "fx_source",
  "budget_original",
  "budget_approved_changes",
  "budget_current",
  "committed",
  "actual",
  "accruals",
  "etc",
  "eac",
  "vac",
  "available",
  "paid",
  "outstanding",
  "percent_consumed",
  "delta_eac_prior",
  "delta_eac_baseline",
  "period_state",
  "checklist_done",
  "checklist_total",
  "open_blockers",
  "close_ready",
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per project, in reporting currency, plus a TOTAL row. */
export function buildConsolidationCsv(
  rows: readonly PortfolioProjectRow[],
  consolidation: PortfolioConsolidation,
  period: string,
): string {
  const body = rows
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((r) => {
      const m = r.reporting;
      return [
        r.code,
        r.name,
        r.currency,
        period,
        r.basis,
        r.version?.version_no ?? "",
        r.version?.status ?? "",
        r.rate.rate ?? "",
        r.rate.as_of ?? "",
        r.rate.source,
        m?.budget_original ?? "",
        m?.budget_approved_changes ?? "",
        m?.budget_current ?? "",
        m?.committed ?? "",
        m?.actual ?? "",
        m?.accruals ?? "",
        m?.etc ?? "",
        m?.eac ?? "",
        m?.vac ?? "",
        m?.available ?? "",
        m?.paid ?? "",
        m?.outstanding ?? "",
        m?.percent_consumed ?? "",
        r.variance.delta_eac_prior ?? "",
        r.variance.delta_eac_baseline ?? "",
        r.close.state,
        r.close.checklist_done,
        r.close.checklist_total,
        r.close.exceptions_blockers,
        r.close.ready ? "yes" : "no",
      ].map(csvCell);
    });

  const t = consolidation.totals;
  const totalRow = [
    "TOTAL",
    `${consolidation.included} project(s)`,
    consolidation.currency,
    period,
    "",
    "",
    "",
    "",
    "",
    "",
    t.budget_original ?? "",
    t.budget_approved_changes ?? "",
    t.budget_current,
    t.committed,
    t.actual,
    t.accruals,
    t.etc,
    t.eac,
    t.vac,
    t.available,
    t.paid ?? "",
    t.outstanding ?? "",
    t.percent_consumed ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
  ].map(csvCell);

  return [CSV_HEADERS.join(","), ...body.map((r) => r.join(",")), totalRow.join(",")].join("\n");
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const portfolioCostingQuerySchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-01$/)
    .optional(),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((v) => v.toUpperCase())
    .optional(),
  basis: z.enum(["period_end", "latest"]).optional(),
});

export type PortfolioCostingQuery = z.infer<typeof portfolioCostingQuerySchema>;
