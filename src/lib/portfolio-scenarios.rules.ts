// GC-11 — Portfolio Scenario & Risk Forecasting: pure decision rules.
//
// Scenarios are *non-posting overlays*. They never mutate an approved forecast
// version, never re-rate a locked snapshot and never write back a number. Each
// scenario is anchored to one authoritative consolidation (period + basis +
// reporting currency) and expresses deltas on top of it.
//
// Money discipline mirrors the rest of the costing stack: `roundMoney` /
// `sumMoney` in minor units, one rounding per translation, ratios untranslated.
import { z } from "zod";

import { convertMoney, roundMoney, sumMoney } from "@/lib/costing.fx";
import type {
  ConsolidationRate,
  PortfolioMeasures,
  PortfolioProjectRow,
} from "@/lib/portfolio-costing.rules";

export const SCENARIO_CONFIG_VERSION = 1;

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
export const SCENARIO_DRIVERS = [
  "etc_adjust",
  "commitment_timing",
  "cash_timing",
  "change_probability",
  "risk_threat",
  "risk_opportunity",
  "contingency_draw",
  "contingency_release",
  "schedule_delay",
  "escalation",
  "inflation",
  "fx_shock",
] as const;

export type ScenarioDriver = (typeof SCENARIO_DRIVERS)[number];

/** Drivers that move cost (EAC). Timing drivers move cash only. */
export const COST_DRIVERS: readonly ScenarioDriver[] = [
  "etc_adjust",
  "change_probability",
  "risk_threat",
  "risk_opportunity",
  "contingency_draw",
  "contingency_release",
  "schedule_delay",
  "escalation",
  "inflation",
];

/** Drivers whose contribution is probability-weighted (risk-adjusted). */
export const PROBABILISTIC_DRIVERS: readonly ScenarioDriver[] = [
  "change_probability",
  "risk_threat",
  "risk_opportunity",
];

export const TIMING_DRIVERS: readonly ScenarioDriver[] = ["commitment_timing", "cash_timing"];

/** Bridge presentation order — stable so the waterfall never reshuffles. */
export const BRIDGE_ORDER: readonly ScenarioDriver[] = [
  "etc_adjust",
  "escalation",
  "inflation",
  "schedule_delay",
  "change_probability",
  "risk_threat",
  "risk_opportunity",
  "contingency_draw",
  "contingency_release",
];

export type ScenarioStatus = "draft" | "shared" | "locked" | "archived";
export type ScenarioFxMode = "snapshot" | "current" | "shock";

export interface ScenarioAssumption {
  id: string;
  scenario_id: string;
  project_id: string | null;
  cost_code_id: string | null;
  driver: ScenarioDriver;
  period_month: string | null;
  label: string | null;
  amount: number | null;
  pct: number | null;
  probability: number | null;
  delay_months: number | null;
  currency_code: string | null;
  source_table: string | null;
  source_id: string | null;
  note: string | null;
  sort_order: number;
}

