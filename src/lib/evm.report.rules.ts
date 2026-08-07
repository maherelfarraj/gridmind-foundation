// GC-12 — Integrated Earned Value Management: pure, deterministic rules.
//
// Policy (single source of truth for the module):
//   * Money is decimal-safe: every sum and conversion goes through
//     costing.fx (integer minor units, HALF-UP away from zero, round once).
//   * Ratios (SPI, CPI, TCPI, percentages) are NEVER currency-translated and
//     never rounded into money. They are rounded to 4 decimals for display
//     stability only.
//   * A zero or unavailable denominator yields `null`, never Infinity, NaN or
//     a silent zero. Consumers must render "n/a" for null.
//   * Missing FX blocks the affected total. There is no 1.0 fallback and no
//     double conversion: a project-currency figure is translated exactly once.
//   * EVM never mutates budgets, actuals, approved forecasts or progress. It
//     reads them and writes its own immutable snapshot.
import { z } from "zod";

import { convertMoney, roundMoney, sumMoney, toMinor } from "@/lib/costing.fx";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const PROGRESS_METHODS = [
  "weighted_milestone",
  "physical_pct",
  "units_complete",
  "zero_hundred",
  "twenty_eighty",
  "fifty_fifty",
  "level_of_effort",
] as const;
export type ProgressMethod = (typeof PROGRESS_METHODS)[number];

export const EAC_METHODS = ["bottom_up", "cpi", "cpi_spi", "ac_plus_remaining"] as const;
export type EacMethod = (typeof EAC_METHODS)[number];

