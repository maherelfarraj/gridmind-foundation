// GC-03 — Costing period close: pure state machine, materiality and readiness.
//
// Period-date semantics (single source of truth for the module):
//   * A costing period is a CALENDAR MONTH identified by its first day
//     (YYYY-MM-01) in the company's reporting timezone
//     (`costing_settings.reporting_timezone`, default UTC).
//   * A row belongs to the period of its OWN business date — `period` for
//     forecasts and accruals, `issue_date` for invoices, `payment_date` for
//     payments. Never `created_at`.
//   * Business dates are stored as plain `date` values, so no timezone
//     conversion is applied to them. The reporting timezone only decides what
//     "the current month" is when the UI defaults a period.
//
// States:
//   open        — everything posts normally.
//   soft_locked — routine posting blocked; a finance_admin/company_admin may
//                 post an explicitly flagged, reason-bearing adjustment.
//   hard_closed — nothing posts. Corrections go to the next open period.
//
// Transitions: open -> soft_locked -> hard_closed, and either lock state back
// to open (reopen, reason mandatory). Skipping straight from open to
// hard_closed is rejected so a close is always preceded by a review window.
// Repeating the current state is an idempotent no-op.
import { z } from "zod";

import { sumMoney, toMinor } from "@/lib/costing.fx";

export const COSTING_PERIOD_STATES = ["open", "soft_locked", "hard_closed"] as const;
export type CostingPeriodState = (typeof COSTING_PERIOD_STATES)[number];

export const COSTING_PERIOD_HARD_CLOSED = "costing_period_hard_closed";
export const COSTING_PERIOD_SOFT_LOCKED = "costing_period_soft_locked";
export const COSTING_PERIOD_VERSION_CONFLICT = "costing_period_version_conflict";
export const COSTING_PERIOD_INVALID_TRANSITION = "costing_period_invalid_transition";
export const COSTING_PERIOD_REASON_REQUIRED = "costing_period_reason_required";

const RANK: Record<CostingPeriodState, number> = { open: 0, soft_locked: 1, hard_closed: 2 };

