// GC-03 — Server-only layer for forecast versioning and costing period close.
//
// This module owns the ONE authoritative period check used by every costing
// mutation (`assertCostingPeriodOpen`). The database enforces the same rule via
// `assert_costing_period_open`, so a direct API call cannot bypass the app.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  costingAudit,
  costingHttpError,
  loadCostingProject,
  loadCostingWorkspace,
  type CostingWorkspaceData,
} from "@/lib/costing.server";
import { sumMoney } from "@/lib/costing.fx";
import {
  MATERIALITY_DEFAULTS,
  checkPosting,
  currentReportingPeriod,
  evaluateCloseReadiness,
  nextPeriodMonth,
  periodMonthOf,
  type CostingPeriodState,
  type MaterialityPolicy,
  type ReadinessItem,
} from "@/lib/costing.periods";
import {
  costCodeKey,
  diffSnapshots,
  snapshotTotals,
  type ForecastDiff,
  type ForecastSnapshotLine,
  type ForecastSnapshotTotals,
  type ForecastVersionStatus,
} from "@/lib/costing.versions";

export const COSTING_CLOSE_ROLES = ["finance_admin", "company_admin"] as const;

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------
export interface CostingSettings {
  company_id: string;
  reporting_timezone: string;
  materiality: MaterialityPolicy;
}

export async function loadCostingSettings(
  ctx: AuthContext,
  companyId: string,
): Promise<CostingSettings> {
  const { data } = await (ctx.supabase as any)
    .from("costing_settings")
    .select("company_id, reporting_timezone, materiality_abs, materiality_pct")
    .eq("company_id", companyId)
    .maybeSingle();
  return {
    company_id: companyId,
    reporting_timezone: data?.reporting_timezone ?? "UTC",
    materiality: {
      abs: Number(data?.materiality_abs ?? MATERIALITY_DEFAULTS.abs),
      pct: Number(data?.materiality_pct ?? MATERIALITY_DEFAULTS.pct),
    },
  };
}

// ---------------------------------------------------------------------------
// Period state + the single authoritative enforcement point
// ---------------------------------------------------------------------------
export interface CostingPeriodRow {
  id: string | null;
  company_id: string;
  project_id: string | null;
  period_month: string;
  state: CostingPeriodState;
  row_version: number;
  reason: string | null;
  soft_locked_at: string | null;
  hard_closed_at: string | null;
  reopened_at: string | null;
}

/** Missing table/function (not yet migrated) must never block a mutation. */
function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

export async function loadPeriodState(
  ctx: AuthContext,
  companyId: string,
  projectId: string | null,
  date: string,
): Promise<CostingPeriodState> {
  const { data, error } = await (ctx.supabase as any).rpc("costing_period_state", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_date: date,
  });
  if (error) {
    if (isMissingObject(error)) return "open";
    throw error;
  }
  return (data as CostingPeriodState) ?? "open";
}

export interface PeriodGuardOptions {
  /** The caller explicitly flagged this write as a soft-lock adjustment. */
  isAdjustment?: boolean;
  /** Mandatory when `isAdjustment` is true. */
  adjustmentReason?: string | null;
  /** Audit context. */
  entity?: string;
  entityId?: string | null;
}

/**
 * THE costing period gate. Call it as the first step after authorization in
 * every mutation that posts a dated costing fact, passing that mutation's own
 * business date. Throws a typed 409 the UI renders verbatim.
 */
export async function assertCostingPeriodOpen(
  ctx: AuthContext,
  companyId: string | null | undefined,
  projectId: string | null | undefined,
  date: string | null | undefined,
  opts: PeriodGuardOptions = {},
): Promise<void> {
  if (!companyId || !date) return;
  const period = periodMonthOf(date);
  const state = await loadPeriodState(ctx, companyId, projectId ?? null, date);
  if (state === "open") return;

  const canAdjust = await hasCloseRole(ctx);
  const reasonOk = String(opts.adjustmentReason ?? "").trim().length >= 3;
  const verdict = checkPosting(state, period, {
    isAdjustment: Boolean(opts.isAdjustment) && reasonOk,
    canAdjust,
  });

  if (!verdict.allowed) {
    await costingAudit(ctx, "costing.period.blocked", opts.entity ?? "costing_periods", opts.entityId ?? null, {
      company_id: companyId,
      project_id: projectId ?? null,
      period,
      state,
      attempted_date: date,
      code: verdict.code,
    });
    costingHttpError(409, verdict.code!, verdict.message);
  }

  // An allowed soft-lock adjustment is always audited with its reason.
  await costingAudit(ctx, "costing.period.adjustment", opts.entity ?? "costing_periods", opts.entityId ?? null, {
    company_id: companyId,
    project_id: projectId ?? null,
    period,
    state,
    attempted_date: date,
    reason: String(opts.adjustmentReason ?? "").trim(),
  });
}