export interface Scenario {
  id: string;
  company_id: string;
  owner_id: string;
  owner_name: string | null;
  is_owner: boolean;
  name: string;
  purpose: string | null;
  notes: string | null;
  status: ScenarioStatus;
  source_period: string;
  source_basis: "period_end" | "latest";
  reporting_currency: string;
  fx_mode: ScenarioFxMode;
  fx_shock_pct: number;
  horizon_months: number;
  source_versions: { project_id: string; version_id: string | null; version_no: number | null }[];
  config_version: number;
  revision: number;
  copied_from_id: string | null;
  locked_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export const isEditableStatus = (status: ScenarioStatus): boolean => status === "draft";

// ---------------------------------------------------------------------------
// Driver arithmetic
// ---------------------------------------------------------------------------
/**
 * Expected (probability-weighted) cost impact of one assumption, in the
 * project's own currency, positive = adds cost.
 *
 * `baseEtc` is the anchor for percentage drivers so escalation/inflation are
 * always "x% of the approved remaining work", never of a moving target.
 */
export function assumptionImpact(a: ScenarioAssumption, baseEtc: number): number {
  if (!COST_DRIVERS.includes(a.driver)) return 0;
  const p = PROBABILISTIC_DRIVERS.includes(a.driver)
    ? a.probability === null
      ? 1
      : Math.min(1, Math.max(0, a.probability))
    : 1;

  let raw = 0;
  switch (a.driver) {
    case "escalation":
    case "inflation":
      raw = a.pct !== null ? (baseEtc * a.pct) / 100 : (a.amount ?? 0);
      break;
    case "schedule_delay":
      // amount = monthly carrying cost, delay_months = months slipped.
      raw = (a.amount ?? 0) * (a.delay_months ?? 0);
      break;
    case "risk_opportunity":
    case "contingency_release":
      raw = -Math.abs(a.pct !== null ? (baseEtc * a.pct) / 100 : (a.amount ?? 0));
      break;
    default:
      raw = a.pct !== null ? (baseEtc * a.pct) / 100 : (a.amount ?? 0);
  }
  return roundMoney(raw * p);
}

/** Deterministic uncertainty band from Bernoulli risk lines (no simulation). */
export function riskBand(
  assumptions: readonly ScenarioAssumption[],
  baseEtc: number,
): { expected: number; sigma: number; p50: number; p80: number } {
  let expected = 0;
  let variance = 0;
  for (const a of assumptions) {
    if (!PROBABILISTIC_DRIVERS.includes(a.driver)) continue;
    const impactAtCertainty = assumptionImpact({ ...a, probability: 1 }, baseEtc);
    const p = a.probability === null ? 1 : Math.min(1, Math.max(0, a.probability));
    expected += impactAtCertainty * p;
    variance += impactAtCertainty * impactAtCertainty * p * (1 - p);
  }
  const sigma = Math.sqrt(Math.max(0, variance));
  return {
    expected: roundMoney(expected),
    sigma: roundMoney(sigma),
    p50: roundMoney(expected),
    // 0.8416 = standard normal 80th percentile.
    p80: roundMoney(expected + 0.8416 * sigma),
  };
}

export interface BridgeStep {
  driver: ScenarioDriver | "base" | "scenario";
  amount: number;
  cumulative: number;
}

/** Ordered EAC bridge that always ties to the scenario EAC exactly. */
export function buildBridge(
  baseEac: number,
  assumptions: readonly ScenarioAssumption[],
  baseEtc: number,
): BridgeStep[] {
  const byDriver = new Map<ScenarioDriver, number>();
  for (const a of assumptions) {
    const impact = assumptionImpact(a, baseEtc);
    if (impact === 0) continue;
    byDriver.set(a.driver, roundMoney((byDriver.get(a.driver) ?? 0) + impact));
  }
  let cumulative = roundMoney(baseEac);
  const steps: BridgeStep[] = [{ driver: "base", amount: cumulative, cumulative }];
  for (const driver of BRIDGE_ORDER) {
    const amount = byDriver.get(driver);
    if (amount === undefined || amount === 0) continue;
    cumulative = sumMoney([cumulative, amount]);
    steps.push({ driver, amount, cumulative });
  }
  steps.push({ driver: "scenario", amount: cumulative, cumulative });
  return steps;
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------
/**
 * Apply a cost delta to a measure set without re-deriving the authoritative
 * figures: committed / actual / accruals / budget are untouched.
 */
export function overlayMeasures(base: PortfolioMeasures, deltaEtc: number): PortfolioMeasures {
  const etc = roundMoney(base.etc + deltaEtc);
  const eac = roundMoney(base.eac + deltaEtc);
  return {
    ...base,
    etc,
    eac,
    vac: roundMoney(base.budget_current - eac),
    percent_consumed:
      base.budget_current === 0 ? null : Math.round((eac / base.budget_current) * 1e4) / 1e4,
  };
}

/** FX stress applied to a consolidation rate. Parity never moves. */
export function stressRate(
  rate: ConsolidationRate,
  mode: ScenarioFxMode,
  shockPct: number,
  isParity: boolean,
): ConsolidationRate {
  if (mode !== "shock" || isParity || rate.missing || rate.rate === null) return rate;
  const stressed = rate.rate * (1 + shockPct / 100);
  if (!(stressed > 0)) return { ...rate, rate: null, missing: true };
  return { ...rate, rate: Math.round(stressed * 1e8) / 1e8, source: "manual" };
}

export interface ScenarioProjectResult {
  project_id: string;
  code: string;
  name: string;
  currency: string;
  basis: PortfolioProjectRow["basis"];
  excluded_reason: "fx_rate_missing" | "no_snapshot" | null;
  base_project: PortfolioMeasures;
  scenario_project: PortfolioMeasures;
  base_reporting: PortfolioMeasures | null;
  scenario_reporting: PortfolioMeasures | null;
  rate: ConsolidationRate;
  delta_etc: number;
  delta_eac_reporting: number | null;
  bridge: BridgeStep[];
  band: { expected: number; sigma: number; p50: number; p80: number };
  assumption_count: number;
}

/** Translate one measure set at one explicit rate (money only, ratios kept). */
function translate(m: PortfolioMeasures, rate: ConsolidationRate): PortfolioMeasures | null {
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
    percent_consumed: m.percent_consumed,
  };
}

export function buildScenarioProject(
  row: PortfolioProjectRow,
  assumptions: readonly ScenarioAssumption[],
  opts: { reportingCurrency: string; fxMode: ScenarioFxMode; fxShockPct: number },
): ScenarioProjectResult {
  const applicable = assumptions.filter(
    (a) => a.project_id === null || a.project_id === row.project_id,
  );
  const baseEtc = row.project.etc;
  const deltaEtc = sumMoney(applicable.map((a) => assumptionImpact(a, baseEtc)));
  const scenarioProject = overlayMeasures(row.project, deltaEtc);

  const isParity = row.currency === opts.reportingCurrency;
  const rate = stressRate(row.rate, opts.fxMode, opts.fxShockPct, isParity);
  const baseReporting = translate(row.project, rate);
  const scenarioReporting = translate(scenarioProject, rate);

  const excluded: ScenarioProjectResult["excluded_reason"] =
    row.basis === "none" ? "no_snapshot" : scenarioReporting === null ? "fx_rate_missing" : null;

  return {
    project_id: row.project_id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    basis: row.basis,
    excluded_reason: excluded,
    base_project: row.project,
    scenario_project: scenarioProject,
    base_reporting: baseReporting,
    scenario_reporting: scenarioReporting,
    rate,
    delta_etc: deltaEtc,
    delta_eac_reporting:
      baseReporting && scenarioReporting
        ? roundMoney(scenarioReporting.eac - baseReporting.eac)
        : null,
    bridge: buildBridge(row.project.eac, applicable, baseEtc),
    band: riskBand(applicable, baseEtc),
    assumption_count: applicable.length,
  };
}

export interface ScenarioTotals {
  base_eac: number;
  scenario_eac: number;
  delta_eac: number;
  delta_pct: number | null;
  base_budget: number;
  scenario_vac: number;
  base_vac: number;
  p50: number;
  p80: number;
  included: number;
  excluded: { project_id: string; code: string; reason: string }[];
}

export function consolidateScenario(results: readonly ScenarioProjectResult[]): {
  totals: ScenarioTotals;
  bridge: BridgeStep[];
} {
  const included = results.filter((r) => r.excluded_reason === null && r.scenario_reporting);
  const excluded = results
    .filter((r) => r.excluded_reason !== null || !r.scenario_reporting)
    .map((r) => ({
      project_id: r.project_id,
      code: r.code,
      reason: r.excluded_reason ?? "fx_rate_missing",
    }));

  const baseEac = sumMoney(included.map((r) => r.base_reporting!.eac));
  const scenarioEac = sumMoney(included.map((r) => r.scenario_reporting!.eac));
  const baseBudget = sumMoney(included.map((r) => r.base_reporting!.budget_current));

  // Portfolio bridge: aggregate the per-project steps at reporting rates.
  const byDriver = new Map<ScenarioDriver, number>();
  for (const r of included) {
    const rate = r.rate.rate ?? 1;
    for (const step of r.bridge) {
      if (step.driver === "base" || step.driver === "scenario") continue;
      const converted = convertMoney(step.amount, rate);
      byDriver.set(step.driver, roundMoney((byDriver.get(step.driver) ?? 0) + converted));
    }
  }
  let cumulative = baseEac;
  const bridge: BridgeStep[] = [{ driver: "base", amount: baseEac, cumulative }];
  for (const driver of BRIDGE_ORDER) {
    const amount = byDriver.get(driver);
    if (amount === undefined || amount === 0) continue;
    cumulative = sumMoney([cumulative, amount]);
    bridge.push({ driver, amount, cumulative });
  }
  // Guarantee the bridge ties: any rounding residue is shown, never hidden.
  const residue = roundMoney(scenarioEac - cumulative);
  if (residue !== 0) {
    cumulative = sumMoney([cumulative, residue]);
    bridge.push({ driver: "etc_adjust", amount: residue, cumulative });
  }
  bridge.push({ driver: "scenario", amount: scenarioEac, cumulative: scenarioEac });

  // Independent risks: variances add, sigmas do not.
  const sigma = Math.sqrt(
    included.reduce((acc, r) => {
      const s = convertMoney(r.band.sigma, r.rate.rate ?? 1);
      return acc + s * s;
    }, 0),
  );

  return {
    totals: {
      base_eac: baseEac,
      scenario_eac: scenarioEac,
      delta_eac: roundMoney(scenarioEac - baseEac),
      delta_pct: baseEac === 0 ? null : Math.round(((scenarioEac - baseEac) / baseEac) * 1e4) / 1e4,
      base_budget: baseBudget,
      base_vac: roundMoney(baseBudget - baseEac),
      scenario_vac: roundMoney(baseBudget - scenarioEac),
      p50: roundMoney(scenarioEac),
      p80: roundMoney(scenarioEac + 0.8416 * sigma),
      included: included.length,
      excluded,
    },
    bridge,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------
export interface ComparisonLine {
  project_id: string;
  code: string;
  name: string;
  left: number | null;
  right: number | null;
  delta: number | null;
}

export function compareScenarios(
  left: readonly ScenarioProjectResult[],
  right: readonly ScenarioProjectResult[],
): { lines: ComparisonLine[]; delta_total: number } {
  const rightById = new Map(right.map((r) => [r.project_id, r]));
  const lines: ComparisonLine[] = left
    .map((l) => {
      const r = rightById.get(l.project_id) ?? null;
      const lv = l.scenario_reporting?.eac ?? null;
      const rv = r?.scenario_reporting?.eac ?? null;
      return {
        project_id: l.project_id,
        code: l.code,
        name: l.name,
        left: lv,
        right: rv,
        delta: lv === null || rv === null ? null : roundMoney(rv - lv),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    lines,
    delta_total: sumMoney(lines.map((l) => l.delta ?? 0)),
  };
}

// ---------------------------------------------------------------------------
// CSV (deterministic: fixed header, fixed row order, no locale formatting)
// ---------------------------------------------------------------------------
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildScenarioCsv(
  scenario: Pick<Scenario, "name" | "source_period" | "reporting_currency" | "fx_mode">,
  results: readonly ScenarioProjectResult[],
  totals: ScenarioTotals,
): string {
  const header = [
    "scenario",
    "period",
    "currency",
    "fx_mode",
    "project_code",
    "project_name",
    "project_currency",
    "base_eac_reporting",
    "scenario_eac_reporting",
    "delta_eac_reporting",
    "delta_etc_project",
    "assumptions",
    "excluded_reason",
  ];
  const lines = [header.join(",")];
  for (const r of [...results].sort((a, b) => a.code.localeCompare(b.code))) {
    lines.push(
      [
        scenario.name,
        scenario.source_period,
        scenario.reporting_currency,
        scenario.fx_mode,
        r.code,
        r.name,
        r.currency,
        r.base_reporting?.eac ?? "",
        r.scenario_reporting?.eac ?? "",
        r.delta_eac_reporting ?? "",
        r.delta_etc,
        r.assumption_count,
        r.excluded_reason ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  lines.push(
    [
      scenario.name,
      scenario.source_period,
      scenario.reporting_currency,
      scenario.fx_mode,
      "TOTAL",
      `${totals.included} projects included`,
      "",
      totals.base_eac,
      totals.scenario_eac,
      totals.delta_eac,
      "",
      "",
      totals.excluded.length ? `${totals.excluded.length} excluded` : "",
    ]
      .map(csvCell)
      .join(","),
  );
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "Period must be the first day of a month (YYYY-MM-01).");

const currencySchema = z
  .string()
  .transform((v) => v.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO code."));

export const scenarioNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "Name is required.").max(120));

export const scenarioCreateSchema = z
  .object({
    name: scenarioNameSchema,
    purpose: z.string().max(500).nullable().default(null),
    notes: z.string().max(4000).nullable().default(null),
    source_period: periodSchema.optional(),
    source_basis: z.enum(["period_end", "latest"]).default("period_end"),
    reporting_currency: currencySchema.optional(),
    fx_mode: z.enum(["snapshot", "current", "shock"]).default("snapshot"),
    fx_shock_pct: z.number().min(-90).max(500).default(0),
    horizon_months: z.number().int().min(1).max(60).default(12),
  })
  .strict();

export const scenarioUpdateSchema = z
  .object({
    id: z.string().uuid(),
    name: scenarioNameSchema.optional(),
    purpose: z.string().max(500).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    fx_mode: z.enum(["snapshot", "current", "shock"]).optional(),
    fx_shock_pct: z.number().min(-90).max(500).optional(),
    horizon_months: z.number().int().min(1).max(60).optional(),
    reporting_currency: currencySchema.optional(),
    source_basis: z.enum(["period_end", "latest"]).optional(),
    /** Optimistic concurrency: rejected when the scenario moved on. */
    revision: z.number().int().min(1).optional(),
  })
  .strict();

export const scenarioIdSchema = z.object({ id: z.string().uuid() }).strict();

export const scenarioLifecycleSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(["share", "unshare", "lock", "archive"]),
  })
  .strict();

export const scenarioDuplicateSchema = z
  .object({ id: z.string().uuid(), name: scenarioNameSchema })
  .strict();

export const assumptionSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    scenario_id: z.string().uuid(),
    project_id: z.string().uuid().nullable().default(null),
    cost_code_id: z.string().uuid().nullable().default(null),
    driver: z.enum(SCENARIO_DRIVERS),
    period_month: periodSchema.nullable().default(null),
    label: z.string().max(200).nullable().default(null),
    amount: z.number().finite().nullable().default(null),
    pct: z.number().min(-100).max(1000).nullable().default(null),
    probability: z.number().min(0).max(1).nullable().default(null),
    delay_months: z.number().int().min(-36).max(36).nullable().default(null),
    currency_code: currencySchema.nullable().default(null),
    source_table: z.string().max(64).nullable().default(null),
    source_id: z.string().uuid().nullable().default(null),
    note: z.string().max(1000).nullable().default(null),
    sort_order: z.number().int().min(0).max(9999).default(0),
  })
  .strict()
  .refine((v) => v.amount !== null || v.pct !== null || v.delay_months !== null, {
    message: "Provide an amount, a percentage or a delay.",
    path: ["amount"],
  });

export const assumptionDeleteSchema = z
  .object({ id: z.string().uuid(), scenario_id: z.string().uuid() })
  .strict();

export const scenarioViewSchema = z
  .object({
    id: z.string().uuid(),
    compare_to: z.string().uuid().nullable().default(null),
  })
  .strict();

export const scenarioListSchema = z
  .object({
    status: z.enum(["all", "draft", "shared", "locked", "archived"]).default("all"),
    mine: z.boolean().default(false),
  })
  .strict();

export type ScenarioCreateInput = z.infer<typeof scenarioCreateSchema>;
export type ScenarioUpdateInput = z.infer<typeof scenarioUpdateSchema>;
export type AssumptionSaveInput = z.infer<typeof assumptionSaveSchema>;
export type ScenarioListFilter = z.infer<typeof scenarioListSchema>;
