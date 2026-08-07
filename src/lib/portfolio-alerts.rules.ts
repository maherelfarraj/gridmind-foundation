// GC-10 — Portfolio Finance Alerts: pure rule evaluation, lifecycle and formatting.
//
// This module NEVER re-derives money. Every figure it reads has already been
// computed by the authoritative portfolio aggregation (frozen snapshots,
// budget ledger, recorded payments, close checklists and exceptions); the
// rules only compare those figures against company-configured thresholds.
// No FX fallback happens here either: a missing rate is a *condition to alert
// on*, never something to silently substitute.
import { z } from "zod";

import type { PortfolioProjectRow } from "@/lib/portfolio-costing.rules";
import {
  evaluateRecognitionAlerts,
  type AlertThresholds as RecognitionThresholds,
  type PortfolioProjectInput,
  type RecognitionAlert,
} from "@/lib/recognition.rules";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const ALERT_RULE_TYPES = [
  "fx_missing",
  "forecast_stale",
  "eac_deterioration",
  "budget_breach",
  "commitment_breach",
  "actual_breach",
  "checklist_overdue",
  "exception_aging",
  "evidence_missing",
  "close_readiness",
  "period_reopened",
  "audit_gap",
  "liquidity_shortfall",
  "funding_headroom",
  "covenant_breach",
  // GC-15 — governed revenue / WIP recognition families. They are evaluated
  // from approved recognition snapshots and never re-derive money here.
  "revenue_margin_erosion",
  "revenue_loss_making",
  "recognition_basis_stale",
  "recognition_fx_missing",
  "revenue_reversal_material",
  "wip_underbilling_age",
  "contract_liability_movement",
  "unapproved_variation_exposure",
  "retention_release_overdue",
  "recognition_billing_lag",
  "recognition_reconciliation_failed",
  "recognition_adjustment_pending",
  "recognition_approval_delay",
] as const;

export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "snoozed", "resolved"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const ALERT_UNITS = ["percent", "ratio", "days", "count", "currency"] as const;
export type AlertUnit = (typeof ALERT_UNITS)[number];

export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export interface AlertRuleConfig {
  rule_type: AlertRuleType;
  enabled: boolean;
  severity: AlertSeverity;
  /** Semantics depend on `threshold_unit`; null means "the rule has no dial". */
  threshold_value: number | null;
  threshold_unit: AlertUnit;
  /** Days of warning before a deadline (close date, forecast staleness grace). */
  lead_days: number;
  ack_sla_hours: number;
  notify_roles: string[];
  escalate_roles: string[];
}

/**
 * Defaults mirror the seeded rows in migration GC-10 so an unconfigured
 * company behaves identically to a freshly seeded one.
 */
export const DEFAULT_ALERT_CONFIGS: Record<AlertRuleType, AlertRuleConfig> = {
  fx_missing: mk("fx_missing", "critical", null, "count", 0, 24),
  forecast_stale: mk("forecast_stale", "high", 45, "days", 5, 48),
  eac_deterioration: mk("eac_deterioration", "high", 0.05, "percent", 0, 48),
  budget_breach: mk("budget_breach", "critical", 1.0, "ratio", 0, 24),
  commitment_breach: mk("commitment_breach", "high", 0.95, "ratio", 0, 48),
  actual_breach: mk("actual_breach", "medium", 0.9, "ratio", 0, 72),
  checklist_overdue: mk("checklist_overdue", "high", 0, "days", 3, 48),
  exception_aging: mk("exception_aging", "high", 7, "days", 0, 48),
  evidence_missing: mk("evidence_missing", "medium", 0, "count", 3, 72),
  close_readiness: mk("close_readiness", "high", null, "count", 5, 48),
  period_reopened: mk("period_reopened", "critical", null, "count", 0, 24),
  audit_gap: mk("audit_gap", "medium", 0, "count", 0, 72),
  liquidity_shortfall: mk("liquidity_shortfall", "critical", 0, "currency", 0, 24),
  funding_headroom: mk("funding_headroom", "high", 0.9, "ratio", 0, 48),
  covenant_breach: mk("covenant_breach", "critical", 0, "count", 0, 24),
  revenue_margin_erosion: mk("revenue_margin_erosion", "high", 0.05, "percent", 0, 48),
  revenue_loss_making: mk("revenue_loss_making", "critical", 0, "currency", 0, 24),
  recognition_basis_stale: mk("recognition_basis_stale", "high", 45, "days", 5, 48),
  recognition_fx_missing: mk("recognition_fx_missing", "critical", 0, "count", 0, 24),
  revenue_reversal_material: mk("revenue_reversal_material", "critical", 50000, "currency", 0, 24),
  wip_underbilling_age: mk("wip_underbilling_age", "high", 60, "days", 0, 48),
  contract_liability_movement: mk("contract_liability_movement", "medium", 0.2, "percent", 0, 72),
  unapproved_variation_exposure: mk(
    "unapproved_variation_exposure",
    "medium",
    100000,
    "currency",
    0,
    72,
  ),
  retention_release_overdue: mk("retention_release_overdue", "medium", 0, "days", 0, 72),
  recognition_billing_lag: mk("recognition_billing_lag", "medium", 60, "days", 0, 72),
  recognition_reconciliation_failed: mk(
    "recognition_reconciliation_failed",
    "critical",
    0,
    "count",
    0,
    24,
  ),
  recognition_adjustment_pending: mk("recognition_adjustment_pending", "medium", 0, "count", 0, 72),
  recognition_approval_delay: mk("recognition_approval_delay", "high", 7, "days", 0, 48),
};