export async function hasCloseRole(ctx: AuthContext): Promise<boolean> {
  const results = await Promise.all(
    COSTING_CLOSE_ROLES.map((r) => ctx.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

// ---------------------------------------------------------------------------
// Snapshot construction
// ---------------------------------------------------------------------------
function inPeriodOrBefore(date: string | null | undefined, period: string): boolean {
  if (!date) return true;
  return periodMonthOf(date) <= period;
}

/**
 * Build the frozen snapshot for one reporting month from the live workspace.
 *
 *   actual     — booked payable invoices issued in or before the month
 *   accruals   — approved accruals dated in or before the month
 *   committed  — commitments recognised to date (no dating on commitments)
 *   ETC        — forecast rows dated in or after the month (remaining work)
 *
 * Every amount is already in project currency at the rate locked on its own
 * row, so the snapshot never re-rates.
 */
export function buildSnapshotLines(
  ws: CostingWorkspaceData,
  period: string,
): ForecastSnapshotLine[] {
  const codeById = new Map(ws.costCodes.map((c) => [c.id, c]));
  const keys = new Set<string>();
  const push = (id: string | null | undefined) => keys.add(costCodeKey(id ?? null));

  for (const b of ws.cbs) if (!b.is_unassigned) keys.add(b.id);
  for (const c of ws.commitments) push(c.cost_code_id);
  for (const i of ws.invoices) push(i.cost_code_id);
  for (const a of ws.accruals) push(a.cost_code_id);
  for (const f of ws.forecasts) push(f.cost_code_id);

  const budgetByCode = new Map<string, number>();
  for (const row of ws.cbs) {
    if (row.has_children) continue;
    budgetByCode.set(row.is_unassigned ? costCodeKey(null) : row.id, row.current);
  }

  return [...keys]
    .sort()
    .map((key) => {
      const code = key === costCodeKey(null) ? null : (codeById.get(key) ?? null);
      const commitmentRows = ws.commitments.filter(
        (c) =>
          costCodeKey(c.cost_code_id) === key &&
          (c.kind === "purchase_order"
            ? ["approved", "issued", "partially_received", "received", "closed"].includes(c.status)
            : c.kind === "subcontract"
              ? ["active", "complete"].includes(c.status)
              : c.status === "approved"),
      );
      const invoiceRows = ws.invoices.filter(
        (i) =>
          costCodeKey(i.cost_code_id) === key &&
          i.direction === "payable" &&
          ["approved", "sent", "partially_paid", "paid"].includes(i.status) &&
          inPeriodOrBefore(i.issue_date, period),
      );
      const accrualRows = ws.accruals.filter(
        (a) =>
          costCodeKey(a.cost_code_id) === key &&
          a.status === "approved" &&
          inPeriodOrBefore(a.period, period),
      );
      const forecastRows = ws.forecasts.filter(
        (f) => costCodeKey(f.cost_code_id) === key && f.period >= period,
      );

      const actual = sumMoney(invoiceRows.map((i) => i.amount_base));
      const accruals = sumMoney(accrualRows.map((a) => a.amount_base));
      const etcBase = sumMoney(forecastRows.map((f) => f.etc_amount_base));
      const etcTxn = sumMoney(forecastRows.map((f) => f.etc_amount));
      const budget = budgetByCode.get(key) ?? 0;
      const eac = sumMoney([actual, accruals, etcBase]);
      const primary = forecastRows[0] ?? null;

      return {
        cost_code_id: key === costCodeKey(null) ? null : key,
        cost_code_key: key,
        cost_code: code?.code ?? null,
        cost_code_name: code?.name ?? null,
        currency_code: primary?.currency_code ?? ws.baseCurrency,
        base_currency_code: ws.baseCurrency,
        fx_rate: Number(primary?.fx_rate ?? 1),
        fx_rate_date: primary?.fx_rate_date ?? null,
        fx_source: primary?.fx_source ?? "parity",
        fx_override_reason: primary?.fx_override_reason ?? null,
        etc_amount: etcTxn,
        etc_amount_base: etcBase,
        budget_current: budget,
        committed: sumMoney(commitmentRows.map((c) => c.amount_base)),
        actual,
        accruals,
        eac,
        vac: sumMoney([budget, -eac]),
      } satisfies ForecastSnapshotLine;
    })
    .filter(
      (l) =>
        l.etc_amount_base !== 0 ||
        l.actual !== 0 ||
        l.accruals !== 0 ||
        l.committed !== 0 ||
        l.budget_current !== 0,
    );
}

// ---------------------------------------------------------------------------
// Version reads
// ---------------------------------------------------------------------------
export interface ForecastVersionRow {
  id: string;
  company_id: string;
  project_id: string;
  reporting_period: string;
  version_no: number;
  status: ForecastVersionStatus;
  row_version: number;
  base_currency_code: string;
  label: string | null;
  totals: ForecastSnapshotTotals;
  materiality_explanation: string | null;
  previous_version_id: string | null;
  superseded_by_id: string | null;
  created_by: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  superseded_at: string | null;
  created_at: string;
}

const VERSION_COLUMNS =
  "id, company_id, project_id, reporting_period, version_no, status, row_version, base_currency_code, label, totals, materiality_explanation, previous_version_id, superseded_by_id, created_by, submitted_at, approved_at, superseded_at, created_at";

export async function loadForecastVersions(
  ctx: AuthContext,
  projectId: string,
): Promise<ForecastVersionRow[]> {
  const { data, error } = await (ctx.supabase as any)
    .from("forecast_versions")
    .select(VERSION_COLUMNS)
    .eq("project_id", projectId)
    .order("reporting_period", { ascending: false })
    .order("version_no", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ForecastVersionRow[];
}

export async function loadForecastVersion(
  ctx: AuthContext,
  versionId: string,
): Promise<ForecastVersionRow> {
  const { data, error } = await (ctx.supabase as any)
    .from("forecast_versions")
    .select(VERSION_COLUMNS)
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) costingHttpError(404, "forecast_version_not_found");
  return data as ForecastVersionRow;
}

export async function loadVersionLines(
  ctx: AuthContext,
  versionId: string,
): Promise<ForecastSnapshotLine[]> {
  const { data, error } = await (ctx.supabase as any)
    .from("forecast_version_lines")
    .select("*")
    .eq("version_id", versionId)
    .order("cost_code_key", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((l) => ({
    cost_code_id: l.cost_code_id ?? null,
    cost_code_key: l.cost_code_key,
    cost_code: l.cost_code ?? null,
    cost_code_name: l.cost_code_name ?? null,
    currency_code: l.currency_code,
    base_currency_code: l.base_currency_code,
    fx_rate: Number(l.fx_rate ?? 1),
    fx_rate_date: l.fx_rate_date ?? null,
    fx_source: l.fx_source ?? "parity",
    fx_override_reason: l.fx_override_reason ?? null,
    etc_amount: Number(l.etc_amount ?? 0),
    etc_amount_base: Number(l.etc_amount_base ?? 0),
    budget_current: Number(l.budget_current ?? 0),
    committed: Number(l.committed ?? 0),
    actual: Number(l.actual ?? 0),
    accruals: Number(l.accruals ?? 0),
    eac: Number(l.eac ?? 0),
    vac: Number(l.vac ?? 0),
  }));
}

export async function compareVersions(
  ctx: AuthContext,
  fromVersionId: string | null,
  toVersionId: string,
): Promise<ForecastDiff> {
  const [from, to] = await Promise.all([
    fromVersionId ? loadVersionLines(ctx, fromVersionId) : Promise.resolve([]),
    loadVersionLines(ctx, toVersionId),
  ]);
  return diffSnapshots(from, to);
}

// ---------------------------------------------------------------------------
// Close dashboard
// ---------------------------------------------------------------------------
export interface CostingCloseData {
  project: { id: string; company_id: string; name: string; code: string };
  baseCurrency: string;
  settings: { reporting_timezone: string; materiality_abs: number; materiality_pct: number };
  currentPeriod: string;
  focusPeriod: string;
  nextPeriod: string;
  /** Effective state of the focus period (company + project locks combined). */
  state: CostingPeriodState;
  canClose: boolean;
  periods: CostingPeriodRow[];
  readiness: { items: ReadinessItem[]; ready: boolean };
  versions: ForecastVersionRow[];
  /** Snapshot preview of the live working position for the focus period. */
  preview: { lines: ForecastSnapshotLine[]; totals: ForecastSnapshotTotals };
}

export async function loadCostingClose(
  ctx: AuthContext,
  projectId: string,
  requestedPeriod?: string,
): Promise<CostingCloseData> {
  const project = await loadCostingProject(ctx, projectId);
  const settings = await loadCostingSettings(ctx, project.company_id);
  const currentPeriod = currentReportingPeriod(settings.reporting_timezone);
  const focusPeriod = requestedPeriod ?? currentPeriod;

  const [ws, versions, periodsQ, state, canClose] = await Promise.all([
    loadCostingWorkspace(ctx, projectId),
    loadForecastVersions(ctx, projectId),
    (ctx.supabase as any)
      .from("costing_periods")
      .select("*")
      .eq("company_id", project.company_id)
      .or(`project_id.is.null,project_id.eq.${projectId}`)
      .order("period_month", { ascending: false })
      .limit(36),
    loadPeriodState(ctx, project.company_id, projectId, focusPeriod),
    hasCloseRole(ctx),
  ]);
  if (periodsQ?.error) throw periodsQ.error;

  const periodVersions = versions.filter((v) => v.reporting_period === focusPeriod);
  const readiness = evaluateCloseReadiness({
    period: focusPeriod,
    accruals: ws.accruals
      .filter((a) => a.period === focusPeriod)
      .map((a) => ({
        id: a.id,
        status: a.status,
        fx_rate: a.fx_rate,
        currency_code: a.currency_code,
      })),
    forecasts: ws.forecasts
      .filter((f) => f.period === focusPeriod)
      .map((f) => ({
        id: f.id,
        fx_rate: f.fx_rate,
        currency_code: f.currency_code,
        cost_code_id: f.cost_code_id,
      })),
    invoices: ws.invoices
      .filter(
        (i) =>
          i.direction === "payable" &&
          ["approved", "sent", "partially_paid", "paid"].includes(i.status) &&
          periodMonthOf(i.issue_date ?? focusPeriod) === focusPeriod,
      )
      .map((i) => ({ id: i.id, status: i.status, cost_code_id: i.cost_code_id })),
    versions: periodVersions.map((v) => ({ id: v.id, status: v.status })),
  });

  const lines = buildSnapshotLines(ws, focusPeriod);

  return {
    project,
    baseCurrency: ws.baseCurrency,
    settings: {
      reporting_timezone: settings.reporting_timezone,
      materiality_abs: settings.materiality.abs,
      materiality_pct: settings.materiality.pct,
    },
    currentPeriod,
    focusPeriod,
    nextPeriod: nextPeriodMonth(focusPeriod),
    state,
    canClose,
    periods: ((periodsQ.data ?? []) as any[]).map((p) => ({
      id: p.id,
      company_id: p.company_id,
      project_id: p.project_id ?? null,
      period_month: p.period_month,
      state: p.state,
      row_version: Number(p.row_version ?? 1),
      reason: p.reason ?? null,
      soft_locked_at: p.soft_locked_at ?? null,
      hard_closed_at: p.hard_closed_at ?? null,
      reopened_at: p.reopened_at ?? null,
    })),
    readiness,
    versions,
    preview: { lines, totals: snapshotTotals(lines, ws.baseCurrency) },
  };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const TRANSITION_TITLES: Record<CostingPeriodState, string> = {
  open: "Costing period reopened",
  soft_locked: "Costing period soft locked",
  hard_closed: "Costing period hard closed",
};

/**
 * Notify finance role holders on a period transition. Best-effort and
 * de-duplicated by (period, state) so a repeated idempotent call never
 * re-notifies.
 */
export async function notifyPeriodTransition(
  ctx: AuthContext,
  args: {
    companyId: string;
    projectId: string | null;
    projectName: string | null;
    period: string;
    state: CostingPeriodState;
    reason: string | null;
    rowVersion?: number | null;
  },
): Promise<number> {
  try {
    const sb = ctx.supabase as any;
    const type = `costing.period.${args.state}`;
    const { data: existing } = await sb
      .from("notifications")
      .select("id")
      .eq("company_id", args.companyId)
      .eq("type", type)
      .contains("metadata", {
        period: args.period,
        project_id: args.projectId,
        // row_version makes the key one-per-transition, so lock -> reopen ->
        // lock notifies twice while a repeated idempotent call never does.
        row_version: args.rowVersion ?? null,
      })
      .limit(1);
    if ((existing ?? []).length > 0) return 0;

    const { data: holders } = await sb
      .from("user_roles")
      .select("user_id")
      .eq("company_id", args.companyId)
      .in("role", [...COSTING_CLOSE_ROLES]);
    const userIds = [...new Set(((holders ?? []) as { user_id: string }[]).map((h) => h.user_id))];
    if (userIds.length === 0) return 0;

    const scope = args.projectName ? `${args.projectName} — ` : "";
    await sb.from("notifications").insert(
      userIds.map((uid) => ({
        company_id: args.companyId,
        user_id: uid,
        type,
        title: TRANSITION_TITLES[args.state],
        body: `${scope}${args.period.slice(0, 7)}${args.reason ? ` — ${args.reason}` : ""}`,
        link: args.projectId ? `/projects/${args.projectId}/costing/close` : "/finance/periods",
        metadata: {
          period: args.period,
          project_id: args.projectId,
          state: args.state,
          reason: args.reason,
          row_version: args.rowVersion ?? null,
        },
      })),
    );
    return userIds.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Period transitions
// ---------------------------------------------------------------------------
export interface PeriodTransitionResult {
  state: CostingPeriodState;
  rowVersion: number;
  notified: number;
}

/**
 * Move a costing period between states. Idempotent, optimistic-concurrency
 * checked, reason-bearing on reopen, and blocked by the readiness checklist on
 * a hard close. The database function performs the same authorization and
 * transition validation, so this is defence in depth, not the only guard.
 */
export async function transitionPeriod(
  ctx: AuthContext,
  input: {
    companyId: string;
    projectId?: string | null;
    period: string;
    target: CostingPeriodState;
    reason?: string | null;
    expectedVersion?: number | null;
  },
): Promise<PeriodTransitionResult> {
  const sb = ctx.supabase as any;
  const projectId = input.projectId ?? null;

  let projectName: string | null = null;
  if (projectId) {
    const project = await loadCostingProject(ctx, projectId);
    if (project.company_id !== input.companyId) costingHttpError(403, "forbidden");
    projectName = project.name;

    if (input.target === "hard_closed") {
      const close = await loadCostingClose(ctx, projectId, input.period);
      const blockers = close.readiness.items.filter((i) => i.severity === "blocker");
      if (blockers.length > 0) {
        costingHttpError(
          409,
          "costing_period_not_ready",
          `Resolve ${blockers.length} blocking item(s) before hard closing ${input.period.slice(0, 7)}.`,
        );
      }
    }
  }

  const { data, error } = await sb.rpc("transition_costing_period", {
    p_company_id: input.companyId,
    p_project_id: projectId,
    p_period_month: input.period,
    p_target: input.target,
    p_reason: input.reason ?? null,
    p_expected_version: input.expectedVersion ?? null,
  });
  if (error) {
    const message = String(error.message ?? "");
    const code =
      message.match(
        /(costing_period_[a-z_]+|forbidden)/,
      )?.[1] ?? "costing_period_transition_failed";
    costingHttpError(code === "forbidden" ? 403 : 409, code, message.replace(/^.*?:\s*/, ""));
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { state: CostingPeriodState; row_version: number }
    | null;
  const state = row?.state ?? input.target;
  const rowVersion = Number(row?.row_version ?? 1);

  await costingAudit(ctx, `costing.period.${input.target}`, "costing_periods", null, {
    company_id: input.companyId,
    project_id: projectId,
    period: input.period,
    state,
    reason: input.reason ?? null,
    row_version: rowVersion,
  });

  const notified = await notifyPeriodTransition(ctx, {
    companyId: input.companyId,
    projectId,
    projectName,
    period: input.period,
    state,
    reason: input.reason ?? null,
    rowVersion,
  });

  return { state, rowVersion, notified };
}