/** Company-wide and project-level locks combine to the most restrictive state. */
export function mostRestrictiveState(
  ...states: readonly (CostingPeriodState | null | undefined)[]
): CostingPeriodState {
  let out: CostingPeriodState = "open";
  for (const s of states) {
    if (!s) continue;
    if (RANK[s] > RANK[out]) out = s;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Month helpers (reporting-timezone aware)
// ---------------------------------------------------------------------------
export const monthStartSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "Period must be the first day of a month (YYYY-MM-01)");

/** First day of the calendar month that owns an ISO business date. */
export function periodMonthOf(isoDate: string): string {
  return `${String(isoDate).slice(0, 7)}-01`;
}

/** `YYYY-MM-DD` for `now` in an IANA timezone; falls back to UTC. */
export function reportingToday(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The current costing period in the company's reporting timezone. */
export function currentReportingPeriod(timeZone: string, now: Date = new Date()): string {
  return periodMonthOf(reportingToday(timeZone, now));
}

/** Month immediately after `month` (YYYY-MM-01 in, YYYY-MM-01 out). */
export function nextPeriodMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------
export interface TransitionCheck {
  ok: boolean;
  /** True when the request is a no-op because the period is already there. */
  idempotent: boolean;
  code?: string;
  message?: string;
}

export function checkPeriodTransition(
  from: CostingPeriodState,
  to: CostingPeriodState,
  reason: string | null | undefined,
): TransitionCheck {
  if (from === to) return { ok: true, idempotent: true };
  if (to === "open" && !String(reason ?? "").trim()) {
    return {
      ok: false,
      idempotent: false,
      code: COSTING_PERIOD_REASON_REQUIRED,
      message: `Reopening a ${from.replace("_", " ")} period requires a reason.`,
    };
  }
  if (from === "open" && to === "hard_closed") {
    return {
      ok: false,
      idempotent: false,
      code: COSTING_PERIOD_INVALID_TRANSITION,
      message: "Soft lock the period before hard closing it.",
    };
  }
  if (from === "hard_closed" && to !== "open") {
    return {
      ok: false,
      idempotent: false,
      code: COSTING_PERIOD_INVALID_TRANSITION,
      message: "Reopen the period before changing a hard close.",
    };
  }
  return { ok: true, idempotent: false };
}

export interface PostingCheck {
  allowed: boolean;
  code?: string;
  message?: string;
}

/**
 * The one authoritative posting rule. Every costing mutation routes through
 * this (in the app) and through `assert_costing_period_open` (in the database).
 */
export function checkPosting(
  state: CostingPeriodState,
  period: string,
  opts: { isAdjustment?: boolean; canAdjust?: boolean } = {},
): PostingCheck {
  if (state === "hard_closed") {
    return {
      allowed: false,
      code: COSTING_PERIOD_HARD_CLOSED,
      message: `Period ${period.slice(0, 7)} is hard closed. Post the correction in ${nextPeriodMonth(period).slice(0, 7)} instead.`,
    };
  }
  if (state === "soft_locked") {
    if (opts.isAdjustment && opts.canAdjust) return { allowed: true };
    return {
      allowed: false,
      code: COSTING_PERIOD_SOFT_LOCKED,
      message: `Period ${period.slice(0, 7)} is soft locked. Only an audited finance-admin adjustment with a reason may post.`,
    };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Materiality
// ---------------------------------------------------------------------------
export interface MaterialityPolicy {
  /** Absolute movement, in project currency, that counts as material. 0 = off. */
  abs: number;
  /** Percentage movement against the comparison base. 0 = off. */
  pct: number;
}

export const MATERIALITY_DEFAULTS: MaterialityPolicy = { abs: 0, pct: 0 };

export interface MaterialityVerdict {
  material: boolean;
  delta: number;
  deltaPct: number | null;
  reasons: string[];
}

/** Is a movement from `base` to `next` material under the company policy? */
export function evaluateMateriality(
  base: number,
  next: number,
  policy: MaterialityPolicy,
): MaterialityVerdict {
  const delta = sumMoney([next, -base]);
  const abs = Math.abs(delta);
  const deltaPct = toMinor(base) === 0 ? null : (delta / base) * 100;
  const reasons: string[] = [];
  if (policy.abs > 0 && abs >= policy.abs) reasons.push("absolute");
  if (policy.pct > 0 && deltaPct !== null && Math.abs(deltaPct) >= policy.pct) {
    reasons.push("percentage");
  }
  return { material: reasons.length > 0, delta, deltaPct, reasons };
}

export function materialityExplanationRequired(
  verdict: MaterialityVerdict,
  explanation: string | null | undefined,
): boolean {
  return verdict.material && String(explanation ?? "").trim().length < 10;
}

// ---------------------------------------------------------------------------
// Close readiness
// ---------------------------------------------------------------------------
export type ReadinessSeverity = "blocker" | "warning";

export interface ReadinessItem {
  key: string;
  severity: ReadinessSeverity;
  count: number;
  /** Stable machine detail for the UI; text is localised client-side. */
  detail?: Record<string, unknown>;
}

export interface ReadinessFacts {
  period: string;
  /** Accruals dated in the period. */
  accruals: { id: string; status: string; fx_rate: number; currency_code: string }[];
  /** Forecast rows dated in the period. */
  forecasts: { id: string; fx_rate: number; currency_code: string; cost_code_id: string | null }[];
  /** Booked payable invoices dated in the period. */
  invoices: { id: string; status: string; cost_code_id: string | null }[];
  /** Forecast versions for the period. */
  versions: { id: string; status: string }[];
}

/**
 * Deterministic pre-close checklist. Blockers must clear before a hard close;
 * warnings are advisory and surfaced but never block.
 */
export function evaluateCloseReadiness(facts: ReadinessFacts): {
  items: ReadinessItem[];
  ready: boolean;
} {
  const items: ReadinessItem[] = [];

  const draftAccruals = facts.accruals.filter((a) => a.status === "draft");
  if (draftAccruals.length > 0) {
    items.push({ key: "draft_accruals", severity: "blocker", count: draftAccruals.length });
  }

  const unratedAccruals = facts.accruals.filter(
    (a) => a.status === "approved" && !(Number(a.fx_rate) > 0),
  );
  const unratedForecasts = facts.forecasts.filter((f) => !(Number(f.fx_rate) > 0));
  if (unratedAccruals.length + unratedForecasts.length > 0) {
    items.push({
      key: "missing_fx",
      severity: "blocker",
      count: unratedAccruals.length + unratedForecasts.length,
      detail: {
        currencies: [
          ...new Set([
            ...unratedAccruals.map((a) => a.currency_code),
            ...unratedForecasts.map((f) => f.currency_code),
          ]),
        ].sort(),
      },
    });
  }

  const pending = facts.versions.filter((v) => v.status === "submitted");
  if (pending.length > 0) {
    items.push({ key: "pending_forecast_versions", severity: "blocker", count: pending.length });
  }

  const approved = facts.versions.filter((v) => v.status === "approved");
  if (approved.length === 0) {
    items.push({ key: "no_approved_forecast", severity: "blocker", count: 1 });
  }

  const uncoded = facts.invoices.filter((i) => !i.cost_code_id);
  if (uncoded.length > 0) {
    items.push({ key: "uncoded_actuals", severity: "warning", count: uncoded.length });
  }

  const working = facts.versions.filter((v) => v.status === "working");
  if (working.length > 0) {
    items.push({ key: "working_forecast_versions", severity: "warning", count: working.length });
  }

  return { items, ready: items.every((i) => i.severity !== "blocker") };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const costingPeriodTransitionSchema = z
  .object({
    companyId: z.string().uuid(),
    projectId: z.string().uuid().nullable().optional(),
    period: monthStartSchema,
    target: z.enum(COSTING_PERIOD_STATES),
    reason: z.string().trim().max(1000).nullable().optional(),
    expectedVersion: z.number().int().positive().nullable().optional(),
    /** Hard close only: proceed despite advisory warnings. */
    acknowledgeWarnings: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.target === "open" && !String(v.reason ?? "").trim()) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "A reopen reason is required." });
    }
  });

export const costingPeriodQuerySchema = z.object({
  projectId: z.string().uuid(),
  /** Optional focus month; defaults to the current reporting period. */
  period: monthStartSchema.optional(),
});

export const costingSettingsSchema = z.object({
  companyId: z.string().uuid(),
  reporting_timezone: z.string().trim().min(1).max(64),
  materiality_abs: z.number().nonnegative().max(999_999_999_999),
  materiality_pct: z.number().nonnegative().max(1000),
});

export type CostingPeriodTransitionInput = z.infer<typeof costingPeriodTransitionSchema>;
export type CostingSettingsInput = z.infer<typeof costingSettingsSchema>;