function mk(
  rule_type: AlertRuleType,
  severity: AlertSeverity,
  threshold_value: number | null,
  threshold_unit: AlertUnit,
  lead_days: number,
  ack_sla_hours: number,
): AlertRuleConfig {
  return {
    rule_type,
    enabled: true,
    severity,
    threshold_value,
    threshold_unit,
    lead_days,
    ack_sla_hours,
    notify_roles: ["finance_admin", "company_admin"],
    escalate_roles: ["company_admin"],
  };
}

/** Unit each rule reports its measured value in — used for labels and validation. */
export const RULE_UNIT: Record<AlertRuleType, AlertUnit> = Object.fromEntries(
  ALERT_RULE_TYPES.map((r) => [r, DEFAULT_ALERT_CONFIGS[r].threshold_unit]),
) as Record<AlertRuleType, AlertUnit>;

const UNIT_BOUNDS: Record<AlertUnit, { min: number; max: number }> = {
  percent: { min: 0, max: 10 },
  ratio: { min: 0, max: 10 },
  days: { min: 0, max: 3650 },
  count: { min: 0, max: 100000 },
  currency: { min: 0, max: 1e15 },
};

export const alertConfigUpdateSchema = z
  .object({
    rule_type: z.enum(ALERT_RULE_TYPES),
    enabled: z.boolean(),
    severity: z.enum(ALERT_SEVERITIES),
    threshold_value: z.number().finite().nullable(),
    lead_days: z.number().int().min(0).max(90),
    ack_sla_hours: z.number().int().min(1).max(720),
    notify_roles: z.array(z.string().min(1)).min(1).max(6),
    escalate_roles: z.array(z.string().min(1)).max(6),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    const unit = RULE_UNIT[cfg.rule_type];
    if (cfg.threshold_value === null) {
      if (DEFAULT_ALERT_CONFIGS[cfg.rule_type].threshold_value !== null) {
        ctx.addIssue({
          code: "custom",
          path: ["threshold_value"],
          message: "threshold_required",
        });
      }
      return;
    }
    const bounds = UNIT_BOUNDS[unit];
    if (cfg.threshold_value < bounds.min || cfg.threshold_value > bounds.max) {
      ctx.addIssue({
        code: "custom",
        path: ["threshold_value"],
        message: "threshold_out_of_range",
      });
    }
  });

export type AlertConfigUpdate = z.infer<typeof alertConfigUpdateSchema>;

