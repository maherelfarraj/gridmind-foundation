// GC-03 — Forecast versioning: pure status machine, snapshot totals and diffs.
//
// A forecast VERSION is an immutable, point-in-time snapshot of the project's
// cost position for one reporting month, expressed in project currency with
// every FX rate locked at snapshot time. Versions never re-rate: comparing two
// versions compares two frozen ledgers, so a later rate move can never silently
// restate an approved forecast.
//
// Lifecycle: working -> submitted -> approved. Approving supersedes the prior
// approved version for the same project + month, and exactly one approved
// version may exist per project + month (enforced by a partial unique index).
// A submitted version may be recalled to working. Approved and superseded
// versions are immutable (enforced by database triggers).
import { z } from "zod";

import { moneyEquals, sumMoney } from "@/lib/costing.fx";
import { evaluateMateriality, type MaterialityPolicy } from "@/lib/costing.periods";

export const FORECAST_VERSION_STATUSES = [
  "working",
  "submitted",
  "approved",
  "superseded",
] as const;
export type ForecastVersionStatus = (typeof FORECAST_VERSION_STATUSES)[number];

export type ForecastVersionAction = "submit" | "recall" | "approve";

export const FORECAST_INVALID_TRANSITION = "forecast_invalid_transition";
export const FORECAST_SNAPSHOT_IMMUTABLE = "forecast_snapshot_immutable";
export const FORECAST_VERSION_CONFLICT = "forecast_version_conflict";
export const FORECAST_MATERIALITY_EXPLANATION_REQUIRED =
  "forecast_materiality_explanation_required";

const ALLOWED: Record<ForecastVersionAction, ForecastVersionStatus[]> = {
  submit: ["working"],
  recall: ["submitted"],
  approve: ["submitted"],
};

export function canTransitionVersion(
  from: ForecastVersionStatus,
  action: ForecastVersionAction,
): boolean {
  return ALLOWED[action].includes(from);
}

export function nextVersionStatus(action: ForecastVersionAction): ForecastVersionStatus {
  if (action === "submit") return "submitted";
  if (action === "recall") return "working";
  return "approved";
}

/** Approved and superseded snapshots may never be edited or re-rated. */
export function isImmutableStatus(status: ForecastVersionStatus): boolean {
  return status === "approved" || status === "superseded";
}

export function nextVersionNumber(existing: readonly { version_no: number }[]): number {
  return existing.reduce((max, v) => Math.max(max, Number(v.version_no) || 0), 0) + 1;
}

// ---------------------------------------------------------------------------
// Snapshot lines
// ---------------------------------------------------------------------------
export const UNASSIGNED_COST_CODE_KEY = "__unassigned__";

export function costCodeKey(costCodeId: string | null | undefined): string {
  return costCodeId ?? UNASSIGNED_COST_CODE_KEY;
}

export interface ForecastSnapshotLine {
  cost_code_id: string | null;
  cost_code_key: string;
  cost_code: string | null;
  cost_code_name: string | null;
  currency_code: string;
  base_currency_code: string;
  fx_rate: number;
  fx_rate_date: string | null;
  fx_source: "parity" | "table" | "manual";
  fx_override_reason: string | null;
  etc_amount: number;
  etc_amount_base: number;
  budget_current: number;
  committed: number;
  actual: number;
  accruals: number;
  eac: number;
  vac: number;
}

export interface ForecastSnapshotTotals {
  base_currency_code: string;
  budget_current: number;
  committed: number;
  actual: number;
  accruals: number;
  etc: number;
  eac: number;
  vac: number;
  line_count: number;
}