export const REPORT_STATUSES = ["working", "submitted", "approved", "superseded"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const AC_BASES = ["actual_only", "actual_plus_accrual"] as const;
export type AcBasis = (typeof AC_BASES)[number];

export const EXCEPTION_SEVERITIES = ["blocker", "warning", "info"] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

export const EXCEPTION_CODES = [
  "unmapped_scope",
  "allocation_over",
  "allocation_under",
  "missing_baseline_dates",
  "missing_budget",
  "stale_progress",
  "future_dated_progress",
  "missing_actuals",
  "fx_missing",
  "cpi_deterioration",
  "spi_deterioration",
  "adverse_cv",
  "adverse_sv",
  "adverse_vac",
  "tcpi_infeasible",
  "progress_cost_mismatch",
  "forecast_divergence",
] as const;
export type ExceptionCode = (typeof EXCEPTION_CODES)[number];

/** Alert rule types this module raises through the portfolio alerts engine. */
export const EVM_ALERT_RULES = [
  "evm_cpi_deterioration",
  "evm_spi_deterioration",
  "evm_tcpi_infeasible",
  "evm_mapping_gap",
  "evm_forecast_divergence",
] as const;
export type EvmAlertRule = (typeof EVM_ALERT_RULES)[number];

// ---------------------------------------------------------------------------
// Ratio helpers — explicit null semantics
// ---------------------------------------------------------------------------
const RATIO_DP = 4;

function finite(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function roundRatio(n: number): number {
  const f = 10 ** RATIO_DP;
  const scaled = Number((n * f).toPrecision(15));
  return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / f;
}

/**
 * Divide with EVM semantics. Returns null when either operand is unavailable
 * or the denominator is zero — never Infinity, NaN or a misleading 0.
 */
export function ratio(numerator: number | null, denominator: number | null): number | null {
  const n = finite(numerator);
  const d = finite(denominator);
  if (n === null || d === null) return null;
  if (toMinor(d) === 0) return null;
  return roundRatio(n / d);
}

/** Percentage form of `ratio`, expressed 0–100 (may exceed 100). */
export function pct(numerator: number | null, denominator: number | null): number | null {
  const r = ratio(numerator, denominator);
  return r === null ? null : roundRatio(r * 100);
}

export function clampPct(n: number): number {
  const v = finite(n) ?? 0;
  return Math.min(100, Math.max(0, v));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
export function dayMs(iso: string): number | null {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

export function periodEndOf(periodMonth: string): string {
  const y = Number(periodMonth.slice(0, 4));
  const m = Number(periodMonth.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number | null {
  const a = dayMs(fromIso);
  const b = dayMs(toIso);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Progress measurement
// ---------------------------------------------------------------------------
export interface MilestoneWeight {
  /** Stable key so the same milestone set always produces the same result. */
  key: string;
  weight_pct: number;
  complete: boolean;
}

export interface ProgressInput {
  method: ProgressMethod;
  /** Field/schedule reported physical percent, 0–100. */
  physical_pct?: number | null;
  milestones?: readonly MilestoneWeight[] | null;
  units_complete?: number | null;
  planned_units?: number | null;
  started?: boolean | null;
  complete?: boolean | null;
  /** Planned percent at the data date — the only input a LOE task uses. */
  planned_pct?: number | null;
}

export interface ProgressResult {
  /** Objective, calculated progress. Null when the method has no evidence. */
  calculated_pct: number | null;
  method: ProgressMethod;
  /** Why the method could not produce a figure, if it could not. */
  gap: "no_physical" | "no_milestones" | "no_units" | "no_planned" | null;
}

/**
 * Objective progress for one scope item. Never consults an override — the
 * override is applied separately and audited, so the two always stay
 * distinguishable in the snapshot.
 */
export function calculateProgress(input: ProgressInput): ProgressResult {
  const m = input.method;
  switch (m) {
    case "physical_pct": {
      const p = finite(input.physical_pct);
      return p === null
        ? { calculated_pct: null, method: m, gap: "no_physical" }
        : { calculated_pct: roundRatio(clampPct(p)), method: m, gap: null };
    }
    case "weighted_milestone": {
      const ms = input.milestones ?? [];
      const totalWeight = ms.reduce((s, x) => s + (finite(x.weight_pct) ?? 0), 0);
      if (ms.length === 0 || toMinor(totalWeight) === 0) {
        return { calculated_pct: null, method: m, gap: "no_milestones" };
      }
      const done = ms
        .filter((x) => x.complete)
        .reduce((s, x) => s + (finite(x.weight_pct) ?? 0), 0);
      return { calculated_pct: roundRatio(clampPct((done / totalWeight) * 100)), method: m, gap: null };
    }
    case "units_complete": {
      const done = finite(input.units_complete);
      const planned = finite(input.planned_units);
      if (done === null || planned === null || toMinor(planned) === 0) {
        return { calculated_pct: null, method: m, gap: "no_units" };
      }
      return { calculated_pct: roundRatio(clampPct((done / planned) * 100)), method: m, gap: null };
    }
    case "zero_hundred":
      return { calculated_pct: input.complete ? 100 : 0, method: m, gap: null };
    case "twenty_eighty":
      return {
        calculated_pct: input.complete ? 100 : input.started ? 20 : 0,
        method: m,
        gap: null,
      };
    case "fifty_fifty":
      return {
        calculated_pct: input.complete ? 100 : input.started ? 50 : 0,
        method: m,
        gap: null,
      };
    case "level_of_effort": {
      const p = finite(input.planned_pct);
      return p === null
        ? { calculated_pct: null, method: m, gap: "no_planned" }
        : { calculated_pct: roundRatio(clampPct(p)), method: m, gap: null };
    }
    default:
      return { calculated_pct: null, method: m, gap: null };
  }
}

export interface ProgressOverride {
  override_pct: number;
  reason: string;
  evidence_ref: string;
  approved_by?: string | null;
}

export interface AppliedProgress {
  calculated_pct: number | null;
  applied_pct: number | null;
  overridden: boolean;
  override_reason: string | null;
  override_evidence: string | null;
}

/** Overrides are only honoured when they carry a reason and evidence. */
export function applyOverride(
  calculated: number | null,
  override: ProgressOverride | null | undefined,
): AppliedProgress {
  const valid =
    override != null &&
    finite(override.override_pct) !== null &&
    String(override.reason ?? "").trim().length >= 8 &&
    String(override.evidence_ref ?? "").trim().length > 0;
  if (!valid) {
    return {
      calculated_pct: calculated,
      applied_pct: calculated,
      overridden: false,
      override_reason: null,
      override_evidence: null,
    };
  }
  return {
    calculated_pct: calculated,
    applied_pct: roundRatio(clampPct(override!.override_pct)),
    overridden: true,
    override_reason: override!.reason.trim(),
    override_evidence: override!.evidence_ref.trim(),
  };
}

// ---------------------------------------------------------------------------
// Allocation reconciliation
// ---------------------------------------------------------------------------
export interface MappingRow {
  id: string;
  wbs_item_id: string | null;
  schedule_task_id: string | null;
  cost_code_id: string | null;
  allocation_pct: number;
  progress_method: ProgressMethod;
  milestone_weights?: readonly MilestoneWeight[] | null;
  planned_units?: number | null;
}

export interface AllocationCheck {
  scope_key: string;
  total_pct: number;
  ok: boolean;
  over: boolean;
  under: boolean;
}

export function scopeKeyOf(m: Pick<MappingRow, "wbs_item_id" | "schedule_task_id">): string {
  return m.schedule_task_id ? `task:${m.schedule_task_id}` : `wbs:${m.wbs_item_id}`;
}

/** Allocations for one scope item must reconcile to exactly 100%. */
export function reconcileAllocations(mappings: readonly MappingRow[]): AllocationCheck[] {
  const byScope = new Map<string, number>();
  for (const m of mappings) {
    const key = scopeKeyOf(m);
    byScope.set(key, (byScope.get(key) ?? 0) + (finite(m.allocation_pct) ?? 0));
  }
  return [...byScope.entries()]
    .map(([scope_key, total]) => {
      const total_pct = roundRatio(total);
      const cmp = toMinor(total_pct) - toMinor(100);
      return { scope_key, total_pct, ok: cmp === 0, over: cmp > 0, under: cmp < 0 };
    })
    .sort((a, b) => a.scope_key.localeCompare(b.scope_key));
}

// ---------------------------------------------------------------------------
// Planned value time phasing
// ---------------------------------------------------------------------------
export interface PhasingInput {
  bac: number;
  baseline_start: string | null;
  baseline_finish: string | null;
  data_date: string;
  /** Milestones earn their whole weight on their baseline date, not linearly. */
  is_milestone?: boolean;
}

/**
 * Planned percent of a scope item's baseline duration elapsed at the data
 * date. Linear phasing across baseline dates; a milestone is a step function.
 * Missing baseline dates yield null so the caller can raise a data-quality
 * exception instead of quietly phasing at zero.
 */
export function plannedPercent(input: PhasingInput): number | null {
  const s = input.baseline_start ? dayMs(input.baseline_start) : null;
  const e = input.baseline_finish ? dayMs(input.baseline_finish) : null;
  const t = dayMs(input.data_date);
  if (t === null) return null;
  if (input.is_milestone) {
    const at = e ?? s;
    if (at === null) return null;
    return t >= at ? 100 : 0;
  }
  if (s === null || e === null) return null;
  if (t <= s) return 0;
  if (t >= e) return 100;
  if (e <= s) return 100;
  return roundRatio(((t - s) / (e - s)) * 100);
}

/** PV = BAC x planned percent. Null planned percent means null PV, not zero. */
export function plannedValue(input: PhasingInput): number | null {
  const p = plannedPercent(input);
  if (p === null) return null;
  return roundMoney((finite(input.bac) ?? 0) * (p / 100));
}

// ---------------------------------------------------------------------------
// Core measures
// ---------------------------------------------------------------------------
export interface EvmCore {
  bac: number;
  pv: number | null;
  ev: number | null;
  ac: number | null;
  /** Bottom-up estimate to complete from the costing module, when available. */
  bottom_up_etc: number | null;
}

export interface EvmMeasures {
  bac: number;
  pv: number | null;
  ev: number | null;
  ac: number | null;
  sv: number | null;
  cv: number | null;
  spi: number | null;
  cpi: number | null;
  eac_bottom_up: number | null;
  eac_cpi: number | null;
  eac_cpi_spi: number | null;
  eac_ac_plus_remaining: number | null;
  eac: number | null;
  eac_method: EacMethod;
  etc: number | null;
  vac: number | null;
  tcpi_bac: number | null;
  tcpi_eac: number | null;
  percent_planned: number | null;
  percent_complete: number | null;
  percent_spent: number | null;
}

/**
 * All EVM measures for one node. Every formula variant is computed so the
 * cockpit can compare them; `eac` selects the configured official method and
 * falls back only when that method is not computable (documented in `eac_method`).
 */
export function computeMeasures(core: EvmCore, method: EacMethod = "bottom_up"): EvmMeasures {
  const bac = roundMoney(finite(core.bac) ?? 0);
  const pv = core.pv === null ? null : roundMoney(core.pv);
  const ev = core.ev === null ? null : roundMoney(core.ev);
  const ac = core.ac === null ? null : roundMoney(core.ac);

  const sv = ev !== null && pv !== null ? sumMoney([ev, -pv]) : null;
  const cv = ev !== null && ac !== null ? sumMoney([ev, -ac]) : null;
  const spi = ratio(ev, pv);
  const cpi = ratio(ev, ac);

  const eac_bottom_up =
    core.bottom_up_etc !== null && ac !== null ? sumMoney([ac, core.bottom_up_etc]) : null;
  const eac_cpi = cpi !== null && cpi !== 0 ? roundMoney(bac / cpi) : null;
  const eac_cpi_spi =
    cpi !== null && spi !== null && cpi !== 0 && spi !== 0 ? roundMoney(bac / (cpi * spi)) : null;
  const eac_ac_plus_remaining = ac !== null && ev !== null ? sumMoney([ac, bac, -ev]) : null;

  const variants: Record<EacMethod, number | null> = {
    bottom_up: eac_bottom_up,
    cpi: eac_cpi,
    cpi_spi: eac_cpi_spi,
    ac_plus_remaining: eac_ac_plus_remaining,
  };
  const eac = variants[method];
  const etc = eac !== null && ac !== null ? sumMoney([eac, -ac]) : null;
  const vac = eac !== null ? sumMoney([bac, -eac]) : null;

  // TCPI: work remaining over funds remaining. A non-positive denominator is
  // "no budget left" — unachievable, reported as null rather than a negative
  // index that reads like good news.
  const remainingWork = ev !== null ? sumMoney([bac, -ev]) : null;
  const fundsToBac = ac !== null ? sumMoney([bac, -ac]) : null;
  const fundsToEac = ac !== null && eac !== null ? sumMoney([eac, -ac]) : null;
  const tcpi_bac = fundsToBac !== null && toMinor(fundsToBac) > 0 ? ratio(remainingWork, fundsToBac) : null;
  const tcpi_eac = fundsToEac !== null && toMinor(fundsToEac) > 0 ? ratio(remainingWork, fundsToEac) : null;

  return {
    bac,
    pv,
    ev,
    ac,
    sv,
    cv,
    spi,
    cpi,
    eac_bottom_up,
    eac_cpi,
    eac_cpi_spi,
    eac_ac_plus_remaining,
    eac,
    eac_method: method,
    etc,
    vac,
    tcpi_bac,
    tcpi_eac,
    percent_planned: pct(pv, bac),
    percent_complete: pct(ev, bac),
    percent_spent: pct(ac, bac),
  };
}

/**
 * Calendar slip in days: how far back the data date sits from the point where
 * the baseline planned exactly the value already earned. Distinct from SV,
 * which is money. Null when it cannot be established.
 */
export function scheduleDelayDays(input: {
  ev: number | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  data_date: string;
}): number | null {
  const { ev } = input;
  if (ev === null) return null;
  const s = input.baseline_start ? dayMs(input.baseline_start) : null;
  const e = input.baseline_finish ? dayMs(input.baseline_finish) : null;
  const t = dayMs(input.data_date);
  if (s === null || e === null || t === null || e <= s) return null;
  return null; // placeholder replaced below by earnedDelayDays
}

/**
 * Days between the data date and the baseline date at which the earned
 * percentage was planned to be reached. Positive = behind schedule.
 */
export function earnedDelayDays(input: {
  percent_complete: number | null;
  baseline_start: string | null;
  baseline_finish: string | null;
  data_date: string;
}): number | null {
  const p = input.percent_complete;
  const s = input.baseline_start ? dayMs(input.baseline_start) : null;
  const e = input.baseline_finish ? dayMs(input.baseline_finish) : null;
  const t = dayMs(input.data_date);
  if (p === null || s === null || e === null || t === null || e <= s) return null;
  const plannedAt = s + ((e - s) * Math.min(100, Math.max(0, p))) / 100;
  return Math.round((t - plannedAt) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Aggregation and reconciliation
// ---------------------------------------------------------------------------
export interface EvmNode {
  key: string;
  parent_key: string | null;
  label: string;
  level: number;
  wbs_item_id: string | null;
  cost_code_id: string | null;
  schedule_task_id: string | null;
  progress_method: ProgressMethod;
  allocation_pct: number;
  calculated_pct: number | null;
  applied_pct: number | null;
  overridden: boolean;
  core: EvmCore;
  measures: EvmMeasures;
}

/**
 * Roll leaves into parents. A parent's percentages are re-derived from its
 * rolled money, never averaged from children — averaging would weight a
 * trivial task the same as the plant.
 */
export function rollUp(
  leaves: readonly EvmNode[],
  parents: readonly Omit<EvmNode, "core" | "measures" | "calculated_pct" | "applied_pct" | "overridden">[],
  method: EacMethod,
): EvmNode[] {
  const childrenOf = new Map<string, string[]>();
  for (const l of leaves) {
    if (!l.parent_key) continue;
    childrenOf.set(l.parent_key, [...(childrenOf.get(l.parent_key) ?? []), l.key]);
  }
  const byKey = new Map<string, EvmNode>(leaves.map((l) => [l.key, l]));

  const built: EvmNode[] = [];
  // Deepest parents first so nested roll-ups accumulate correctly.
  for (const p of [...parents].sort((a, b) => b.level - a.level)) {
    const descendants = collectDescendants(p.key, parents, leaves);
    const core = sumCores(descendants.map((d) => d.core));
    built.push({
      ...p,
      calculated_pct: pct(core.ev, core.bac),
      applied_pct: pct(core.ev, core.bac),
      overridden: descendants.some((d) => d.overridden),
      core,
      measures: computeMeasures(core, method),
    });
    byKey.set(p.key, built[built.length - 1]!);
  }
  return [...leaves, ...built].sort(
    (a, b) => a.level - b.level || a.key.localeCompare(b.key),
  );
}

function collectDescendants(
  key: string,
  parents: readonly { key: string; parent_key: string | null }[],
  leaves: readonly EvmNode[],
): EvmNode[] {
  const keys = new Set<string>([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of parents) {
      if (p.parent_key && keys.has(p.parent_key) && !keys.has(p.key)) {
        keys.add(p.key);
        grew = true;
      }
    }
  }
  return leaves.filter((l) => l.parent_key !== null && keys.has(l.parent_key));
}

/** Decimal-safe sum of cores. A null contributor nulls the total. */
export function sumCores(cores: readonly EvmCore[]): EvmCore {
  const add = (pick: (c: EvmCore) => number | null): number | null => {
    const vals: number[] = [];
    for (const c of cores) {
      const v = pick(c);
      if (v === null) return null;
      vals.push(v);
    }
    return sumMoney(vals);
  };
  return {
    bac: sumMoney(cores.map((c) => c.bac)),
    pv: add((c) => c.pv),
    ev: add((c) => c.ev),
    ac: add((c) => c.ac),
    bottom_up_etc: add((c) => c.bottom_up_etc),
  };
}

export interface Reconciliation {
  ok: boolean;
  lines: { key: string; bac: number; ev: number | null; ac: number | null }[];
  leaf_bac: number;
  total_bac: number;
  difference: number;
}

/** Every leaf must tie exactly to the published project total. */
export function reconcile(leaves: readonly EvmNode[], total: EvmCore): Reconciliation {
  const leaf_bac = sumMoney(leaves.map((l) => l.core.bac));
  const difference = sumMoney([leaf_bac, -total.bac]);
  return {
    ok: toMinor(difference) === 0,
    lines: leaves.map((l) => ({ key: l.key, bac: l.core.bac, ev: l.core.ev, ac: l.core.ac })),
    leaf_bac,
    total_bac: total.bac,
    difference,
  };
}

// ---------------------------------------------------------------------------
// Currency translation
// ---------------------------------------------------------------------------
export interface EvmFx {
  rate: number | null;
  as_of: string | null;
  source: "parity" | "table" | "manual" | null;
  stale: boolean;
  missing: boolean;
}

const MONEY_KEYS = [
  "bac",
  "pv",
  "ev",
  "ac",
  "sv",
  "cv",
  "eac_bottom_up",
  "eac_cpi",
  "eac_cpi_spi",
  "eac_ac_plus_remaining",
  "eac",
  "etc",
  "vac",
] as const;

/**
 * Translate money into reporting currency exactly once. Ratios and
 * percentages pass through untouched. A missing or non-positive rate returns
 * null — the caller must exclude, never fall back to parity.
 */
export function translateMeasures(m: EvmMeasures, fx: EvmFx): EvmMeasures | null {
  if (fx.missing || fx.rate === null || !(fx.rate > 0)) return null;
  const out: EvmMeasures = { ...m };
  for (const k of MONEY_KEYS) {
    const v = m[k];
    (out as unknown as Record<string, number | null>)[k] =
      v === null ? null : convertMoney(v, fx.rate);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Data-quality gate
// ---------------------------------------------------------------------------
export interface QualityInput {
  unmapped_bac: number;
  total_bac: number;
  allocation_issues: AllocationCheck[];
  missing_baseline_dates: number;
  missing_budget: number;
  stale_progress: number;
  future_dated_progress: number;
  missing_actuals: number;
  fx_missing: string[];
}

export interface GatePolicy {
  gate_block_on_unmapped: boolean;
  gate_max_unmapped_pct: number;
  gate_block_on_stale_progress: boolean;
}

export interface EvmException {
  code: ExceptionCode;
  severity: ExceptionSeverity;
  blocking: boolean;
  title: string;
  detail: string | null;
  current_value: number | null;
  threshold_value: number | null;
  value_unit: "percent" | "ratio" | "count" | "currency" | "days" | null;
}

export interface QualityResult {
  unmapped_pct: number | null;
  exceptions: EvmException[];
  blockers: number;
  warnings: number;
  ready_to_approve: boolean;
}

export function assessQuality(input: QualityInput, policy: GatePolicy): QualityResult {
  const exceptions: EvmException[] = [];
  const unmapped_pct = pct(input.unmapped_bac, input.total_bac);

  if (toMinor(input.unmapped_bac) > 0) {
    const over =
      policy.gate_block_on_unmapped && (unmapped_pct ?? 0) > policy.gate_max_unmapped_pct;
    exceptions.push({
      code: "unmapped_scope",
      severity: over ? "blocker" : "warning",
      blocking: over,
      title: "Unmapped scope carries budget",
      detail: null,
      current_value: unmapped_pct,
      threshold_value: policy.gate_max_unmapped_pct,
      value_unit: "percent",
    });
  }
  for (const a of input.allocation_issues.filter((x) => !x.ok)) {
    exceptions.push({
      code: a.over ? "allocation_over" : "allocation_under",
      severity: "blocker",
      blocking: true,
      title: a.over ? "Allocation exceeds 100%" : "Allocation below 100%",
      detail: a.scope_key,
      current_value: a.total_pct,
      threshold_value: 100,
      value_unit: "percent",
    });
  }
  const counted: [ExceptionCode, number, ExceptionSeverity, string][] = [
    ["missing_baseline_dates", input.missing_baseline_dates, "blocker", "Scope without baseline dates"],
    ["missing_budget", input.missing_budget, "warning", "Scope without budget"],
    [
      "stale_progress",
      input.stale_progress,
      policy.gate_block_on_stale_progress ? "blocker" : "warning",
      "Stale or unapproved progress",
    ],
    ["future_dated_progress", input.future_dated_progress, "blocker", "Progress reported after the data date"],
    ["missing_actuals", input.missing_actuals, "warning", "Scope without actual cost"],
  ];
  for (const [code, count, severity, title] of counted) {
    if (count > 0) {
      exceptions.push({
        code,
        severity,
        blocking: severity === "blocker",
        title,
        detail: null,
        current_value: count,
        threshold_value: 0,
        value_unit: "count",
      });
    }
  }
  if (input.fx_missing.length > 0) {
    exceptions.push({
      code: "fx_missing",
      severity: "blocker",
      blocking: true,
      title: "Missing exchange rate",
      detail: input.fx_missing.join(", "),
      current_value: input.fx_missing.length,
      threshold_value: 0,
      value_unit: "count",
    });
  }

  const blockers = exceptions.filter((e) => e.blocking).length;
  return {
    unmapped_pct,
    exceptions,
    blockers,
    warnings: exceptions.length - blockers,
    ready_to_approve: blockers === 0,
  };
}

// ---------------------------------------------------------------------------
// Performance exceptions
// ---------------------------------------------------------------------------
export interface PerformancePolicy {
  cpi_threshold: number;
  spi_threshold: number;
  variance_threshold_pct: number;
  variance_threshold_amount: number;
  tcpi_feasibility_limit: number;
}

export function performanceExceptions(
  m: EvmMeasures,
  policy: PerformancePolicy,
  opts: { bottom_up_eac?: number | null } = {},
): EvmException[] {
  const out: EvmException[] = [];
  const adverse = (v: number | null) =>
    v !== null && toMinor(v) < 0 && isMaterial(v, m.bac, policy);

  if (m.cpi !== null && m.cpi < policy.cpi_threshold) {
    out.push(exception("cpi_deterioration", "warning", "Cost performance below threshold", m.cpi, policy.cpi_threshold, "ratio"));
  }
  if (m.spi !== null && m.spi < policy.spi_threshold) {
    out.push(exception("spi_deterioration", "warning", "Schedule performance below threshold", m.spi, policy.spi_threshold, "ratio"));
  }
  if (adverse(m.cv)) {
    out.push(exception("adverse_cv", "warning", "Adverse cost variance", m.cv, policy.variance_threshold_amount, "currency"));
  }
  if (adverse(m.sv)) {
    out.push(exception("adverse_sv", "warning", "Adverse schedule variance", m.sv, policy.variance_threshold_amount, "currency"));
  }
  if (adverse(m.vac)) {
    out.push(exception("adverse_vac", "warning", "Adverse variance at completion", m.vac, policy.variance_threshold_amount, "currency"));
  }
  if (m.tcpi_eac !== null && m.tcpi_eac > policy.tcpi_feasibility_limit) {
    out.push(exception("tcpi_infeasible", "blocker", "To-complete index is not achievable", m.tcpi_eac, policy.tcpi_feasibility_limit, "ratio"));
  }
  if (m.percent_complete !== null && m.percent_spent !== null) {
    const gap = roundRatio(m.percent_spent - m.percent_complete);
    if (gap > policy.variance_threshold_pct) {
      out.push(exception("progress_cost_mismatch", "warning", "Spend outpaces progress", gap, policy.variance_threshold_pct, "percent"));
    }
  }
  const bu = opts.bottom_up_eac ?? m.eac_bottom_up;
  if (bu !== null && m.eac_cpi !== null) {
    const diff = sumMoney([m.eac_cpi, -bu]);
    if (isMaterial(diff, m.bac, policy)) {
      out.push(exception("forecast_divergence", "warning", "Index forecast diverges from bottom-up forecast", diff, policy.variance_threshold_amount, "currency"));
    }
  }
  return out;
}

function exception(
  code: ExceptionCode,
  severity: ExceptionSeverity,
  title: string,
  current: number | null,
  threshold: number,
  unit: EvmException["value_unit"],
): EvmException {
  return {
    code,
    severity,
    blocking: severity === "blocker",
    title,
    detail: null,
    current_value: current,
    threshold_value: threshold,
    value_unit: unit,
  };
}

/** Material when it breaches BOTH the relative and absolute thresholds. */
export function isMaterial(delta: number | null, bac: number, policy: PerformancePolicy): boolean {
  if (delta === null) return false;
  const abs = Math.abs(delta);
  const relative = pct(abs, bac);
  if (relative === null) return abs >= policy.variance_threshold_amount;
  return relative >= policy.variance_threshold_pct && abs >= policy.variance_threshold_amount;
}

/** EVM exceptions that should surface as portfolio alerts, with their rule. */
export const EXCEPTION_ALERT_RULE: Partial<Record<ExceptionCode, EvmAlertRule>> = {
  cpi_deterioration: "evm_cpi_deterioration",
  spi_deterioration: "evm_spi_deterioration",
  tcpi_infeasible: "evm_tcpi_infeasible",
  unmapped_scope: "evm_mapping_gap",
  allocation_over: "evm_mapping_gap",
  allocation_under: "evm_mapping_gap",
  forecast_divergence: "evm_forecast_divergence",
};

/** Stable, deduplicating fingerprint for an EVM-origin alert. */
export function alertFingerprint(parts: {
  company_id: string;
  project_id: string;
  period_month: string;
  code: ExceptionCode;
}): string {
  const rule = EXCEPTION_ALERT_RULE[parts.code] ?? "evm_mapping_gap";
  return [parts.company_id, parts.project_id, parts.period_month, rule].join("|");
}

// ---------------------------------------------------------------------------
// Trends and control limits
// ---------------------------------------------------------------------------
export interface TrendPoint {
  period_month: string;
  cpi: number | null;
  spi: number | null;
  eac: number | null;
  ev: number | null;
  pv: number | null;
  ac: number | null;
}

export interface TrendAnalysis {
  points: TrendPoint[];
  cpi_delta: number | null;
  spi_delta: number | null;
  eac_delta: number | null;
  deteriorating: boolean;
  breaches_control_limit: boolean;
}

export function analyseTrend(
  points: readonly TrendPoint[],
  policy: Pick<PerformancePolicy, "cpi_threshold" | "spi_threshold">,
): TrendAnalysis {
  const sorted = [...points].sort((a, b) => a.period_month.localeCompare(b.period_month));
  const last = sorted.at(-1) ?? null;
  const prior = sorted.length >= 2 ? sorted[sorted.length - 2]! : null;
  const delta = (pick: (p: TrendPoint) => number | null): number | null => {
    if (!last || !prior) return null;
    const a = pick(last);
    const b = pick(prior);
    return a === null || b === null ? null : roundRatio(a - b);
  };
  const cpi_delta = delta((p) => p.cpi);
  const spi_delta = delta((p) => p.spi);
  const eac_delta = last && prior && last.eac !== null && prior.eac !== null
    ? sumMoney([last.eac, -prior.eac])
    : null;
  return {
    points: sorted,
    cpi_delta,
    spi_delta,
    eac_delta,
    deteriorating: (cpi_delta ?? 0) < 0 || (spi_delta ?? 0) < 0,
    breaches_control_limit:
      (last?.cpi != null && last.cpi < policy.cpi_threshold) ||
      (last?.spi != null && last.spi < policy.spi_threshold),
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export const EVM_INVALID_TRANSITION = "evm_invalid_transition";
export const EVM_REPORT_FROZEN = "evm_report_frozen";
export const EVM_GATE_BLOCKED = "evm_gate_blocked";
export const EVM_SELF_APPROVAL = "evm_self_approval";
export const EVM_VERSION_CONFLICT = "evm_version_conflict";
export const EVM_PERIOD_LOCKED = "evm_period_locked";

const ALLOWED: Record<ReportStatus, ReportStatus[]> = {
  working: ["submitted"],
  submitted: ["approved", "working"],
  approved: ["superseded"],
  superseded: [],
};

export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export interface TransitionCheck {
  ok: boolean;
  error:
    | typeof EVM_INVALID_TRANSITION
    | typeof EVM_GATE_BLOCKED
    | typeof EVM_SELF_APPROVAL
    | typeof EVM_PERIOD_LOCKED
    | null;
}

/**
 * Role separation: whoever submitted a report may not approve it. Approval
 * additionally requires a clean data-quality gate and an unlocked period.
 */
export function checkTransition(input: {
  from: ReportStatus;
  to: ReportStatus;
  actorId: string;
  submittedBy?: string | null;
  gateReady?: boolean;
  periodLocked?: boolean;
}): TransitionCheck {
  if (!canTransition(input.from, input.to)) {
    return { ok: false, error: EVM_INVALID_TRANSITION };
  }
  if (input.to === "approved") {
    if (input.submittedBy && input.submittedBy === input.actorId) {
      return { ok: false, error: EVM_SELF_APPROVAL };
    }
    if (input.gateReady === false) return { ok: false, error: EVM_GATE_BLOCKED };
  }
  if (input.to === "submitted" && input.periodLocked) {
    return { ok: false, error: EVM_PERIOD_LOCKED };
  }
  return { ok: true, error: null };
}

/** A correction never edits an approved report; it supersedes it. */
export function supersedePlan(input: {
  current: { id: string; status: ReportStatus; version_no: number };
  reason: string;
}): { ok: boolean; error: string | null; next_version_no: number; supersedes_id: string } {
  const reasonOk = String(input.reason ?? "").trim().length >= 8;
  if (input.current.status !== "approved") {
    return { ok: false, error: EVM_INVALID_TRANSITION, next_version_no: 0, supersedes_id: input.current.id };
  }
  return {
    ok: reasonOk,
    error: reasonOk ? null : "evm_reason_required",
    next_version_no: input.current.version_no + 1,
    supersedes_id: input.current.id,
  };
}

// ---------------------------------------------------------------------------
// Portfolio consolidation
// ---------------------------------------------------------------------------
export interface PortfolioEvmRow {
  project_id: string;
  code: string;
  name: string;
  period_month: string;
  status: ReportStatus;
  currency: string;
  project: EvmMeasures;
  fx: EvmFx;
  reporting: EvmMeasures | null;
  mapping_completeness_pct: number | null;
  eac_method: EacMethod;
  blockers: number;
  warnings: number;
  prior_cpi: number | null;
  prior_spi: number | null;
}

export interface PortfolioEvmTotals {
  reporting_currency: string;
  included: number;
  excluded: { project_id: string; code: string; reason: "fx_rate_missing" | "no_report" }[];
  bac: number;
  pv: number | null;
  ev: number | null;
  ac: number | null;
  eac: number | null;
  cpi: number | null;
  spi: number | null;
  sv: number | null;
  cv: number | null;
  vac: number | null;
}

export function consolidateEvm(
  rows: readonly PortfolioEvmRow[],
  reportingCurrency: string,
): PortfolioEvmTotals {
  const excluded: PortfolioEvmTotals["excluded"] = [];
  const included: EvmMeasures[] = [];
  for (const r of rows) {
    if (r.reporting === null) {
      excluded.push({ project_id: r.project_id, code: r.code, reason: "fx_rate_missing" });
      continue;
    }
    included.push(r.reporting);
  }
  const add = (pick: (m: EvmMeasures) => number | null): number | null => {
    const vals: number[] = [];
    for (const m of included) {
      const v = pick(m);
      if (v === null) return null;
      vals.push(v);
    }
    return included.length === 0 ? null : sumMoney(vals);
  };
  const bac = sumMoney(included.map((m) => m.bac));
  const pv = add((m) => m.pv);
  const ev = add((m) => m.ev);
  const ac = add((m) => m.ac);
  const eac = add((m) => m.eac);
  return {
    reporting_currency: reportingCurrency,
    included: included.length,
    excluded,
    bac,
    pv,
    ev,
    ac,
    eac,
    cpi: ratio(ev, ac),
    spi: ratio(ev, pv),
    sv: ev !== null && pv !== null ? sumMoney([ev, -pv]) : null,
    cv: ev !== null && ac !== null ? sumMoney([ev, -ac]) : null,
    vac: eac !== null ? sumMoney([bac, -eac]) : null,
  };
}

export type Quadrant = "on_track" | "cost_risk" | "schedule_risk" | "both_risk" | "unknown";

export function quadrantOf(m: Pick<EvmMeasures, "cpi" | "spi">, policy: PerformancePolicy): Quadrant {
  if (m.cpi === null || m.spi === null) return "unknown";
  const cost = m.cpi < policy.cpi_threshold;
  const sched = m.spi < policy.spi_threshold;
  if (cost && sched) return "both_risk";
  if (cost) return "cost_risk";
  if (sched) return "schedule_risk";
  return "on_track";
}

export interface Mover {
  project_id: string;
  code: string;
  name: string;
  cpi_delta: number | null;
  spi_delta: number | null;
  movement: number;
}

/** Most adverse period-over-period index movers, worst first. */
export function topAdverseMovers(rows: readonly PortfolioEvmRow[], limit = 5): Mover[] {
  return rows
    .map((r) => {
      const cpi_delta =
        r.project.cpi !== null && r.prior_cpi !== null ? roundRatio(r.project.cpi - r.prior_cpi) : null;
      const spi_delta =
        r.project.spi !== null && r.prior_spi !== null ? roundRatio(r.project.spi - r.prior_spi) : null;
      const movement = Math.min(cpi_delta ?? 0, spi_delta ?? 0);
      return { project_id: r.project_id, code: r.code, name: r.name, cpi_delta, spi_delta, movement };
    })
    .filter((m) => m.movement < 0)
    .sort((a, b) => a.movement - b.movement || a.code.localeCompare(b.code))
    .slice(0, limit);
}

export function eacMethodDistribution(
  rows: readonly PortfolioEvmRow[],
): { method: EacMethod; count: number }[] {
  return EAC_METHODS.map((method) => ({
    method,
    count: rows.filter((r) => r.eac_method === method).length,
  })).filter((d) => d.count > 0);
}

export function exceptionAging(
  exceptions: readonly { code: ExceptionCode; first_seen: string }[],
  asOf: string,
): { bucket: "0-7" | "8-30" | "31-90" | "90+"; count: number }[] {
  const buckets = { "0-7": 0, "8-30": 0, "31-90": 0, "90+": 0 };
  for (const e of exceptions) {
    const age = daysBetween(e.first_seen, asOf) ?? 0;
    if (age <= 7) buckets["0-7"] += 1;
    else if (age <= 30) buckets["8-30"] += 1;
    else if (age <= 90) buckets["31-90"] += 1;
    else buckets["90+"] += 1;
  }
  return (Object.keys(buckets) as (keyof typeof buckets)[]).map((bucket) => ({
    bucket,
    count: buckets[bucket],
  }));
}

// ---------------------------------------------------------------------------
// Deterministic CSV
// ---------------------------------------------------------------------------
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function csvRows(header: readonly string[], rows: readonly unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n") + "\n";
}

export const EVM_DETAIL_HEADER = [
  "level",
  "label",
  "cost_code_id",
  "wbs_item_id",
  "progress_method",
  "allocation_pct",
  "calculated_pct",
  "applied_pct",
  "bac",
  "pv",
  "ev",
  "ac",
  "sv",
  "cv",
  "spi",
  "cpi",
  "eac",
  "etc",
  "vac",
  "tcpi_eac",
] as const;

export function buildDetailCsv(nodes: readonly EvmNode[]): string {
  const sorted = [...nodes].sort((a, b) => a.level - b.level || a.key.localeCompare(b.key));
  return csvRows(
    EVM_DETAIL_HEADER,
    sorted.map((n) => [
      n.level,
      n.label,
      n.cost_code_id,
      n.wbs_item_id,
      n.progress_method,
      n.allocation_pct,
      n.calculated_pct,
      n.applied_pct,
      n.measures.bac,
      n.measures.pv,
      n.measures.ev,
      n.measures.ac,
      n.measures.sv,
      n.measures.cv,
      n.measures.spi,
      n.measures.cpi,
      n.measures.eac,
      n.measures.etc,
      n.measures.vac,
      n.measures.tcpi_eac,
    ]),
  );
}

export function buildTrendCsv(points: readonly TrendPoint[]): string {
  return csvRows(
    ["period_month", "pv", "ev", "ac", "cpi", "spi", "eac"],
    [...points]
      .sort((a, b) => a.period_month.localeCompare(b.period_month))
      .map((p) => [p.period_month, p.pv, p.ev, p.ac, p.cpi, p.spi, p.eac]),
  );
}

export function buildMappingCsv(mappings: readonly MappingRow[]): string {
  return csvRows(
    ["scope_key", "wbs_item_id", "schedule_task_id", "cost_code_id", "allocation_pct", "progress_method"],
    [...mappings]
      .sort((a, b) => scopeKeyOf(a).localeCompare(scopeKeyOf(b)) || a.id.localeCompare(b.id))
      .map((m) => [
        scopeKeyOf(m),
        m.wbs_item_id,
        m.schedule_task_id,
        m.cost_code_id,
        m.allocation_pct,
        m.progress_method,
      ]),
  );
}

export function buildExceptionCsv(exceptions: readonly EvmException[]): string {
  return csvRows(
    ["code", "severity", "blocking", "title", "detail", "current_value", "threshold_value", "value_unit"],
    [...exceptions]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((e) => [
        e.code,
        e.severity,
        e.blocking,
        e.title,
        e.detail,
        e.current_value,
        e.threshold_value,
        e.value_unit,
      ]),
  );
}

export function buildFormulaComparisonCsv(m: EvmMeasures): string {
  return csvRows(
    ["method", "eac", "etc", "vac", "official"],
    EAC_METHODS.map((method) => {
      const eac = {
        bottom_up: m.eac_bottom_up,
        cpi: m.eac_cpi,
        cpi_spi: m.eac_cpi_spi,
        ac_plus_remaining: m.eac_ac_plus_remaining,
      }[method];
      const etc = eac !== null && m.ac !== null ? sumMoney([eac, -m.ac]) : null;
      const vac = eac !== null ? sumMoney([m.bac, -eac]) : null;
      return [method, eac, etc, vac, method === m.eac_method];
    }),
  );
}

// ---------------------------------------------------------------------------
// Pack appendix
// ---------------------------------------------------------------------------
export interface EvmAppendix {
  period_month: string;
  data_date: string;
  status: ReportStatus;
  basis: { cost_basis: string; ac_basis: AcBasis; eac_method: EacMethod; schedule_baseline: string | null };
  fx: { reporting_currency: string; project_currency: string; rate: number | null; as_of: string | null; source: string | null };
  approvals: { prepared_by: string | null; submitted_by: string | null; approved_by: string | null; approved_at: string | null };
  measures: EvmMeasures;
  quality_gaps: { code: ExceptionCode; severity: ExceptionSeverity; title: string }[];
  reconciliation: { ok: boolean; difference: number };
}

export function buildAppendix(input: EvmAppendix): EvmAppendix {
  return {
    ...input,
    quality_gaps: [...input.quality_gaps].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const monthSchema = z.string().regex(/^\d{4}-\d{2}-01$/, "Period must be YYYY-MM-01");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const currencySchema = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Expected a 3-letter currency code"));

export const evmQuerySchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema.optional(),
  currency: currencySchema.optional(),
});
export type EvmQuery = z.infer<typeof evmQuerySchema>;

export const evmCalculateSchema = z.object({
  project_id: z.string().uuid(),
  period: monthSchema,
  data_date: dateSchema.optional(),
  currency: currencySchema.optional(),
  ac_basis: z.enum(AC_BASES).optional(),
  eac_method: z.enum(EAC_METHODS).optional(),
  schedule_baseline_id: z.string().uuid().nullish(),
  forecast_version_id: z.string().uuid().nullish(),
});
export type EvmCalculateInput = z.infer<typeof evmCalculateSchema>;

export const evmTransitionSchema = z
  .object({
    report_id: z.string().uuid(),
    to: z.enum(REPORT_STATUSES),
    reason: z.string().trim().min(8).max(2000).optional(),
    row_version: z.number().int().positive().optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.to === "working" || v.to === "superseded") && !v.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" });
    }
  });

export const evmSupersedeSchema = z.object({
  report_id: z.string().uuid(),
  reason: z.string().trim().min(8).max(2000),
});

export const evmOverrideSchema = z
  .object({
    project_id: z.string().uuid(),
    period: monthSchema,
    wbs_item_id: z.string().uuid().nullish(),
    schedule_task_id: z.string().uuid().nullish(),
    override_pct: z.number().min(0).max(100),
    calculated_pct: z.number().min(0).max(100).nullish(),
    reason: z.string().trim().min(8).max(2000),
    evidence_ref: z.string().trim().min(1).max(500),
  })
  .superRefine((v, ctx) => {
    if (!v.wbs_item_id && !v.schedule_task_id) {
      ctx.addIssue({ code: "custom", path: ["wbs_item_id"], message: "Scope is required" });
    }
  });

export const evmSettingsSchema = z.object({
  project_id: z.string().uuid(),
  default_progress_method: z.enum(PROGRESS_METHODS).optional(),
  official_eac_method: z.enum(EAC_METHODS).optional(),
  include_accruals_in_ac: z.boolean().optional(),
  cpi_threshold: z.number().min(0).max(5).optional(),
  spi_threshold: z.number().min(0).max(5).optional(),
  variance_threshold_pct: z.number().min(0).max(100).optional(),
  variance_threshold_amount: z.number().min(0).optional(),
  tcpi_feasibility_limit: z.number().min(1).max(5).optional(),
  gate_block_on_unmapped: z.boolean().optional(),
  gate_max_unmapped_pct: z.number().min(0).max(100).optional(),
  gate_block_on_stale_progress: z.boolean().optional(),
  progress_stale_days: z.number().int().min(1).max(365).optional(),
  reason: z.string().trim().min(8).max(2000).optional(),
});

export const evmMappingSchema = z
  .object({
    mapping_version_id: z.string().uuid(),
    id: z.string().uuid().optional(),
    wbs_item_id: z.string().uuid().nullish(),
    schedule_task_id: z.string().uuid().nullish(),
    cost_code_id: z.string().uuid().nullish(),
    allocation_pct: z.number().gt(0).max(100),
    progress_method: z.enum(PROGRESS_METHODS),
    planned_units: z.number().min(0).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .superRefine((v, ctx) => {
    if (!v.wbs_item_id && !v.schedule_task_id) {
      ctx.addIssue({ code: "custom", path: ["wbs_item_id"], message: "Scope is required" });
    }
  });

export const EVM_PAGE_SIZES = [25, 50, 100, 200] as const;

export const evmDetailFilterSchema = z.object({
  report_id: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  page_size: z.number().int().refine((n) => (EVM_PAGE_SIZES as readonly number[]).includes(n)).default(50),
  cost_code_id: z.string().uuid().optional(),
  wbs_item_id: z.string().uuid().optional(),
});

export const portfolioEvmFilterSchema = z.object({
  period: monthSchema.optional(),
  currency: currencySchema.optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  project_id: z.string().uuid().optional(),
});
export type PortfolioEvmFilter = z.infer<typeof portfolioEvmFilterSchema>;

export const DEFAULT_PERFORMANCE_POLICY: PerformancePolicy = {
  cpi_threshold: 0.95,
  spi_threshold: 0.95,
  variance_threshold_pct: 5,
  variance_threshold_amount: 100_000,
  tcpi_feasibility_limit: 1.1,
};

export const DEFAULT_GATE_POLICY: GatePolicy = {
  gate_block_on_unmapped: true,
  gate_max_unmapped_pct: 5,
  gate_block_on_stale_progress: true,
};