export function mergeConfigs(
  rows: readonly Partial<AlertRuleConfig>[],
): Record<AlertRuleType, AlertRuleConfig> {
  const out = { ...DEFAULT_ALERT_CONFIGS };
  for (const row of rows) {
    const key = row.rule_type;
    if (!key || !ALERT_RULE_TYPES.includes(key)) continue;
    out[key] = {
      ...DEFAULT_ALERT_CONFIGS[key],
      ...row,
      rule_type: key,
      threshold_unit: RULE_UNIT[key],
    } as AlertRuleConfig;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type AlertContext = { [k: string]: JsonValue };

export interface AlertCandidate {
  rule_type: AlertRuleType;
  project_id: string | null;
  period_month: string | null;
  fingerprint: string;
  severity: AlertSeverity;
  current_value: number | null;
  threshold_value: number | null;
  value_unit: AlertUnit;
  currency_code: string | null;
  entity_table: string | null;
  entity_id: string | null;
  title: string;
  detail: string;
  deep_link: string;
  owner_id: string | null;
  context: AlertContext;
}

/**
 * Stable dedupe key. Re-evaluating the same condition must land on the same
 * fingerprint so the register updates one occurrence instead of spamming rows.
 */
export function fingerprintOf(parts: {
  rule_type: AlertRuleType;
  project_id?: string | null;
  period_month?: string | null;
  entity_id?: string | null;
  discriminator?: string | null;
}): string {
  return [
    parts.rule_type,
    parts.project_id ?? "-",
    parts.period_month ?? "-",
    parts.entity_id ?? "-",
    parts.discriminator ?? "-",
  ].join("|");
}

export interface OpenException {
  id: string;
  project_id: string | null;
  period_month: string | null;
  title: string | null;
  severity: string | null;
  status: string | null;
  first_seen_at: string | null;
  owner_id: string | null;
}

export interface EvaluationInput {
  period: string;
  /** Reporting "today" in the company timezone, `YYYY-MM-DD`. */
  today: string;
  period_end: string;
  reporting_currency: string;
  rows: readonly PortfolioProjectRow[];
  configs: Record<AlertRuleType, AlertRuleConfig>;
  exceptions: readonly OpenException[];
  /** Periods reopened or overridden inside the reporting window. */
  reopened: readonly { project_id: string | null; period_month: string; at: string }[];
  /** Count of unreconciled portfolio audit events for the period. */
  audit_gaps: number;
  /** GC-13 — governed cash-flow snapshots feeding the liquidity families. */
  liquidity?: readonly LiquidityAlertRow[];
}

/** One project's governed liquidity position, already in reporting currency. */
export interface LiquidityAlertRow {
  project_id: string;
  code: string;
  snapshot_id: string | null;
  currency_code: string;
  first_shortfall_bucket: string | null;
  minimum_liquidity: number;
  unfunded_requirement: number;
  utilization_pct: number | null;
  breached_covenants: readonly { facility_id: string; code: string }[];
}

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  const b = Date.parse(toIso.length === 10 ? `${toIso}T00:00:00Z` : toIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / DAY_MS);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function link(period: string, projectId: string | null, tab: string): string {
  const q = new URLSearchParams({ period });
  if (projectId) q.set("project", projectId);
  return `/portfolio/costing${tab}?${q.toString()}`;
}

/**
 * Deterministic: same input ⇒ same candidates in the same order. Nothing here
 * touches the clock beyond the `today` supplied by the caller.
 */
export function evaluatePortfolioAlerts(input: EvaluationInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const { configs, period, today, period_end } = input;
  const on = (r: AlertRuleType) => configs[r]?.enabled !== false;

  for (const row of input.rows) {
    const base = {
      project_id: row.project_id,
      period_month: period,
      owner_id: row.close.owners[0] ?? null,
      currency_code: row.currency,
    };

    // --- FX gaps affecting consolidation -----------------------------------
    if (on("fx_missing")) {
      const cfg = configs.fx_missing;
      const missing = [
        ...new Set([...(row.rate.missing ? [row.currency] : []), ...row.ledger_fx_missing]),
      ].sort();
      if (missing.length > 0) {
        out.push({
          ...base,
          rule_type: "fx_missing",
          fingerprint: fingerprintOf({
            rule_type: "fx_missing",
            project_id: row.project_id,
            period_month: period,
            discriminator: missing.join(","),
          }),
          severity: cfg.severity,
          current_value: missing.length,
          threshold_value: null,
          value_unit: "count",
          entity_table: "fx_rates",
          entity_id: null,
          title: `Missing FX rate for ${row.code}`,
          detail:
            `No rate is available for ${missing.join(", ")} → ${input.reporting_currency} ` +
            `on ${period_end}, so ${row.code} is excluded from the consolidation. ` +
            `Import or record the rate, then re-run the consolidation.`,
          deep_link: `/settings/fx-rates?period=${period}`,
          context: { missing_currencies: missing, rate_date: period_end },
        });
      } else if (row.rate.stale) {
        out.push({
          ...base,
          rule_type: "fx_missing",
          fingerprint: fingerprintOf({
            rule_type: "fx_missing",
            project_id: row.project_id,
            period_month: period,
            discriminator: "stale",
          }),
          severity: "medium",
          current_value: row.rate.as_of ? daysBetween(row.rate.as_of, period_end) : null,
          threshold_value: null,
          value_unit: "days",
          entity_table: "fx_rates",
          entity_id: null,
          title: `Stale FX rate for ${row.code}`,
          detail:
            `The ${row.currency} → ${input.reporting_currency} rate in use is dated ` +
            `${row.rate.as_of ?? "unknown"} against a ${period_end} basis. Refresh the feed.`,
          deep_link: `/settings/fx-rates?period=${period}`,
          context: { rate_as_of: row.rate.as_of, rate_date: period_end, source: row.rate.source },
        });
      }
    }

    // --- Stale or missing approved forecast --------------------------------
    if (on("forecast_stale")) {
      const cfg = configs.forecast_stale;
      const limit = cfg.threshold_value ?? 45;
      if (row.basis !== "approved") {
        out.push({
          ...base,
          rule_type: "forecast_stale",
          fingerprint: fingerprintOf({
            rule_type: "forecast_stale",
            project_id: row.project_id,
            period_month: period,
            discriminator: "missing",
          }),
          severity: cfg.severity,
          current_value: null,
          threshold_value: limit,
          value_unit: "days",
          entity_table: "forecast_versions",
          entity_id: row.version?.id ?? null,
          title: `No approved forecast for ${row.code}`,
          detail:
            `${row.code} contributes ${row.basis === "none" ? "no" : "an indicative"} snapshot for ` +
            `${period}. Approve the ${period} forecast version so the consolidation is official.`,
          deep_link: `/projects/${row.project_id}/costing/forecast?period=${period}`,
          context: { basis: row.basis, version_status: row.version?.status ?? null },
        });
      } else if (row.version?.approved_at) {
        const age = daysBetween(row.version.approved_at, today);
        if (age > limit) {
          out.push({
            ...base,
            rule_type: "forecast_stale",
            fingerprint: fingerprintOf({
              rule_type: "forecast_stale",
              project_id: row.project_id,
              period_month: period,
              discriminator: "age",
            }),
            severity: cfg.severity,
            current_value: age,
            threshold_value: limit,
            value_unit: "days",
            entity_table: "forecast_versions",
            entity_id: row.version.id,
            title: `Approved forecast ageing for ${row.code}`,
            detail:
              `Version ${row.version.version_no} was approved ${age} days ago (limit ${limit}). ` +
              `Refresh and re-approve the forecast for ${period}.`,
            deep_link: `/projects/${row.project_id}/costing/forecast?period=${period}`,
            context: { approved_at: row.version.approved_at, version_no: row.version.version_no },
          });
        }
      }
    }

    // --- EAC deterioration --------------------------------------------------
    if (on("eac_deterioration") && row.basis !== "none") {
      const cfg = configs.eac_deterioration;
      const limit = cfg.threshold_value ?? 0.05;
      const deltaPct = row.variance.delta_pct_prior;
      const delta = row.variance.delta_eac_prior;
      if (delta !== null && delta > 0 && deltaPct !== null && deltaPct >= limit) {
        out.push({
          ...base,
          rule_type: "eac_deterioration",
          fingerprint: fingerprintOf({
            rule_type: "eac_deterioration",
            project_id: row.project_id,
            period_month: period,
          }),
          severity: cfg.severity,
          current_value: deltaPct,
          threshold_value: limit,
          value_unit: "percent",
          entity_table: "forecast_versions",
          entity_id: row.version?.id ?? null,
          title: `EAC deterioration on ${row.code}`,
          detail:
            `EAC moved +${delta.toLocaleString()} ${row.currency} (${pct(deltaPct)}) against the ` +
            `prior approved snapshot; the materiality threshold is ${pct(limit)}. ` +
            `Record a materiality explanation and review the ETC.`,
          deep_link: link(period, row.project_id, ""),
          context: {
            delta_eac_prior: delta,
            delta_pct_prior: deltaPct,
            explained: Boolean(row.variance.explanation),
            basis: row.basis,
          },
        });
      }
    }

    // --- Budget / commitment / actual consumption --------------------------
    const budget = row.project.budget_current;
    const consumption: [AlertRuleType, number, string][] = [
      ["budget_breach", row.project.eac, "EAC"],
      ["commitment_breach", row.project.committed, "Commitments"],
      ["actual_breach", row.project.actual + row.project.accruals, "Actuals + accruals"],
    ];
    for (const [rule, value, label] of consumption) {
      if (!on(rule) || budget <= 0) continue;
      const cfg = configs[rule];
      const limit = cfg.threshold_value ?? 1;
      const ratio = value / budget;
      if (ratio >= limit) {
        out.push({
          ...base,
          rule_type: rule,
          fingerprint: fingerprintOf({
            rule_type: rule,
            project_id: row.project_id,
            period_month: period,
          }),
          severity: cfg.severity,
          current_value: Math.round(ratio * 10000) / 10000,
          threshold_value: limit,
          value_unit: "ratio",
          entity_table: "budgets",
          entity_id: null,
          title: `${label} at ${pct(ratio)} of budget on ${row.code}`,
          detail:
            `${label} of ${Math.round(value).toLocaleString()} ${row.currency} against a current ` +
            `budget of ${Math.round(budget).toLocaleString()} ${row.currency} (${pct(ratio)} vs ` +
            `threshold ${pct(limit)}). Raise a change order or re-baseline the budget.`,
          deep_link: link(period, row.project_id, ""),
          context: { value, budget_current: budget, ratio, basis: row.basis },
        });
      }
    }

    // --- Close checklist overdue -------------------------------------------
    if (on("checklist_overdue") && row.close.checklist_overdue > 0) {
      const cfg = configs.checklist_overdue;
      out.push({
        ...base,
        rule_type: "checklist_overdue",
        fingerprint: fingerprintOf({
          rule_type: "checklist_overdue",
          project_id: row.project_id,
          period_month: period,
        }),
        severity: cfg.severity,
        current_value: row.close.checklist_overdue,
        threshold_value: cfg.threshold_value ?? 0,
        value_unit: "count",
        entity_table: "costing_checklist_items",
        entity_id: null,
        title: `${row.close.checklist_overdue} overdue close task(s) on ${row.code}`,
        detail:
          `${row.close.checklist_overdue} of ${row.close.checklist_total} ${period} close tasks are ` +
          `past their due date. Complete or waive them before the period can close.`,
        deep_link: `/projects/${row.project_id}/costing/close?period=${period}`,
        context: {
          overdue: row.close.checklist_overdue,
          total: row.close.checklist_total,
          done: row.close.checklist_done,
        },
      });
    }

    // --- Missing evidence ---------------------------------------------------
    if (on("evidence_missing")) {
      const cfg = configs.evidence_missing;
      const blocker = row.close.blockers.find((b) => b.key.includes("evidence"));
      if (blocker && blocker.count > (cfg.threshold_value ?? 0)) {
        out.push({
          ...base,
          rule_type: "evidence_missing",
          fingerprint: fingerprintOf({
            rule_type: "evidence_missing",
            project_id: row.project_id,
            period_month: period,
          }),
          severity: cfg.severity,
          current_value: blocker.count,
          threshold_value: cfg.threshold_value ?? 0,
          value_unit: "count",
          entity_table: "costing_checklist_evidence",
          entity_id: null,
          title: `${blocker.count} close task(s) missing evidence on ${row.code}`,
          detail:
            `${blocker.count} required ${period} close task(s) have no attached evidence. ` +
            `Attach the supporting document to each task.`,
          deep_link: `/projects/${row.project_id}/costing/close?period=${period}`,
          context: { blocker: blocker.key, count: blocker.count },
        });
      }
    }

    // --- Period approaching close without readiness -------------------------
    if (on("close_readiness") && !row.close.ready && row.close.state === "open") {
      const cfg = configs.close_readiness;
      const daysToClose = daysBetween(today, period_end);
      if (daysToClose <= cfg.lead_days) {
        out.push({
          ...base,
          rule_type: "close_readiness",
          fingerprint: fingerprintOf({
            rule_type: "close_readiness",
            project_id: row.project_id,
            period_month: period,
          }),
          severity: cfg.severity,
          current_value: daysToClose,
          threshold_value: cfg.lead_days,
          value_unit: "days",
          entity_table: "costing_periods",
          entity_id: null,
          title: `${row.code} not close-ready with ${daysToClose} day(s) left`,
          detail:
            `${period} closes on ${period_end} and ${row.code} still has ` +
            `${row.close.blockers.reduce((a, b) => a + b.count, 0)} blocker(s). ` +
            `Clear the close cockpit blockers before the cut-off.`,
          deep_link: `/projects/${row.project_id}/costing/close?period=${period}`,
          context: {
            days_to_close: daysToClose,
            blockers: row.close.blockers,
            state: row.close.state,
          },
        });
      }
    }
  }

  // --- Unresolved exception / waiver ageing ---------------------------------
  if (on("exception_aging")) {
    const cfg = configs.exception_aging;
    const limit = cfg.threshold_value ?? 7;
    const codeById = new Map(input.rows.map((r) => [r.project_id, r.code]));
    for (const ex of input.exceptions) {
      if (!ex.first_seen_at) continue;
      const age = daysBetween(ex.first_seen_at, input.today);
      if (age < limit) continue;
      out.push({
        rule_type: "exception_aging",
        project_id: ex.project_id,
        period_month: ex.period_month ?? period,
        fingerprint: fingerprintOf({
          rule_type: "exception_aging",
          project_id: ex.project_id,
          period_month: ex.period_month ?? period,
          entity_id: ex.id,
        }),
        severity: ex.severity === "blocker" ? cfg.severity : "medium",
        current_value: age,
        threshold_value: limit,
        value_unit: "days",
        currency_code: null,
        entity_table: "costing_exceptions",
        entity_id: ex.id,
        owner_id: ex.owner_id,
        title: `Close exception open ${age} day(s) on ${codeById.get(ex.project_id ?? "") ?? "portfolio"}`,
        detail:
          `"${ex.title ?? "Exception"}" has been unresolved for ${age} days (limit ${limit}). ` +
          `Resolve it or record an approved waiver with a reason.`,
        deep_link: `/projects/${ex.project_id}/costing/close?period=${ex.period_month ?? period}`,
        context: { age_days: age, exception_severity: ex.severity, status: ex.status },
      });
    }
  }

  // --- Reopened / overridden periods ----------------------------------------
  if (on("period_reopened")) {
    const cfg = configs.period_reopened;
    const codeById = new Map(input.rows.map((r) => [r.project_id, r.code]));
    for (const ev of input.reopened) {
      out.push({
        rule_type: "period_reopened",
        project_id: ev.project_id,
        period_month: ev.period_month,
        fingerprint: fingerprintOf({
          rule_type: "period_reopened",
          project_id: ev.project_id,
          period_month: ev.period_month,
          discriminator: ev.at.slice(0, 10),
        }),
        severity: cfg.severity,
        current_value: 1,
        threshold_value: null,
        value_unit: "count",
        currency_code: null,
        entity_table: "costing_periods",
        entity_id: null,
        owner_id: null,
        title: `Period ${ev.period_month} reopened${ev.project_id ? ` on ${codeById.get(ev.project_id) ?? "a project"}` : " company-wide"}`,
        detail:
          `A closed period was reopened on ${ev.at.slice(0, 10)}. Confirm the adjustment is ` +
          `authorised, restate affected reporting and re-close the period.`,
        deep_link: `/portfolio/costing/audit?period=${ev.period_month}`,
        context: { reopened_at: ev.at, period_month: ev.period_month },
      });
    }
  }

  // --- Audit reconciliation gaps --------------------------------------------
  if (on("audit_gap") && input.audit_gaps > (configs.audit_gap.threshold_value ?? 0)) {
    out.push({
      rule_type: "audit_gap",
      project_id: null,
      period_month: period,
      fingerprint: fingerprintOf({ rule_type: "audit_gap", period_month: period }),
      severity: configs.audit_gap.severity,
      current_value: input.audit_gaps,
      threshold_value: configs.audit_gap.threshold_value ?? 0,
      value_unit: "count",
      currency_code: null,
      entity_table: "audit_logs",
      entity_id: null,
      owner_id: null,
      title: `${input.audit_gaps} audit event(s) failed reconciliation`,
      detail:
        `${input.audit_gaps} ${period} portfolio audit event(s) are unattributed, reference an ` +
        `unknown project, or are missing their entity. Review the audit trail reconciliation.`,
      deep_link: `/portfolio/costing/audit?period=${period}`,
      context: { gaps: input.audit_gaps },
    });
  }

  // --- GC-13 liquidity families ---------------------------------------------
  for (const liq of input.liquidity ?? []) {
    const evidence = `/projects/${liq.project_id}/costing/cash-flow?period=${period}`;

    if (on("liquidity_shortfall") && liq.first_shortfall_bucket !== null) {
      const cfg = configs.liquidity_shortfall;
      out.push({
        rule_type: "liquidity_shortfall",
        project_id: liq.project_id,
        period_month: period,
        fingerprint: fingerprintOf({
          rule_type: "liquidity_shortfall",
          project_id: liq.project_id,
          period_month: period,
        }),
        severity: cfg.severity,
        current_value: liq.minimum_liquidity,
        threshold_value: cfg.threshold_value ?? 0,
        value_unit: "currency",
        currency_code: liq.currency_code,
        entity_table: "cashflow_snapshots",
        entity_id: liq.snapshot_id,
        owner_id: null,
        title: `Cash shortfall forecast on ${liq.code}`,
        detail:
          `Closing cash turns negative in bucket ${liq.first_shortfall_bucket} ` +
          `(minimum ${Math.round(liq.minimum_liquidity).toLocaleString()} ${liq.currency_code}). ` +
          `Draw funding, re-phase payments or escalate to treasury.`,
        deep_link: evidence,
        context: {
          first_shortfall_bucket: liq.first_shortfall_bucket,
          minimum_liquidity: liq.minimum_liquidity,
          snapshot_id: liq.snapshot_id,
        },
      });
    }

    if (on("funding_headroom")) {
      const cfg = configs.funding_headroom;
      const limit = cfg.threshold_value ?? 0.9;
      const util = liq.utilization_pct === null ? null : liq.utilization_pct / 100;
      const unfunded = liq.unfunded_requirement > 0;
      if (unfunded || (util !== null && util >= limit)) {
        out.push({
          rule_type: "funding_headroom",
          project_id: liq.project_id,
          period_month: period,
          fingerprint: fingerprintOf({
            rule_type: "funding_headroom",
            project_id: liq.project_id,
            period_month: period,
          }),
          severity: unfunded ? "critical" : cfg.severity,
          current_value: util,
          threshold_value: limit,
          value_unit: "ratio",
          currency_code: liq.currency_code,
          entity_table: "cashflow_snapshots",
          entity_id: liq.snapshot_id,
          owner_id: null,
          title: unfunded
            ? `Unfunded requirement on ${liq.code}`
            : `Facility utilisation at ${pct(util ?? 0)} on ${liq.code}`,
          detail: unfunded
            ? `${Math.round(liq.unfunded_requirement).toLocaleString()} ${liq.currency_code} of ` +
              `peak funding need is not covered by available facilities. Secure or reallocate ` +
              `facility capacity.`
            : `Committed facility utilisation reached ${pct(util ?? 0)} against a threshold of ` +
              `${pct(limit)}. Review headroom before the next drawdown.`,
          deep_link: evidence,
          context: {
            unfunded_requirement: liq.unfunded_requirement,
            utilization_pct: liq.utilization_pct,
            snapshot_id: liq.snapshot_id,
          },
        });
      }
    }

    if (on("covenant_breach") && liq.breached_covenants.length > 0) {
      const cfg = configs.covenant_breach;
      out.push({
        rule_type: "covenant_breach",
        project_id: liq.project_id,
        period_month: period,
        fingerprint: fingerprintOf({
          rule_type: "covenant_breach",
          project_id: liq.project_id,
          period_month: period,
          discriminator: liq.breached_covenants
            .map((c) => `${c.facility_id}:${c.code}`)
            .sort()
            .join(","),
        }),
        severity: cfg.severity,
        current_value: liq.breached_covenants.length,
        threshold_value: cfg.threshold_value ?? 0,
        value_unit: "count",
        currency_code: liq.currency_code,
        entity_table: "funding_facilities",
        entity_id: liq.breached_covenants[0]?.facility_id ?? null,
        owner_id: null,
        title: `${liq.breached_covenants.length} covenant breach(es) on ${liq.code}`,
        detail:
          `Facility covenants ${liq.breached_covenants.map((c) => c.code).join(", ")} are ` +
          `breached against the current liquidity position. Notify the lender and remediate.`,
        deep_link: evidence,
        context: {
          covenants: liq.breached_covenants.map((c) => `${c.facility_id}:${c.code}`),
          snapshot_id: liq.snapshot_id,
        },
      });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
export interface AlertRecord {
  id: string;
  company_id: string;
  project_id: string | null;
  period_month: string | null;
  rule_type: AlertRuleType;
  fingerprint: string;
  severity: AlertSeverity;
  status: AlertStatus;
  escalation_tier: number;
  entity_table: string | null;
  entity_id: string | null;
  current_value: number | null;
  threshold_value: number | null;
  value_unit: AlertUnit;
  currency_code: string | null;
  owner_id: string | null;
  title: string;
  detail: string | null;
  deep_link: string | null;
  context: AlertContext;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  reopen_count: number;
  ack_due_at: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
}

export function ackDueAt(fromIso: string, slaHours: number): string {
  return new Date(Date.parse(fromIso) + slaHours * 3_600_000).toISOString();
}

/** True when an open alert has blown its acknowledgement SLA. */
export function isAckOverdue(
  a: Pick<AlertRecord, "status" | "ack_due_at">,
  nowIso: string,
): boolean {
  return a.status === "open" && !!a.ack_due_at && a.ack_due_at < nowIso;
}

/** A snooze expires by itself: the row is treated as open again. */
export function effectiveStatus(a: AlertRecord, nowIso: string): AlertStatus {
  if (a.status === "snoozed" && a.snoozed_until && a.snoozed_until <= nowIso) return "open";
  return a.status;
}

export interface SeenTransition {
  status: AlertStatus;
  occurrence_count: number;
  reopen_count: number;
  reopened: boolean;
}

/**
 * Re-seeing a condition updates ONE occurrence. A resolved alert whose
 * condition recurs is reopened (history preserved); an acknowledged or snoozed
 * alert keeps its state so re-evaluation cannot spam an operator who already
 * triaged it.
 */
export function transitionOnSeen(existing: AlertRecord, nowIso: string): SeenTransition {
  const status = effectiveStatus(existing, nowIso);
  if (existing.status === "resolved") {
    return {
      status: "open",
      occurrence_count: existing.occurrence_count + 1,
      reopen_count: existing.reopen_count + 1,
      reopened: true,
    };
  }
  return {
    status,
    occurrence_count: existing.occurrence_count + 1,
    reopen_count: existing.reopen_count,
    reopened: false,
  };
}

/** Escalation tier for an unacknowledged alert, 0-3 (one tier per SLA period). */
export function escalationTier(
  a: Pick<AlertRecord, "status" | "ack_due_at">,
  nowIso: string,
  slaHours: number,
): number {
  if (!isAckOverdue(a, nowIso)) return 0;
  const overdueMs = Date.parse(nowIso) - Date.parse(a.ack_due_at as string);
  return Math.min(3, 1 + Math.floor(overdueMs / (slaHours * 3_600_000)));
}

// ---------------------------------------------------------------------------
// Filtering, summary and CSV
// ---------------------------------------------------------------------------
export const ALERT_PAGE_SIZES = [25, 50, 100, 200] as const;

export const alertFilterSchema = z
  .object({
    status: z.enum(ALERT_STATUSES).optional(),
    severity: z.enum(ALERT_SEVERITIES).optional(),
    rule_type: z.enum(ALERT_RULE_TYPES).optional(),
    project_id: z.string().uuid().optional(),
    period: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/)
      .optional(),
    owner_id: z.string().uuid().optional(),
    /** Minimum age of the alert, in days since first seen. */
    min_age_days: z.number().int().min(0).max(3650).optional(),
    overdue_only: z.boolean().optional(),
    page: z.number().int().min(1).max(1000).default(1),
    page_size: z
      .number()
      .int()
      .refine((n) => (ALERT_PAGE_SIZES as readonly number[]).includes(n), "invalid_page_size")
      .default(50),
  })
  .strict();

export type AlertFilter = z.infer<typeof alertFilterSchema>;

export interface AlertSummary {
  open: number;
  by_severity: Record<AlertSeverity, number>;
  ack_overdue: number;
  acknowledged: number;
  snoozed: number;
  resolved_recent: number;
  reopened: number;
  projects_affected: number;
  oldest_age_days: number;
}

export function summarize(
  alerts: readonly AlertRecord[],
  nowIso: string,
  recentResolvedSinceIso: string,
): AlertSummary {
  const by_severity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let open = 0;
  let ack_overdue = 0;
  let acknowledged = 0;
  let snoozed = 0;
  let resolved_recent = 0;
  let reopened = 0;
  let oldest = 0;
  const projects = new Set<string>();
  for (const a of alerts) {
    const status = effectiveStatus(a, nowIso);
    if (status === "resolved") {
      if (a.resolved_at && a.resolved_at >= recentResolvedSinceIso) resolved_recent += 1;
      continue;
    }
    open += status === "open" ? 1 : 0;
    acknowledged += status === "acknowledged" ? 1 : 0;
    snoozed += status === "snoozed" ? 1 : 0;
    by_severity[a.severity] += 1;
    if (isAckOverdue({ status, ack_due_at: a.ack_due_at }, nowIso)) ack_overdue += 1;
    if (a.reopen_count > 0) reopened += 1;
    if (a.project_id) projects.add(a.project_id);
    oldest = Math.max(oldest, daysBetween(a.first_seen_at, nowIso));
  }
  return {
    open,
    by_severity,
    ack_overdue,
    acknowledged,
    snoozed,
    resolved_recent,
    reopened,
    projects_affected: projects.size,
    oldest_age_days: oldest,
  };
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const ALERT_CSV_HEADER = [
  "first_seen_at",
  "last_seen_at",
  "status",
  "severity",
  "rule_type",
  "project_code",
  "period",
  "current_value",
  "threshold_value",
  "unit",
  "currency",
  "occurrences",
  "reopens",
  "ack_due_at",
  "title",
] as const;

/** Deterministic export: fixed header, fixed row order, no locale formatting. */
export function buildAlertCsv(
  alerts: readonly (AlertRecord & { project_code?: string | null })[],
): string {
  const lines = [ALERT_CSV_HEADER.join(",")];
  for (const a of alerts) {
    lines.push(
      [
        a.first_seen_at,
        a.last_seen_at,
        a.status,
        a.severity,
        a.rule_type,
        a.project_code ?? "",
        a.period_month ?? "",
        a.current_value ?? "",
        a.threshold_value ?? "",
        a.value_unit,
        a.currency_code ?? "",
        a.occurrence_count,
        a.reopen_count,
        a.ack_due_at ?? "",
        a.title,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GC-15 — Recognition alert bridge
//
// Recognition families are evaluated by the recognition engine against frozen
// snapshots. This adapter only *routes* those findings into the shared alert
// register: it re-derives no money, and it namespaces fingerprints so a
// recognition finding can never collide with a costing one.
// ---------------------------------------------------------------------------
export const RECOGNITION_ALERT_PREFIX = "recognition";

/** Numeric reading each recognition family reports, for threshold display. */
function recognitionValue(alert: RecognitionAlert): number | null {
  const c = alert.context;
  const first = [
    c["margin_pct"],
    c["loss_provision"],
    c["days"],
    c["period_revenue"],
    c["contract_asset"],
    c["contract_liability"],
    c["retention_receivable"],
    c["constrained"],
    c["pending"],
  ].find((v) => typeof v === "number");
  return typeof first === "number" ? first : null;
}

export function recognitionThresholds(
  configs: Record<AlertRuleType, AlertRuleConfig>,
): RecognitionThresholds {
  const num = (rule: AlertRuleType, fallback: number): number =>
    configs[rule]?.threshold_value ?? fallback;
  return {
    // Configs store percentages as fractions; the recognition engine uses points.
    margin_floor_pct: num("revenue_margin_erosion", 0.05) * 100,
    liability_movement_pct: num("contract_liability_movement", 0.2) * 100,
    wip_age_days: num("wip_underbilling_age", 60),
    basis_stale_days: num("recognition_basis_stale", 45),
    exposure_amount: num("unapproved_variation_exposure", 100_000),
    reversal_amount: num("revenue_reversal_material", 50_000),
    billing_lag_days: num("recognition_billing_lag", 60),
    approval_delay_days: num("recognition_approval_delay", 7),
  };
}

export function recognitionAlertCandidates(input: {
  rows: readonly PortfolioProjectInput[];
  asOf: string;
  configs: Record<AlertRuleType, AlertRuleConfig>;
}): AlertCandidate[] {
  const thresholds = recognitionThresholds(input.configs);
  const found = evaluateRecognitionAlerts(input.rows, input.asOf, thresholds);
  const currencyOf = new Map(input.rows.map((r) => [r.project_id, r.currency_code]));
  const periodOf = new Map(input.rows.map((r) => [r.project_id, r.period_month]));
  const projectOf = (a: RecognitionAlert): string | null => {
    const parts = a.fingerprint.split(":");
    const id = parts[1] ?? null;
    return id && currencyOf.has(id) ? id : null;
  };

  const out: AlertCandidate[] = [];
  for (const a of found) {
    const rule = a.rule_type as AlertRuleType;
    const cfg = input.configs[rule];
    if (cfg && !cfg.enabled) continue;
    const projectId = projectOf(a);
    out.push({
      rule_type: rule,
      project_id: projectId,
      period_month: projectId ? (periodOf.get(projectId) ?? null) : null,
      fingerprint: `${RECOGNITION_ALERT_PREFIX}:${a.fingerprint}`,
      severity: cfg?.severity ?? (a.severity === "critical" ? "critical" : "medium"),
      current_value: recognitionValue(a),
      threshold_value: cfg?.threshold_value ?? null,
      value_unit: cfg?.threshold_unit ?? "count",
      currency_code: projectId ? (currencyOf.get(projectId) ?? null) : null,
      entity_table: "recognition_snapshots",
      entity_id: null,
      title: a.title,
      detail: a.detail,
      deep_link: a.evidence_url,
      owner_id: null,
      context: a.context as AlertContext,
    });
  }
  return out;
}