/** Roll snapshot lines to header totals. Decimal-safe; never re-rates. */
export function snapshotTotals(
  lines: readonly ForecastSnapshotLine[],
  baseCurrency: string,
): ForecastSnapshotTotals {
  const pick = (f: (l: ForecastSnapshotLine) => number) => sumMoney(lines.map(f));
  const actual = pick((l) => l.actual);
  const accruals = pick((l) => l.accruals);
  const etc = pick((l) => l.etc_amount_base);
  const budget_current = pick((l) => l.budget_current);
  const eac = sumMoney([actual, accruals, etc]);
  return {
    base_currency_code: baseCurrency,
    budget_current,
    committed: pick((l) => l.committed),
    actual,
    accruals,
    etc,
    eac,
    vac: sumMoney([budget_current, -eac]),
    line_count: lines.length,
  };
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------
export type DiffKind = "added" | "removed" | "changed" | "unchanged";

export interface ForecastDiffRow {
  cost_code_key: string;
  cost_code: string | null;
  cost_code_name: string | null;
  kind: DiffKind;
  from: { etc: number; eac: number; committed: number; actual: number; accruals: number } | null;
  to: { etc: number; eac: number; committed: number; actual: number; accruals: number } | null;
  delta_etc: number;
  delta_eac: number;
  /** Ordered contributions that explain delta_eac. */
  drivers: { key: "actual" | "accruals" | "etc"; delta: number }[];
}

export interface ForecastDiff {
  rows: ForecastDiffRow[];
  totals: {
    delta_budget: number;
    delta_committed: number;
    delta_actual: number;
    delta_accruals: number;
    delta_etc: number;
    delta_eac: number;
    delta_vac: number;
  };
  changed_count: number;
}

function measures(l: ForecastSnapshotLine) {
  return {
    etc: l.etc_amount_base,
    eac: l.eac,
    committed: l.committed,
    actual: l.actual,
    accruals: l.accruals,
  };
}

/**
 * Diff two frozen snapshots line by line. Both sides are already in project
 * currency at their own locked rates — no conversion happens here.
 */
export function diffSnapshots(
  from: readonly ForecastSnapshotLine[],
  to: readonly ForecastSnapshotLine[],
): ForecastDiff {
  const a = new Map(from.map((l) => [l.cost_code_key, l]));
  const b = new Map(to.map((l) => [l.cost_code_key, l]));
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();

  const rows: ForecastDiffRow[] = keys.map((key) => {
    const l = a.get(key) ?? null;
    const r = b.get(key) ?? null;
    const fromM = l ? measures(l) : null;
    const toM = r ? measures(r) : null;
    const delta_etc = sumMoney([toM?.etc ?? 0, -(fromM?.etc ?? 0)]);
    const delta_eac = sumMoney([toM?.eac ?? 0, -(fromM?.eac ?? 0)]);
    const kind: DiffKind = !l
      ? "added"
      : !r
        ? "removed"
        : moneyEquals(fromM!.eac, toM!.eac) && moneyEquals(fromM!.etc, toM!.etc)
          ? "unchanged"
          : "changed";
    const drivers = (["actual", "accruals", "etc"] as const)
      .map((k) => ({ key: k, delta: sumMoney([toM?.[k] ?? 0, -(fromM?.[k] ?? 0)]) }))
      .filter((d) => !moneyEquals(d.delta, 0))
      .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

    return {
      cost_code_key: key,
      cost_code: (r ?? l)?.cost_code ?? null,
      cost_code_name: (r ?? l)?.cost_code_name ?? null,
      kind,
      from: fromM,
      to: toM,
      delta_etc,
      delta_eac,
      drivers,
    };
  });

  const d = (f: (l: ForecastSnapshotLine) => number) =>
    sumMoney([sumMoney(to.map(f)), -sumMoney(from.map(f))]);

  const delta_budget = d((l) => l.budget_current);
  const delta_eac = d((l) => l.eac);

  return {
    rows,
    totals: {
      delta_budget,
      delta_committed: d((l) => l.committed),
      delta_actual: d((l) => l.actual),
      delta_accruals: d((l) => l.accruals),
      delta_etc: d((l) => l.etc_amount_base),
      delta_eac,
      delta_vac: sumMoney([delta_budget, -delta_eac]),
    },
    changed_count: rows.filter((r) => r.kind !== "unchanged").length,
  };
}

/**
 * Baseline = the FIRST approved version for the project (the originally
 * approved forecast). Everything after it is measured against it.
 */
export function pickBaselineVersion<
  T extends { status: string; version_no: number; reporting_period: string; approved_at?: unknown },
>(versions: readonly T[]): T | null {
  const approved = versions
    .filter((v) => v.status === "approved" || v.status === "superseded")
    .slice()
    .sort(
      (x, y) =>
        x.reporting_period.localeCompare(y.reporting_period) || x.version_no - y.version_no,
    );
  return approved[0] ?? null;
}

export function pickCurrentApproved<T extends { status: string; version_no: number }>(
  versions: readonly T[],
): T | null {
  return versions.filter((v) => v.status === "approved").sort((x, y) => y.version_no - x.version_no)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Approval gate
// ---------------------------------------------------------------------------
export interface VersionApprovalGate {
  ok: boolean;
  code?: string;
  message?: string;
  material?: boolean;
  delta?: number;
  deltaPct?: number | null;
}

/**
 * A submitted version whose EAC moves materially against the previous approved
 * version cannot be approved without a written explanation.
 */
export function checkVersionApproval(args: {
  status: ForecastVersionStatus;
  previousEac: number | null;
  nextEac: number;
  policy: MaterialityPolicy;
  explanation: string | null | undefined;
}): VersionApprovalGate {
  if (!canTransitionVersion(args.status, "approve")) {
    return {
      ok: false,
      code: FORECAST_INVALID_TRANSITION,
      message: `Only a submitted version can be approved (this one is ${args.status}).`,
    };
  }
  if (args.previousEac === null) return { ok: true, material: false, delta: 0, deltaPct: null };

  const verdict = evaluateMateriality(args.previousEac, args.nextEac, args.policy);
  if (verdict.material && String(args.explanation ?? "").trim().length < 10) {
    return {
      ok: false,
      code: FORECAST_MATERIALITY_EXPLANATION_REQUIRED,
      message: `EAC moves by ${verdict.delta.toFixed(2)} against the approved forecast. Explain the movement (at least 10 characters) before approving.`,
      material: true,
      delta: verdict.delta,
      deltaPct: verdict.deltaPct,
    };
  }
  return { ok: true, material: verdict.material, delta: verdict.delta, deltaPct: verdict.deltaPct };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const forecastVersionCreateSchema = z.object({
  projectId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}-01$/),
  label: z.string().trim().max(120).nullable().optional(),
});

export const forecastVersionActionSchema = z.object({
  versionId: z.string().uuid(),
  action: z.enum(["submit", "recall", "approve"]),
  explanation: z.string().trim().max(2000).nullable().optional(),
  expectedRowVersion: z.number().int().positive().nullable().optional(),
});

export const forecastVersionCompareSchema = z.object({
  projectId: z.string().uuid(),
  fromVersionId: z.string().uuid().nullable().optional(),
  toVersionId: z.string().uuid(),
});

export type ForecastVersionCreateInput = z.infer<typeof forecastVersionCreateSchema>;
export type ForecastVersionActionInput = z.infer<typeof forecastVersionActionSchema>;
export type ForecastVersionCompareInput = z.infer<typeof forecastVersionCompareSchema>;
