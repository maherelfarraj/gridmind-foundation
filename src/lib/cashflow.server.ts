// GC-13 — Governed cash flow, funding and liquidity: authorized persistence.
//
// This module NEVER recomputes cost. Budget, commitment, actual, accrual and
// bottom-up ETC all come from `loadCostingWorkspace` (the costing module's
// single source of truth). Cash flow adds only the *timing* dimension: when
// authoritative money is expected to move, translated once through the shared
// fx_rates provenance and frozen into its own snapshot.
//
// Approved snapshots are immutable and are NEVER re-rated: reads of an
// approved snapshot replay the stored lines and stored fx provenance.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";
import {
  addDays,
  applyCashScenario,
  assessCashQuality,
  bucketStartOf,
  buildBuckets,
  cashAlertFingerprint,
  cashConversionVariance,
  cashSupersedePlan,
  checkCashTransition,
  checkCovenants,
  compareScenario,
  concentration,
  consolidatePortfolio,
  dedupeExceptions,
  dedupeLines,
  computeLiquidity,
  expectedCashDate,
  facilityState,
  fundingPosition,
  hasBlocker,
  maturityLadder,
  SOURCE_PRECEDENCE,
  reconcileCashflow,
  CASHFLOW_SNAPSHOT_FROZEN,
  CASHFLOW_VERSION_CONFLICT,
  type BucketGranularity,
  type CashBucket,
  type CashLine,
  type CashScenarioInput,
  type CashflowAdjustmentInput,
  type CashflowCalculateInput,
  type CashflowCsvInput,
  type CashflowException,
  type CashflowSettingsInput,
  type CashflowStatus,
  type CovenantCheck,
  type FacilityModel,
  type FacilityState,
  type FundingAllocationInput,
  type FundingFacilityInput,
  type FundingPosition,
  type LiquidityMeasures,
  type PortfolioCashFilter,
  type PortfolioCashRow,
  type PortfolioCashTotals,
  type ReconciliationResult,
} from "@/lib/cashflow.rules";
import { fromMinor, roundMoney, toMinor } from "@/lib/costing.fx";
import { currentReportingPeriod, mostRestrictiveState } from "@/lib/costing.periods";
import {
  COSTING_WRITE_ROLES,
  costingAudit,
  costingHttpError,
  hasAnyCostingRole,
  loadCostingProject,
  loadCostingWorkspace,
  resolveCostingFx,
  type CostingWorkspaceData,
} from "@/lib/costing.server";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;
const CASH_TZ = "UTC";

function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return (data ?? []) as T[];
}

async function one<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
  return (data ?? null) as T | null;
}

// ---------------------------------------------------------------------------
// Authorization and period locks
// ---------------------------------------------------------------------------
export async function requireCashflowWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyCostingRole(ctx, COSTING_WRITE_ROLES))) {
    costingHttpError(403, "forbidden", "Project controls or finance role required.");
  }
}

async function periodState(ctx: AuthContext, projectId: string, period: string) {
  const raw = await rows<{ state: string }>(
    sbOf(ctx)
      .from("costing_periods")
      .select("project_id, state")
      .eq("period_month", period)
      .or(`project_id.eq.${projectId},project_id.is.null`),
  );
  return mostRestrictiveState(...(raw.map((r) => r.state) as never[]));
}

async function assertPeriodOpen(ctx: AuthContext, projectId: string, period: string) {
  if ((await periodState(ctx, projectId, period)) === "hard_closed") {
    costingHttpError(409, "costing_period_hard_closed", "The reporting period is closed.");
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export interface CashflowSettings {
  project_id: string;
  bucket_granularity: BucketGranularity;
  horizon_buckets: number;
  receipt_lag_days: number;
  payment_lag_days: number;
  retention_release_lag_days: number;
  advance_recovery_pct: number;
  include_tax: boolean;
  include_commitments: boolean;
  include_accruals: boolean;
  min_liquidity_amount: number;
  opening_cash: number;
}

const DEFAULT_CASH_SETTINGS: Omit<CashflowSettings, "project_id"> = {
  bucket_granularity: "month",
  horizon_buckets: 18,
  receipt_lag_days: 30,
  payment_lag_days: 30,
  retention_release_lag_days: 365,
  advance_recovery_pct: 0,
  include_tax: true,
  include_commitments: true,
  include_accruals: true,
  min_liquidity_amount: 0,
  opening_cash: 0,
};

export async function loadCashflowSettings(
  ctx: AuthContext,
  projectId: string,
): Promise<CashflowSettings> {
  const row = await one<Record<string, unknown>>(
    sbOf(ctx).from("cashflow_settings").select("*").eq("project_id", projectId).maybeSingle(),
  );
  if (!row) return { project_id: projectId, ...DEFAULT_CASH_SETTINGS };
  return {
    project_id: projectId,
    bucket_granularity: (row["bucket_granularity"] as BucketGranularity) ?? "month",
    horizon_buckets: Number(row["horizon_buckets"] ?? DEFAULT_CASH_SETTINGS.horizon_buckets),
    receipt_lag_days: Number(row["receipt_lag_days"] ?? DEFAULT_CASH_SETTINGS.receipt_lag_days),
    payment_lag_days: Number(row["payment_lag_days"] ?? DEFAULT_CASH_SETTINGS.payment_lag_days),
    retention_release_lag_days: Number(
      row["retention_release_lag_days"] ?? DEFAULT_CASH_SETTINGS.retention_release_lag_days,
    ),
    advance_recovery_pct: Number(row["advance_recovery_pct"] ?? 0),
    include_tax: row["include_tax"] !== false,
    include_commitments: row["include_commitments"] !== false,
    include_accruals: row["include_accruals"] !== false,
    min_liquidity_amount: Number(row["min_liquidity_amount"] ?? 0),
    opening_cash: Number(row["opening_cash"] ?? 0),
  };
}

export async function saveCashflowSettings(
  ctx: AuthContext,
  input: CashflowSettingsInput,
): Promise<CashflowSettings> {
  await requireCashflowWrite(ctx);
  const project = await loadCostingProject(ctx, input.project_id);
  const current = await loadCashflowSettings(ctx, input.project_id);
  const next = { ...current, ...input, project_id: input.project_id };
  const { error } = await sbOf(ctx)
    .from("cashflow_settings")
    .upsert(
      {
        company_id: project.company_id,
        project_id: input.project_id,
        bucket_granularity: next.bucket_granularity,
        horizon_buckets: next.horizon_buckets,
        receipt_lag_days: next.receipt_lag_days,
        payment_lag_days: next.payment_lag_days,
        retention_release_lag_days: next.retention_release_lag_days,
        advance_recovery_pct: next.advance_recovery_pct,
        include_tax: next.include_tax,
        include_commitments: next.include_commitments,
        include_accruals: next.include_accruals,
        min_liquidity_amount: next.min_liquidity_amount,
        opening_cash: next.opening_cash,
        created_by: ctx.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    );
  if (error) throw error;
  await costingAudit(ctx, "cashflow.settings.saved", "cashflow_settings", input.project_id, {
    project_id: input.project_id,
  });
  return next;
}

// ---------------------------------------------------------------------------
// FX (shared provenance; never re-rated after approval)
// ---------------------------------------------------------------------------
export interface CashFxEntry {
  currency_code: string;
  rate: number | null;
  rate_date: string | null;
  source: string;
  stale: boolean;
  missing: boolean;
}

async function resolveFxTable(
  ctx: AuthContext,
  projectId: string,
  currencies: readonly string[],
  onDate: string,
): Promise<Map<string, CashFxEntry>> {
  const out = new Map<string, CashFxEntry>();
  for (const c of new Set(currencies.map((x) => x.toUpperCase()))) {
    const fx = await resolveCostingFx(ctx, projectId, c, onDate);
    out.set(c, {
      currency_code: c,
      rate: fx.fx_rate,
      rate_date: fx.fx_rate_date,
      source: fx.fx_source,
      stale: fx.stale,
      missing: fx.missing,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cash line construction
// ---------------------------------------------------------------------------
interface LineDraft {
  key: string;
  direction: "inflow" | "outflow";
  source: CashLine["source"];
  category: string;
  counterparty: string | null;
  cost_code_id: string | null;
  amount_native: number;
  currency_code: string;
  reference_type: string | null;
  reference_id: string | null;
  suppression_key: string | null;
  dateInput: Parameters<typeof expectedCashDate>[0];
}

const OPEN_INVOICE_STATUSES = new Set([
  "submitted",
  "under_review",
  "approved",
  "sent",
  "partially_paid",
  "disputed",
]);

/**
 * Turn the authoritative costing workspace into timed cash events.
 *
 * Precedence (see SOURCE_PRECEDENCE): settled payments beat invoices, invoices
 * beat accruals, accruals beat commitments, commitments beat generic forecast
 * for the same cost code and bucket. Nothing is invented and nothing is
 * counted twice.
 */
export function buildCashLineDrafts(
  ws: CostingWorkspaceData,
  settings: CashflowSettings,
  period: string,
  dataDate: string,
): LineDraft[] {
  const drafts: LineDraft[] = [];
  const g = settings.bucket_granularity;

  // 1. Settled payments — the hardest evidence there is.
  for (const p of ws.payments) {
    if (p.record_status !== "recorded") continue;
    drafts.push({
      key: `payment:${p.id}`,
      direction: p.direction === "receivable" ? "inflow" : "outflow",
      source: "actual",
      category: p.direction === "receivable" ? "receipt" : "payment",
      counterparty: null,
      cost_code_id: p.cost_code_id,
      amount_native: Math.abs(Number(p.amount) || 0),
      currency_code: p.currency_code,
      reference_type: "payments",
      reference_id: p.id,
      suppression_key: null,
      dateInput: { actualDate: p.payment_date, fallbackDate: period },
    });
  }

  // 2. Open invoices — contractual amounts not yet settled.
  for (const inv of ws.invoices) {
    if (!OPEN_INVOICE_STATUSES.has(inv.status)) continue;
    const gross = Math.abs(Number(inv.amount) || 0);
    const paid = Math.abs(Number(inv.paid_amount) || 0);
    const outstandingMinor = Math.max(0, toMinor(gross) - toMinor(paid));
    if (outstandingMinor === 0) continue;
    const inflow = inv.direction === "receivable";
    const lag = inflow ? settings.receipt_lag_days : settings.payment_lag_days;
    const retentionPct = Number((inv as { retention_pct?: number }).retention_pct ?? 0);
    const retentionMinor =
      inflow && retentionPct > 0 ? Math.round((outstandingMinor * retentionPct) / 100) : 0;
    const netMinor = outstandingMinor - retentionMinor;

    if (netMinor > 0) {
      drafts.push({
        key: `invoice:${inv.id}`,
        direction: inflow ? "inflow" : "outflow",
        source: "invoice",
        category: inflow ? "receivable" : "payable",
        counterparty: null,
        cost_code_id: inv.cost_code_id,
        amount_native: fromMinor(netMinor),
        currency_code: inv.currency_code,
        reference_type: "invoices",
        reference_id: inv.id,
        suppression_key: null,
        dateInput: {
          dueDate: inv.due_date,
          documentDate: inv.issue_date,
          termsDays: lag,
          fallbackDate: period,
        },
      });
    }
    // Retention is real money, only later.
    if (retentionMinor > 0) {
      drafts.push({
        key: `retention:${inv.id}`,
        direction: "inflow",
        source: "retention",
        category: "retention_release",
        counterparty: null,
        cost_code_id: inv.cost_code_id,
        amount_native: fromMinor(retentionMinor),
        currency_code: inv.currency_code,
        reference_type: "invoices",
        reference_id: inv.id,
        suppression_key: null,
        dateInput: {
          documentDate: inv.due_date ?? inv.issue_date,
          termsDays: settings.retention_release_lag_days,
          fallbackDate: period,
        },
      });
    }
  }

  // 3. Approved accruals — recognised cost awaiting an invoice.
  if (settings.include_accruals) {
    for (const a of ws.accruals) {
      if (a.status !== "approved") continue;
      const bucket = bucketStartOf(a.period, g);
      drafts.push({
        key: `accrual:${a.id}`,
        direction: "outflow",
        source: "accrual",
        category: "accrued_cost",
        counterparty: null,
        cost_code_id: a.cost_code_id,
        amount_native: Math.abs(Number(a.amount) || 0),
        currency_code: a.currency_code,
        reference_type: "cost_accruals",
        reference_id: a.id,
        suppression_key: `cc:${a.cost_code_id}:${bucket}`,
        dateInput: {
          documentDate: a.period,
          termsDays: settings.payment_lag_days,
          fallbackDate: period,
        },
      });
    }
  }

  // 4. Open commitments — POs, subcontracts and approved change orders.
  if (settings.include_commitments) {
    for (const c of ws.commitments) {
      const amount = Math.abs(Number(c.amount) || 0);
      if (amount === 0) continue;
      const bucket = bucketStartOf(dataDate, g);
      drafts.push({
        key: `commitment:${c.id}`,
        direction: "outflow",
        source: "commitment",
        category: c.kind,
        counterparty: c.counterparty,
        cost_code_id: c.cost_code_id,
        amount_native: amount,
        currency_code: c.currency_code,
        reference_type: c.kind,
        reference_id: c.id,
        suppression_key: `cc:${c.cost_code_id}:${bucket}`,
        dateInput: {
          documentDate: dataDate,
          termsDays: settings.payment_lag_days,
          fallbackDate: period,
        },
      });
    }
  }

  // 5. Bottom-up forecast (ETC) — the softest basis, suppressed by anything firmer.
  for (const f of ws.forecasts) {
    const etc = Math.abs(Number(f.etc_amount) || 0);
    if (etc === 0) continue;
    const bucket = bucketStartOf(f.period, g);
    drafts.push({
      key: `forecast:${f.id}`,
      direction: "outflow",
      source: "forecast",
      category: "forecast_cost",
      counterparty: null,
      cost_code_id: f.cost_code_id,
      amount_native: etc,
      currency_code: f.currency_code,
      reference_type: "cost_forecast_periods",
      reference_id: f.id,
      suppression_key: `cc:${f.cost_code_id}:${bucket}`,
      dateInput: {
        documentDate: f.period,
        termsDays: settings.payment_lag_days,
        fallbackDate: period,
      },
    });
  }

  // 6. Advance recovery against contracted revenue, when configured.
  if (settings.advance_recovery_pct > 0) {
    for (const c of ws.contracts) {
      const value = Math.abs(Number(c.value) || 0);
      if (value === 0) continue;
      drafts.push({
        key: `advance:${c.id}`,
        direction: "outflow",
        source: "advance",
        category: "advance_recovery",
        counterparty: c.counterparty,
        cost_code_id: null,
        amount_native: roundMoney((value * settings.advance_recovery_pct) / 100),
        currency_code: c.currency_code,
        reference_type: "contracts",
        reference_id: c.id,
        suppression_key: null,
        dateInput: {
          documentDate: dataDate,
          termsDays: settings.receipt_lag_days,
          fallbackDate: period,
        },
      });
    }
  }

  return drafts;
}

// ---------------------------------------------------------------------------
// Compute
// ---------------------------------------------------------------------------
export interface CashflowComputed {
  project_id: string;
  period_month: string;
  data_date: string;
  granularity: BucketGranularity;
  horizon_buckets: number;
  reporting_currency: string;
  project_currency: string;
  opening_cash: number;
  lines: CashLine[];
  suppressed: CashLine[];
  buckets: CashBucket[];
  measures: LiquidityMeasures;
  reconciliation: ReconciliationResult;
  facilities: FacilityState[];
  funding: FundingPosition;
  covenants: CovenantCheck[];
  maturity: ReturnType<typeof maturityLadder>;
  conversion: ReturnType<typeof cashConversionVariance>;
  exceptions: CashflowException[];
  fx: CashFxEntry[];
  fx_missing: string[];
  forecast_version_id: string | null;
  adjustments: AdjustmentRow[];
  ready_to_approve: boolean;
}

export interface AdjustmentRow {
  id: string;
  project_id: string;
  effective_period: string;
  bucket_date: string;
  direction: "inflow" | "outflow";
  category: string;
  counterparty: string | null;
  amount: number;
  currency_code: string;
  reason: string;
  evidence_reference: string | null;
  status: "draft" | "authorized" | "voided";
  version_no: number;
  row_version: number;
  prepared_by: string | null;
  authorized_by: string | null;
  authorized_at: string | null;
  created_at: string;
}

async function loadAdjustments(
  ctx: AuthContext,
  projectId: string,
  period?: string,
): Promise<AdjustmentRow[]> {
  let q = sbOf(ctx)
    .from("cashflow_adjustments")
    .select("*")
    .eq("project_id", projectId)
    .order("bucket_date", { ascending: true });
  if (period) q = q.eq("effective_period", period);
  return rows<AdjustmentRow>(q);
}

async function loadFacilityModels(
  ctx: AuthContext,
  companyId: string,
  projectId: string | null,
): Promise<{ models: FacilityModel[]; raw: Record<string, unknown>[] }> {
  const raw = await rows<Record<string, unknown>>(
    sbOf(ctx).from("funding_facilities").select("*").eq("company_id", companyId),
  );
  const allocations = await rows<Record<string, unknown>>(
    sbOf(ctx).from("funding_allocations").select("*").eq("company_id", companyId),
  );
  const models = raw.map((f) => {
    const allocated = allocations
      .filter(
        (a) => a["facility_id"] === f["id"] && (projectId == null || a["project_id"] === projectId),
      )
      .reduce((sum, a) => sum + toMinor(Number(a["allocated_amount"]) || 0), 0);
    return {
      id: String(f["id"]),
      name: String(f["name"] ?? ""),
      currency_code: String(f["currency_code"] ?? "USD").toUpperCase(),
      committed_amount: Number(f["committed_amount"] ?? 0),
      available_from: (f["available_from"] as string | null) ?? null,
      expiry_date: (f["expiry_date"] as string | null) ?? null,
      status: (f["status"] as FacilityModel["status"]) ?? "planned",
      drawdown_schedule: Array.isArray(f["drawdown_schedule"])
        ? (f["drawdown_schedule"] as { date: string; amount: number }[])
        : [],
      repayment_schedule: Array.isArray(f["repayment_schedule"])
        ? (f["repayment_schedule"] as { date: string; amount: number }[])
        : [],
      covenants: Array.isArray(f["covenants"])
        ? (f["covenants"] as FacilityModel["covenants"])
        : [],
      allocated_amount: allocated > 0 ? fromMinor(allocated) : projectId == null ? null : 0,
      fx_rate: null,
    } satisfies FacilityModel;
  });
  return { models, raw };
}

export async function computeCashflow(
  ctx: AuthContext,
  input: CashflowCalculateInput,
): Promise<CashflowComputed> {
  const project = await loadCostingProject(ctx, input.project_id);
  const settings = await loadCashflowSettings(ctx, input.project_id);
  const period = input.period ?? currentReportingPeriod(CASH_TZ);
  const dataDate = input.data_date ?? period;
  const granularity = input.granularity ?? settings.bucket_granularity;
  const horizon = input.horizon_buckets ?? settings.horizon_buckets;

  const ws = await loadCostingWorkspace(ctx, input.project_id);
  const reporting = (input.currency ?? ws.baseCurrency).toUpperCase();
  const drafts = buildCashLineDrafts(
    ws,
    { ...settings, bucket_granularity: granularity },
    period,
    dataDate,
  );

  const adjustments = (await loadAdjustments(ctx, input.project_id)).filter(
    (a) => a.status === "authorized",
  );
  for (const a of adjustments) {
    drafts.push({
      key: `adjustment:${a.id}`,
      direction: a.direction,
      source: "adjustment",
      category: a.category,
      counterparty: a.counterparty,
      cost_code_id: null,
      amount_native: Math.abs(a.amount),
      currency_code: a.currency_code,
      reference_type: "cashflow_adjustments",
      reference_id: a.id,
      suppression_key: null,
      dateInput: { actualDate: a.bucket_date, fallbackDate: a.effective_period },
    });
  }

  const fxMap = await resolveFxTable(
    ctx,
    input.project_id,
    drafts.map((d) => d.currency_code),
    dataDate,
  );

  const allLines: CashLine[] = drafts.map((d) => {
    const fx = fxMap.get(d.currency_code.toUpperCase());
    const rate = fx?.rate ?? null;
    const when = expectedCashDate(d.dateInput);
    return {
      key: d.key,
      direction: d.direction,
      source: d.source,
      category: d.category,
      counterparty: d.counterparty,
      cost_code_id: d.cost_code_id,
      date: when.date,
      date_basis: when.basis,
      amount_native: roundMoney(d.amount_native),
      currency_code: d.currency_code.toUpperCase(),
      fx_rate: rate,
      fx_rate_date: fx?.rate_date ?? null,
      fx_source: fx?.source ?? null,
      fx_stale: fx?.stale ?? false,
      amount_reporting: rate == null ? 0 : fromMinor(Math.round(toMinor(d.amount_native) * rate)),
      reference_type: d.reference_type,
      reference_id: d.reference_id,
      suppression_key: d.suppression_key,
    };
  });

  const { kept, suppressed } = dedupeLines(allLines);
  const buckets = buildBuckets(kept, {
    granularity,
    from: period,
    count: horizon,
    openingCash: settings.opening_cash,
  });
  const measures = computeLiquidity(buckets, settings.opening_cash);
  const reconciliation = reconcileCashflow(kept, granularity);

  const { models } = await loadFacilityModels(ctx, project.company_id, input.project_id);
  const facilityFx = await resolveFxTable(
    ctx,
    input.project_id,
    models.map((m) => m.currency_code),
    dataDate,
  );
  const withRates = models.map((m) => ({
    ...m,
    fx_rate: facilityFx.get(m.currency_code)?.rate ?? null,
  }));
  const facilities = withRates.map((m) => facilityState(m, dataDate));
  const funding = fundingPosition(
    measures.peak_funding_need,
    facilities,
    settings.min_liquidity_amount,
  );

  const actualOut = kept
    .filter((l) => l.source === "actual" && l.direction === "outflow")
    .reduce((s, l) => s + toMinor(l.amount_reporting), 0);
  const actualIn = kept
    .filter((l) => l.source === "actual" && l.direction === "inflow")
    .reduce((s, l) => s + toMinor(l.amount_reporting), 0);
  const billed = ws.invoices
    .filter((i) => i.direction === "receivable")
    .reduce((s, i) => s + toMinor(Number(i.amount) || 0), 0);
  const conversion = cashConversionVariance({
    actual_cost: ws.baseRollup.actual ?? 0,
    actual_cash_out: fromMinor(actualOut),
    billed_revenue: fromMinor(billed),
    cash_in: fromMinor(actualIn),
  });
  const covenants = checkCovenants(withRates, {
    liquidity: measures.closing_cash,
    headroom: funding.headroom,
    peak_funding_need: measures.peak_funding_need,
    minimum_liquidity: measures.minimum_liquidity,
  });

  const fxMissing = [...fxMap.values()].filter((f) => f.missing).map((f) => f.currency_code);
  const counterpartyTop =
    concentration(
      kept
        .filter((l) => l.direction === "outflow" && l.counterparty)
        .map((l) => ({ key: l.counterparty as string, amount: l.amount_reporting })),
    )[0] ?? null;

  const forecastVersion = await one<{ id: string; approved_at: string | null }>(
    sbOf(ctx)
      .from("forecast_versions")
      .select("id, approved_at")
      .eq("project_id", input.project_id)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  const basisAgeDays = forecastVersion?.approved_at
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${dataDate}T00:00:00Z`) - Date.parse(forecastVersion.approved_at)) /
            86_400_000,
        ),
      )
    : null;

  const exceptions = dedupeExceptions(
    assessCashQuality({
      fxMissingCurrencies: fxMissing,
      fxStaleCurrencies: [...fxMap.values()].filter((f) => f.stale).map((f) => f.currency_code),
      fallbackDatedLines: kept.filter((l) => l.date_basis === "fallback").length,
      totalLines: kept.length,
      hasForecastBasis: Boolean(input.forecast_version_id ?? forecastVersion?.id),
      basisAgeDays,
      unapprovedAdjustments: (await loadAdjustments(ctx, input.project_id)).filter(
        (a) => a.status === "draft",
      ).length,
      reconciliationBalanced: reconciliation.balanced,
      overdueReceipts: ws.invoices.filter(
        (i) =>
          i.direction === "receivable" &&
          OPEN_INVOICE_STATUSES.has(i.status) &&
          i.due_date != null &&
          i.due_date < dataDate,
      ).length,
      funding,
      covenants,
      facilities,
      concentrationTop: counterpartyTop,
    }),
  );

  return {
    project_id: input.project_id,
    period_month: period,
    data_date: dataDate,
    granularity,
    horizon_buckets: horizon,
    reporting_currency: reporting,
    project_currency: ws.baseCurrency,
    opening_cash: settings.opening_cash,
    lines: kept,
    suppressed,
    buckets,
    measures,
    reconciliation,
    facilities,
    funding,
    covenants,
    maturity: maturityLadder(withRates, facilities, granularity),
    conversion,
    exceptions,
    fx: [...fxMap.values()],
    fx_missing: fxMissing,
    forecast_version_id: input.forecast_version_id ?? forecastVersion?.id ?? null,
    adjustments,
    ready_to_approve: !hasBlocker(exceptions),
  };
}

// ---------------------------------------------------------------------------
// Snapshot lifecycle
// ---------------------------------------------------------------------------
export interface CashflowSnapshotRow {
  id: string;
  company_id: string;
  project_id: string;
  period_month: string;
  data_date: string;
  status: CashflowStatus;
  row_version: number;
  version_no: number;
  bucket_granularity: BucketGranularity;
  horizon_buckets: number;
  reporting_currency: string;
  project_currency: string;
  forecast_version_id: string | null;
  evm_report_id: string | null;
  fx_provenance: Record<string, Json>;
  inclusion_rules: Record<string, Json>;
  opening_cash: number;
  totals: Record<string, Json>;
  quality: Record<string, Json>;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  correction_reason: string | null;
  prepared_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

async function logCashEvent(
  ctx: AuthContext,
  snapshot: { id: string | null; company_id: string; project_id: string },
  entity_type: string,
  entity_id: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sbOf(ctx)
    .from("cashflow_events")
    .insert({
      company_id: snapshot.company_id,
      project_id: snapshot.project_id,
      snapshot_id: snapshot.id,
      entity_type,
      entity_id,
      event_type: String(detail["event"] ?? "updated"),
      from_status: (detail["from_status"] as string | null) ?? null,
      to_status: (detail["to_status"] as string | null) ?? null,
      detail: detail as unknown as Json,
      actor_id: ctx.user?.id ?? null,
    });
  if (error && !isMissingObject(error)) throw error;
}

/** Persist (or refresh) the working snapshot for a period. */
export async function saveCashflowSnapshot(
  ctx: AuthContext,
  input: CashflowCalculateInput,
): Promise<{ snapshot_id: string }> {
  await requireCashflowWrite(ctx);
  const computed = await computeCashflow(ctx, input);
  await assertPeriodOpen(ctx, input.project_id, computed.period_month);
  const project = await loadCostingProject(ctx, input.project_id);

  const existing = await one<CashflowSnapshotRow>(
    sbOf(ctx)
      .from("cashflow_snapshots")
      .select("*")
      .eq("project_id", input.project_id)
      .eq("period_month", computed.period_month)
      .neq("status", "superseded")
      .maybeSingle(),
  );
  if (existing && existing.status !== "working") {
    costingHttpError(
      409,
      CASHFLOW_SNAPSHOT_FROZEN,
      "Withdraw or supersede the snapshot before recalculating.",
    );
  }

  const payload = {
    company_id: project.company_id,
    project_id: input.project_id,
    period_month: computed.period_month,
    data_date: computed.data_date,
    status: "working" as const,
    bucket_granularity: computed.granularity,
    horizon_buckets: computed.horizon_buckets,
    reporting_currency: computed.reporting_currency,
    project_currency: computed.project_currency,
    forecast_version_id: computed.forecast_version_id,
    evm_report_id: input.evm_report_id ?? null,
    opening_cash: computed.opening_cash,
    fx_provenance: { rates: computed.fx, missing: computed.fx_missing } as unknown as Record<
      string,
      Json
    >,
    inclusion_rules: {
      granularity: computed.granularity,
      horizon_buckets: computed.horizon_buckets,
    } as unknown as Record<string, Json>,
    totals: {
      measures: computed.measures,
      funding: computed.funding,
      covenants: computed.covenants,
      conversion: computed.conversion,
      reconciliation: {
        balanced: computed.reconciliation.balanced,
        totals: computed.reconciliation.totals,
        differences: computed.reconciliation.differences,
      },
      buckets: computed.buckets,
    } as unknown as Record<string, Json>,
    quality: {
      blockers: computed.exceptions.filter((e) => e.severity === "blocker").length,
      warnings: computed.exceptions.filter((e) => e.severity === "warning").length,
      ready_to_approve: computed.ready_to_approve,
      suppressed_lines: computed.suppressed.length,
    } as unknown as Record<string, Json>,
    prepared_by: ctx.user?.id ?? null,
    prepared_at: new Date().toISOString(),
    created_by: ctx.user?.id ?? null,
  };

  const saved = existing
    ? await one<CashflowSnapshotRow>(
        sbOf(ctx)
          .from("cashflow_snapshots")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single(),
      )
    : await one<CashflowSnapshotRow>(
        sbOf(ctx).from("cashflow_snapshots").insert(payload).select("*").single(),
      );
  if (!saved) costingHttpError(500, "cashflow_snapshot_save_failed");

  await sbOf(ctx).from("cashflow_snapshot_lines").delete().eq("snapshot_id", saved!.id);
  await sbOf(ctx).from("cashflow_exceptions").delete().eq("snapshot_id", saved!.id);

  if (computed.lines.length > 0) {
    const { error } = await sbOf(ctx)
      .from("cashflow_snapshot_lines")
      .insert(
        computed.lines.map((l, i) => ({
          company_id: project.company_id,
          snapshot_id: saved!.id,
          bucket_start: bucketStartOf(l.date, computed.granularity),
          bucket_end: l.date,
          direction: l.direction,
          source: l.source,
          category: l.category,
          counterparty: l.counterparty,
          cost_code_id: l.cost_code_id,
          amount_native: l.amount_native,
          currency_code: l.currency_code,
          fx_rate: l.fx_rate,
          fx_rate_date: l.fx_rate_date,
          fx_source: l.fx_source,
          fx_stale: l.fx_stale,
          amount_reporting: l.amount_reporting,
          date_basis: l.date_basis,
          reference_type: l.reference_type,
          reference_id: l.reference_id,
          sort_order: i,
        })),
      );
    if (error) throw error;
  }

  if (computed.exceptions.length > 0) {
    await sbOf(ctx)
      .from("cashflow_exceptions")
      .insert(
        computed.exceptions.map((e) => ({
          company_id: project.company_id,
          project_id: input.project_id,
          snapshot_id: saved!.id,
          code: e.code,
          severity: e.severity,
          message: e.message,
          context: {
            ...e.context,
            fingerprint: cashAlertFingerprint({
              projectId: input.project_id,
              period: computed.period_month,
              code: e.code,
            }),
          } as unknown as Json,
        })),
      );
  }

  await logCashEvent(
    ctx,
    { id: saved!.id, company_id: project.company_id, project_id: input.project_id },
    "snapshot",
    saved!.id,
    { event: "calculated", lines: computed.lines.length, period: computed.period_month },
  );
  await costingAudit(ctx, "cashflow.snapshot.calculated", "cashflow_snapshots", saved!.id, {
    project_id: input.project_id,
    period_month: computed.period_month,
    blockers: computed.exceptions.filter((e) => e.severity === "blocker").length,
  });
  return { snapshot_id: saved!.id };
}

export async function transitionCashflowSnapshot(
  ctx: AuthContext,
  input: { snapshot_id: string; to: CashflowStatus; reason?: string; row_version?: number },
): Promise<{ status: CashflowStatus }> {
  await requireCashflowWrite(ctx);
  const snap = await one<CashflowSnapshotRow>(
    sbOf(ctx).from("cashflow_snapshots").select("*").eq("id", input.snapshot_id).maybeSingle(),
  );
  if (!snap) costingHttpError(404, "cashflow_snapshot_not_found");
  if (input.row_version !== undefined && input.row_version !== snap!.row_version) {
    costingHttpError(409, CASHFLOW_VERSION_CONFLICT, "The snapshot changed since it was loaded.");
  }

  const locked = (await periodState(ctx, snap!.project_id, snap!.period_month)) === "hard_closed";
  const blockers = Number((snap!.quality as { blockers?: number })?.blockers ?? 0);
  const check = checkCashTransition(snap!.status, input.to, {
    actorId: ctx.user?.id ?? "",
    preparedBy: snap!.prepared_by,
    submittedBy: snap!.submitted_by,
    periodLocked: locked,
    blockers,
  });
  if (!check.ok) costingHttpError(409, check.reason ?? "cashflow_invalid_transition");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: input.to };
  if (input.to === "submitted") {
    patch["submitted_by"] = ctx.user?.id ?? null;
    patch["submitted_at"] = now;
  }
  if (input.to === "approved") {
    patch["approved_by"] = ctx.user?.id ?? null;
    patch["approved_at"] = now;
  }
  if (input.to === "working") {
    patch["submitted_by"] = null;
    patch["submitted_at"] = null;
  }
  const { error } = await sbOf(ctx)
    .from("cashflow_snapshots")
    .update(patch)
    .eq("id", input.snapshot_id);
  if (error) throw error;

  await logCashEvent(ctx, snap!, "snapshot", snap!.id, {
    event: `status_${input.to}`,
    from_status: snap!.status,
    to_status: input.to,
    reason: input.reason ?? null,
  });
  await costingAudit(ctx, `cashflow.snapshot.${input.to}`, "cashflow_snapshots", snap!.id, {
    project_id: snap!.project_id,
    period_month: snap!.period_month,
    from: snap!.status,
    to: input.to,
  });
  return { status: input.to };
}

/** Corrections never edit an approved snapshot; they open the next version. */
export async function supersedeCashflowSnapshot(
  ctx: AuthContext,
  input: { snapshot_id: string; reason: string },
): Promise<{ snapshot_id: string }> {
  await requireCashflowWrite(ctx);
  const snap = await one<CashflowSnapshotRow>(
    sbOf(ctx).from("cashflow_snapshots").select("*").eq("id", input.snapshot_id).maybeSingle(),
  );
  if (!snap) costingHttpError(404, "cashflow_snapshot_not_found");
  const plan = cashSupersedePlan({
    status: snap!.status,
    version_no: snap!.version_no,
    correction_reason: input.reason,
  });
  if (!plan.ok) costingHttpError(409, plan.reason ?? "cashflow_invalid_transition");

  const { error: supErr } = await sbOf(ctx)
    .from("cashflow_snapshots")
    .update({ status: "superseded", superseded_at: new Date().toISOString() })
    .eq("id", snap!.id);
  if (supErr) throw supErr;

  const created = await one<{ id: string }>(
    sbOf(ctx)
      .from("cashflow_snapshots")
      .insert({
        company_id: snap!.company_id,
        project_id: snap!.project_id,
        period_month: snap!.period_month,
        data_date: snap!.data_date,
        status: "working",
        version_no: plan.nextVersionNo,
        bucket_granularity: snap!.bucket_granularity,
        horizon_buckets: snap!.horizon_buckets,
        reporting_currency: snap!.reporting_currency,
        project_currency: snap!.project_currency,
        opening_cash: snap!.opening_cash,
        supersedes_id: snap!.id,
        correction_reason: input.reason,
        prepared_by: ctx.user?.id ?? null,
        created_by: ctx.user?.id ?? null,
      })
      .select("id")
      .single(),
  );
  if (!created) costingHttpError(500, "cashflow_supersede_failed");

  await sbOf(ctx)
    .from("cashflow_snapshots")
    .update({ superseded_by_id: created!.id })
    .eq("id", snap!.id);

  await logCashEvent(ctx, snap!, "snapshot", snap!.id, {
    event: "superseded",
    from_status: snap!.status,
    to_status: "superseded",
    reason: input.reason,
    next_snapshot_id: created!.id,
  });
  await costingAudit(ctx, "cashflow.snapshot.superseded", "cashflow_snapshots", snap!.id, {
    project_id: snap!.project_id,
    period_month: snap!.period_month,
    reason: input.reason,
  });
  return { snapshot_id: created!.id };
}

// ---------------------------------------------------------------------------
// Governed adjustments
// ---------------------------------------------------------------------------
export async function saveCashflowAdjustment(
  ctx: AuthContext,
  input: CashflowAdjustmentInput,
): Promise<{ id: string }> {
  await requireCashflowWrite(ctx);
  const project = await loadCostingProject(ctx, input.project_id);
  await assertPeriodOpen(ctx, input.project_id, input.effective_period);

  if (input.id) {
    const current = await one<AdjustmentRow>(
      sbOf(ctx).from("cashflow_adjustments").select("*").eq("id", input.id).maybeSingle(),
    );
    if (!current) costingHttpError(404, "cashflow_adjustment_not_found");
    if (current!.status !== "draft") {
      costingHttpError(409, "cashflow_adjustment_frozen", "Authorized adjustments are immutable.");
    }
  }

  const payload = {
    company_id: project.company_id,
    project_id: input.project_id,
    effective_period: input.effective_period,
    bucket_date: input.bucket_date,
    direction: input.direction,
    category: input.category,
    counterparty: input.counterparty ?? null,
    amount: input.amount,
    currency_code: input.currency_code,
    reason: input.reason,
    evidence_reference: input.evidence_reference ?? null,
    prepared_by: ctx.user?.id ?? null,
    created_by: ctx.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  const saved = input.id
    ? await one<AdjustmentRow>(
        sbOf(ctx)
          .from("cashflow_adjustments")
          .update(payload)
          .eq("id", input.id)
          .select("*")
          .single(),
      )
    : await one<AdjustmentRow>(
        sbOf(ctx).from("cashflow_adjustments").insert(payload).select("*").single(),
      );
  if (!saved) costingHttpError(500, "cashflow_adjustment_save_failed");

  await logCashEvent(
    ctx,
    { id: null, company_id: project.company_id, project_id: input.project_id },
    "adjustment",
    saved!.id,
    { event: input.id ? "updated" : "created", amount: input.amount, reason: input.reason },
  );
  await costingAudit(ctx, "cashflow.adjustment.saved", "cashflow_adjustments", saved!.id, {
    project_id: input.project_id,
    amount: input.amount,
  });
  return { id: saved!.id };
}

export async function decideCashflowAdjustment(
  ctx: AuthContext,
  input: { id: string; decision: "authorize" | "void"; reason?: string },
): Promise<{ status: AdjustmentRow["status"] }> {
  await requireCashflowWrite(ctx);
  const current = await one<AdjustmentRow & { company_id: string }>(
    sbOf(ctx).from("cashflow_adjustments").select("*").eq("id", input.id).maybeSingle(),
  );
  if (!current) costingHttpError(404, "cashflow_adjustment_not_found");

  if (input.decision === "authorize") {
    if (current!.status !== "draft") costingHttpError(409, "cashflow_adjustment_frozen");
    if (current!.prepared_by && current!.prepared_by === (ctx.user?.id ?? "")) {
      costingHttpError(409, "cashflow_self_approval", "Another approver must authorize this.");
    }
  } else if (current!.status === "voided") {
    costingHttpError(409, "cashflow_adjustment_frozen");
  }

  const now = new Date().toISOString();
  const patch =
    input.decision === "authorize"
      ? { status: "authorized", authorized_by: ctx.user?.id ?? null, authorized_at: now }
      : { status: "voided", voided_by: ctx.user?.id ?? null, voided_at: now };
  const { error } = await sbOf(ctx).from("cashflow_adjustments").update(patch).eq("id", input.id);
  if (error) throw error;

  await logCashEvent(
    ctx,
    { id: null, company_id: current!.company_id, project_id: current!.project_id },
    "adjustment",
    input.id,
    { event: input.decision, from_status: current!.status, reason: input.reason ?? null },
  );
  await costingAudit(
    ctx,
    `cashflow.adjustment.${input.decision}`,
    "cashflow_adjustments",
    input.id,
    {
      project_id: current!.project_id,
    },
  );
  return { status: input.decision === "authorize" ? "authorized" : "voided" };
}

export async function listCashflowAdjustments(
  ctx: AuthContext,
  projectId: string,
): Promise<AdjustmentRow[]> {
  return loadAdjustments(ctx, projectId);
}

// ---------------------------------------------------------------------------
// Funding facilities and allocations
// ---------------------------------------------------------------------------
export interface FacilityRow extends FundingFacilityInput {
  id: string;
  company_id: string;
  row_version: number;
  created_at: string;
}

export async function listFundingFacilities(ctx: AuthContext): Promise<FacilityRow[]> {
  return rows<FacilityRow>(
    sbOf(ctx).from("funding_facilities").select("*").order("name", { ascending: true }),
  );
}

export async function saveFundingFacility(
  ctx: AuthContext,
  input: FundingFacilityInput,
): Promise<{ id: string }> {
  await requireCashflowWrite(ctx);
  const companyId = await currentCompanyId(ctx);
  const payload = {
    company_id: companyId,
    bank_facility_id: input.bank_facility_id ?? null,
    name: input.name,
    lender_name: input.lender_name ?? null,
    facility_kind: input.facility_kind ?? null,
    committed_amount: input.committed_amount,
    currency_code: input.currency_code,
    available_from: input.available_from ?? null,
    expiry_date: input.expiry_date ?? null,
    drawdown_schedule: (input.drawdown_schedule ?? []) as unknown as Json,
    repayment_schedule: (input.repayment_schedule ?? []) as unknown as Json,
    covenants: (input.covenants ?? []) as unknown as Json,
    status: input.status ?? "planned",
    notes: input.notes ?? null,
    created_by: ctx.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  let saved: { id: string } | null = null;
  if (input.id) {
    // Optimistic concurrency: the caller must echo the row_version it read.
    if (typeof input.row_version !== "number") {
      costingHttpError(
        409,
        "row_version_required",
        "Reload the facility before saving — its version is unknown.",
      );
    }
    const updated = await rows<{ id: string }>(
      sbOf(ctx)
        .from("funding_facilities")
        .update({ ...payload, row_version: input.row_version! + 1 })
        .eq("id", input.id)
        .eq("row_version", input.row_version!)
        .select("id"),
    );
    if (updated.length === 0) {
      costingHttpError(
        409,
        "facility_version_conflict",
        "This facility changed since you loaded it. Reload and reapply your edit.",
      );
    }
    saved = updated[0]!;
  } else {
    saved = await one<{ id: string }>(
      sbOf(ctx).from("funding_facilities").insert(payload).select("id").single(),
    );
  }
  if (!saved) costingHttpError(500, "funding_facility_save_failed");
  await costingAudit(ctx, "cashflow.facility.saved", "funding_facilities", saved!.id, {
    name: input.name,
    mode: input.id ? "update" : "create",
    ...(input.id ? { row_version: input.row_version } : {}),
  });
  return { id: saved!.id };
}

export async function saveFundingAllocation(
  ctx: AuthContext,
  input: FundingAllocationInput,
): Promise<{ id: string }> {
  await requireCashflowWrite(ctx);
  const project = await loadCostingProject(ctx, input.project_id);
  const payload = {
    company_id: project.company_id,
    facility_id: input.facility_id,
    project_id: input.project_id,
    allocated_amount: input.allocated_amount,
    currency_code: input.currency_code,
    effective_from: input.effective_from ?? null,
    effective_to: input.effective_to ?? null,
    notes: input.notes ?? null,
    created_by: ctx.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  const saved = input.id
    ? await one<{ id: string }>(
        sbOf(ctx)
          .from("funding_allocations")
          .update(payload)
          .eq("id", input.id)
          .select("id")
          .single(),
      )
    : await one<{ id: string }>(
        sbOf(ctx).from("funding_allocations").insert(payload).select("id").single(),
      );
  if (!saved) costingHttpError(500, "funding_allocation_save_failed");
  await costingAudit(ctx, "cashflow.allocation.saved", "funding_allocations", saved!.id, {
    project_id: input.project_id,
    facility_id: input.facility_id,
  });
  return { id: saved!.id };
}

export async function deleteFundingAllocation(ctx: AuthContext, id: string): Promise<void> {
  await requireCashflowWrite(ctx);
  const { error } = await sbOf(ctx).from("funding_allocations").delete().eq("id", id);
  if (error) throw error;
  await costingAudit(ctx, "cashflow.allocation.deleted", "funding_allocations", id, {});
}

// --- Funding management workspace (facilities + allocations + audit trail) ---
export interface AllocationRow {
  id: string;
  facility_id: string;
  project_id: string;
  allocated_amount: number;
  currency_code: string;
  effective_from: string | null;
  effective_to: string | null;
  notes: string | null;
  updated_at: string | null;
}

export interface FundingAuditRow {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, string | number | boolean | null> | null;
}

export interface FundingWorkspace {
  facilities: FacilityRow[];
  allocations: AllocationRow[];
  projects: { id: string; name: string; code: string }[];
  audit: FundingAuditRow[];
  access: { canWrite: boolean };
}

export async function loadFundingWorkspace(ctx: AuthContext): Promise<FundingWorkspace> {
  const canWrite = await hasAnyCostingRole(ctx, COSTING_WRITE_ROLES);
  const [facilities, allocations, projects, audit] = await Promise.all([
    listFundingFacilities(ctx),
    rows<AllocationRow>(
      sbOf(ctx)
        .from("funding_allocations")
        .select(
          "id, facility_id, project_id, allocated_amount, currency_code, effective_from, effective_to, notes, updated_at",
        )
        .order("updated_at", { ascending: false }),
    ),
    rows<{ id: string; name: string; code: string }>(
      sbOf(ctx).from("projects").select("id, name, code").order("name", { ascending: true }),
    ),
    rows<FundingAuditRow>(
      sbOf(ctx)
        .from("audit_logs")
        .select("id, action, entity, entity_id, created_at, metadata")
        .in("entity", ["funding_facilities", "funding_allocations"])
        .order("created_at", { ascending: false })
        .limit(50),
    ),
  ]);
  return { facilities, allocations, projects, audit, access: { canWrite } };
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const row = await one<{ company_id: string }>(
    sbOf(ctx)
      .from("profiles")
      .select("company_id")
      .eq("id", ctx.user?.id ?? "")
      .maybeSingle(),
  );
  if (!row?.company_id) costingHttpError(403, "no_company_context");
  return row!.company_id;
}

// ---------------------------------------------------------------------------
// Workspace (project dashboard payload)
// ---------------------------------------------------------------------------
export interface CashflowWorkspaceData {
  project: { id: string; name: string; code: string };
  settings: CashflowSettings;
  snapshot: CashflowSnapshotRow | null;
  history: Pick<
    CashflowSnapshotRow,
    "id" | "period_month" | "status" | "version_no" | "approved_at" | "correction_reason"
  >[];
  computed: CashflowComputed;
  frozen: boolean;
  period_state: string;
}

/**
 * Approved snapshots are replayed from stored lines and stored provenance —
 * they are never recalculated and never re-rated.
 */
export async function loadCashflowWorkspace(
  ctx: AuthContext,
  input: { project_id: string; period?: string; granularity?: BucketGranularity },
): Promise<CashflowWorkspaceData> {
  const project = await loadCostingProject(ctx, input.project_id);
  const settings = await loadCashflowSettings(ctx, input.project_id);
  const period = input.period ?? currentReportingPeriod(CASH_TZ);

  const snapshot = await one<CashflowSnapshotRow>(
    sbOf(ctx)
      .from("cashflow_snapshots")
      .select("*")
      .eq("project_id", input.project_id)
      .eq("period_month", period)
      .neq("status", "superseded")
      .maybeSingle(),
  );
  const history = await rows<CashflowSnapshotRow>(
    sbOf(ctx)
      .from("cashflow_snapshots")
      .select("id, period_month, status, version_no, approved_at, correction_reason")
      .eq("project_id", input.project_id)
      .order("period_month", { ascending: false })
      .limit(24),
  );

  const frozen = snapshot != null && snapshot.status !== "working";
  const computed = frozen
    ? await replayFrozenSnapshot(ctx, snapshot!, settings)
    : await computeCashflow(ctx, {
        project_id: input.project_id,
        period,
        granularity: input.granularity ?? settings.bucket_granularity,
      });

  return {
    project: { id: project.id, name: project.name, code: project.code },
    settings,
    snapshot,
    history,
    computed,
    frozen,
    period_state: await periodState(ctx, input.project_id, period),
  };
}

/** Replay a frozen snapshot from its own stored rows — no recomputation. */
async function replayFrozenSnapshot(
  ctx: AuthContext,
  snap: CashflowSnapshotRow,
  settings: CashflowSettings,
): Promise<CashflowComputed> {
  const storedLines = await rows<Record<string, unknown>>(
    sbOf(ctx)
      .from("cashflow_snapshot_lines")
      .select("*")
      .eq("snapshot_id", snap.id)
      .order("sort_order", { ascending: true }),
  );
  const lines: CashLine[] = storedLines.map((r) => ({
    key: String(r["id"]),
    direction: r["direction"] as CashLine["direction"],
    source: r["source"] as CashLine["source"],
    category: String(r["category"] ?? ""),
    counterparty: (r["counterparty"] as string | null) ?? null,
    cost_code_id: (r["cost_code_id"] as string | null) ?? null,
    date: String(r["bucket_end"] ?? r["bucket_start"]),
    date_basis: r["date_basis"] as CashLine["date_basis"],
    amount_native: Number(r["amount_native"] ?? 0),
    currency_code: String(r["currency_code"] ?? ""),
    fx_rate: r["fx_rate"] == null ? null : Number(r["fx_rate"]),
    fx_rate_date: (r["fx_rate_date"] as string | null) ?? null,
    fx_source: (r["fx_source"] as string | null) ?? null,
    fx_stale: Boolean(r["fx_stale"]),
    amount_reporting: Number(r["amount_reporting"] ?? 0),
    reference_type: (r["reference_type"] as string | null) ?? null,
    reference_id: (r["reference_id"] as string | null) ?? null,
    suppression_key: null,
  }));

  const buckets = buildBuckets(lines, {
    granularity: snap.bucket_granularity,
    from: snap.period_month,
    count: snap.horizon_buckets,
    openingCash: Number(snap.opening_cash ?? 0),
  });
  const measures = computeLiquidity(buckets, Number(snap.opening_cash ?? 0));
  const reconciliation = reconcileCashflow(lines, snap.bucket_granularity);

  const { models } = await loadFacilityModels(ctx, snap.company_id, snap.project_id);
  const fxProv = (snap.fx_provenance as unknown as { rates?: CashFxEntry[] })?.rates ?? [];
  const rateOf = (code: string) =>
    fxProv.find((f) => f.currency_code === code.toUpperCase())?.rate ?? null;
  const withRates = models.map((m) => ({ ...m, fx_rate: rateOf(m.currency_code) }));
  const facilities = withRates.map((m) => facilityState(m, snap.data_date));
  const funding = fundingPosition(
    measures.peak_funding_need,
    facilities,
    settings.min_liquidity_amount,
  );
  const exceptions = (
    await rows<{ code: string; severity: string; message: string; context: Json }>(
      sbOf(ctx)
        .from("cashflow_exceptions")
        .select("code, severity, message, context")
        .eq("snapshot_id", snap.id),
    )
  ).map((e) => ({
    code: e.code as CashflowException["code"],
    severity: e.severity as CashflowException["severity"],
    message: e.message,
    context: (e.context ?? {}) as Record<string, import("@/lib/cashflow.rules").CashJsonValue>,
  }));

  return {
    project_id: snap.project_id,
    period_month: snap.period_month,
    data_date: snap.data_date,
    granularity: snap.bucket_granularity,
    horizon_buckets: snap.horizon_buckets,
    reporting_currency: snap.reporting_currency,
    project_currency: snap.project_currency,
    opening_cash: Number(snap.opening_cash ?? 0),
    lines,
    suppressed: [],
    buckets,
    measures,
    reconciliation,
    facilities,
    funding,
    covenants: checkCovenants(withRates, {
      liquidity: measures.closing_cash,
      headroom: funding.headroom,
      peak_funding_need: measures.peak_funding_need,
      minimum_liquidity: measures.minimum_liquidity,
    }),
    maturity: maturityLadder(withRates, facilities, snap.bucket_granularity),
    conversion: { payables_lag: 0, receivables_lag: 0, conversion_pct: null },
    exceptions,
    fx: fxProv,
    fx_missing:
      (snap.fx_provenance as unknown as { missing?: string[] })?.missing ?? ([] as string[]),
    forecast_version_id: snap.forecast_version_id,
    adjustments: [],
    ready_to_approve:
      (snap.quality as unknown as { ready_to_approve?: boolean })?.ready_to_approve !== false,
  };
}

// ---------------------------------------------------------------------------
// Scenarios (non-posting overlay)
// ---------------------------------------------------------------------------
export interface CashScenarioResult {
  basis: { buckets: CashBucket[]; measures: LiquidityMeasures; funding: FundingPosition };
  scenario: { buckets: CashBucket[]; measures: LiquidityMeasures; funding: FundingPosition };
  comparison: ReturnType<typeof compareScenario>;
}

/** Overlay only — nothing is written and the approved snapshot is untouched. */
export async function runCashScenario(
  ctx: AuthContext,
  input: CashScenarioInput,
): Promise<CashScenarioResult> {
  const ws = await loadCashflowWorkspace(ctx, {
    project_id: input.project_id,
    period: input.period,
  });
  const c = ws.computed;
  const scenarioLines = applyCashScenario(c.lines, input);
  const opts = {
    granularity: c.granularity,
    from: c.period_month,
    count: c.horizon_buckets,
    openingCash: c.opening_cash,
  };
  const scenarioBuckets = buildBuckets(scenarioLines, opts);
  const scenarioMeasures = computeLiquidity(scenarioBuckets, c.opening_cash);
  const facilityShift = 1 + (input.facility_change_pct ?? 0) / 100;
  const shiftedFacilities: FacilityState[] = c.facilities.map((f) => ({
    ...f,
    headroom_reporting: fromMinor(Math.round(toMinor(f.headroom_reporting) * facilityShift)),
  }));
  const scenarioFunding = fundingPosition(
    scenarioMeasures.peak_funding_need,
    shiftedFacilities,
    ws.settings.min_liquidity_amount,
  );

  return {
    basis: { buckets: c.buckets, measures: c.measures, funding: c.funding },
    scenario: {
      buckets: scenarioBuckets,
      measures: scenarioMeasures,
      funding: scenarioFunding,
    },
    comparison: compareScenario(
      { measures: c.measures, funding: c.funding },
      { measures: scenarioMeasures, funding: scenarioFunding },
    ),
  };
}

// ---------------------------------------------------------------------------
// Portfolio consolidation
// ---------------------------------------------------------------------------
export interface PortfolioCashData {
  period: string;
  reporting_currency: string;
  rows: PortfolioCashRow[];
  totals: PortfolioCashTotals;
  facilities: FacilityState[];
  maturity: ReturnType<typeof maturityLadder>;
  alerts: { project_id: string; code: string; severity: string; message: string }[];
}

export async function loadPortfolioCashflow(
  ctx: AuthContext,
  filter: PortfolioCashFilter,
): Promise<PortfolioCashData> {
  const period = filter.period ?? currentReportingPeriod(CASH_TZ);
  const projects = await rows<{ id: string; code: string; name: string; company_id: string }>(
    sbOf(ctx).from("projects").select("id, code, name, company_id"),
  );
  const scoped = filter.project_ids?.length
    ? projects.filter((p) => filter.project_ids?.includes(p.id))
    : projects;
  if (scoped.length === 0) {
    return {
      period,
      reporting_currency: filter.currency ?? "USD",
      rows: [],
      totals: consolidatePortfolio([]),
      facilities: [],
      maturity: [],
      alerts: [],
    };
  }

  const snapshots = await rows<CashflowSnapshotRow>(
    sbOf(ctx)
      .from("cashflow_snapshots")
      .select("*")
      .eq("period_month", period)
      .neq("status", "superseded")
      .in(
        "project_id",
        scoped.map((p) => p.id),
      ),
  );
  const byProject = new Map(snapshots.map((s) => [s.project_id, s]));
  const reporting = (filter.currency ?? snapshots[0]?.reporting_currency ?? "USD").toUpperCase();

  const out: PortfolioCashRow[] = [];
  const alerts: PortfolioCashData["alerts"] = [];
  for (const p of scoped) {
    const snap = byProject.get(p.id);
    if (!snap || (filter.only_approved && snap.status !== "approved")) {
      out.push({
        project_id: p.id,
        project_code: p.code,
        project_name: p.name,
        status: snap?.status ?? null,
        basis: "none",
        reporting_currency: reporting,
        project_currency: snap?.project_currency ?? reporting,
        fx_rate: null,
        fx_missing: true,
        buckets: [],
        measures: computeLiquidity([], 0),
        funding: fundingPosition(0, []),
      });
      continue;
    }
    const totals = snap.totals as unknown as {
      measures?: LiquidityMeasures;
      funding?: FundingPosition;
      buckets?: CashBucket[];
    };
    const sameCurrency = snap.reporting_currency.toUpperCase() === reporting;
    const rate = sameCurrency
      ? 1
      : (((snap.fx_provenance as unknown as { rates?: CashFxEntry[] })?.rates ?? []).find(
          (f) => f.currency_code === reporting,
        )?.rate ?? null);
    out.push({
      project_id: p.id,
      project_code: p.code,
      project_name: p.name,
      status: snap.status,
      basis: snap.status === "approved" ? "approved" : "indicative",
      reporting_currency: reporting,
      project_currency: snap.project_currency,
      fx_rate: rate,
      fx_missing: rate == null,
      buckets: totals?.buckets ?? [],
      measures: totals?.measures ?? computeLiquidity([], 0),
      funding: totals?.funding ?? fundingPosition(0, []),
    });

    const snapAlerts = await rows<{ code: string; severity: string; message: string }>(
      sbOf(ctx)
        .from("cashflow_exceptions")
        .select("code, severity, message")
        .eq("snapshot_id", snap.id),
    );
    for (const a of snapAlerts)
      alerts.push({ project_id: p.id, code: a.code, severity: a.severity, message: a.message });
  }

  const companyId = scoped[0]!.company_id;
  const { models } = await loadFacilityModels(ctx, companyId, null);
  const asOf = addDays(period, 0);
  const facilities = models
    .map((m) => ({ ...m, fx_rate: m.currency_code === reporting ? 1 : null }))
    .map((m) => facilityState(m, asOf));

  return {
    period,
    reporting_currency: reporting,
    rows: out,
    totals: consolidatePortfolio(out),
    facilities,
    maturity: maturityLadder(models, facilities, "month"),
    alerts,
  };
}

// ---------------------------------------------------------------------------
// Exports: CSV and management-pack appendix
// ---------------------------------------------------------------------------
function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csv(header: readonly string[], body: readonly unknown[][]): string {
  return [header.join(","), ...body.map((r) => r.map(esc).join(","))].join("\n") + "\n";
}

export async function loadCashflowCsv(
  ctx: AuthContext,
  input: CashflowCsvInput,
): Promise<{ filename: string; csv: string }> {
  const ws = await loadCashflowWorkspace(ctx, {
    project_id: input.project_id,
    period: input.period,
  });
  const c = ws.computed;
  const base = `cashflow-${ws.project.code}-${c.period_month}`;
  switch (input.kind) {
    case "buckets":
      return {
        filename: `${base}-buckets.csv`,
        csv: csv(
          ["bucket_start", "bucket_end", "inflow", "outflow", "net", "cumulative", "closing_cash"],
          c.buckets.map((b) => [
            b.start,
            b.end,
            b.inflow.toFixed(2),
            b.outflow.toFixed(2),
            b.net.toFixed(2),
            b.cumulative.toFixed(2),
            b.closing_cash.toFixed(2),
          ]),
        ),
      };
    case "lines":
      return {
        filename: `${base}-lines.csv`,
        csv: csv(
          [
            "date",
            "date_basis",
            "direction",
            "source",
            "category",
            "counterparty",
            "currency",
            "amount_native",
            "fx_rate",
            "amount_reporting",
          ],
          c.lines.map((l) => [
            l.date,
            l.date_basis,
            l.direction,
            l.source,
            l.category,
            l.counterparty ?? "",
            l.currency_code,
            l.amount_native.toFixed(2),
            l.fx_rate ?? "",
            l.amount_reporting.toFixed(2),
          ]),
        ),
      };
    case "reconciliation":
      return {
        filename: `${base}-reconciliation.csv`,
        csv: csv(
          ["dimension", "key", "inflow", "outflow", "net"],
          c.reconciliation.rows.map((r) => [
            r.dimension,
            r.key,
            r.inflow.toFixed(2),
            r.outflow.toFixed(2),
            r.net.toFixed(2),
          ]),
        ),
      };
    case "facilities":
      return {
        filename: `${base}-facilities.csv`,
        csv: csv(
          [
            "facility",
            "currency",
            "committed",
            "allocated",
            "outstanding",
            "headroom",
            "utilization_pct",
            "expires_in_days",
          ],
          c.facilities.map((f) => [
            f.name,
            f.currency_code,
            f.committed_reporting.toFixed(2),
            f.allocated_reporting.toFixed(2),
            f.outstanding_reporting.toFixed(2),
            f.headroom_reporting.toFixed(2),
            f.utilization_pct ?? "",
            f.expires_in_days ?? "",
          ]),
        ),
      };
    default:
      return {
        filename: `${base}-exceptions.csv`,
        csv: csv(
          ["code", "severity", "message"],
          c.exceptions.map((e) => [e.code, e.severity, e.message]),
        ),
      };
  }
}

export interface CashflowAppendix {
  project_code: string;
  project_name: string;
  period: string;
  status: CashflowStatus | null;
  /** Governance basis of every figure in this appendix. */
  basis: "approved" | "indicative";
  version_no: number | null;
  frozen: boolean;
  period_state: string;
  approvals: {
    prepared_by: string | null;
    submitted_by: string | null;
    approved_by: string | null;
    approved_at: string | null;
    correction_reason: string | null;
  };
  provenance: {
    data_date: string;
    granularity: string;
    horizon_buckets: number;
    forecast_version_id: string | null;
    source_precedence: string[];
    line_counts: Record<string, number>;
    suppressed_lines: number;
    fx_entries: number;
    fx_missing: string[];
    fx_stale: boolean;
  };
  reconciliation: ReconciliationResult;
  /** No scenario overlay is ever applied to a pack appendix. */
  scenario_watermark: "governed-basis-no-scenario-overlay";
  reporting_currency: string;
  measures: LiquidityMeasures;
  funding: FundingPosition;
  buckets: CashBucket[];
  facilities: FacilityState[];
  covenants: CovenantCheck[];
  exceptions: CashflowException[];
  fx: CashFxEntry[];
  reconciled: boolean;
}

/** Close-pack / management-pack appendix for the cash-flow section. */
export async function loadCashflowAppendix(
  ctx: AuthContext,
  input: { project_id: string; period?: string },
): Promise<CashflowAppendix> {
  const ws = await loadCashflowWorkspace(ctx, input);
  const c = ws.computed;
  const counts: Record<string, number> = {};
  for (const l of c.lines) counts[l.source] = (counts[l.source] ?? 0) + 1;
  return {
    project_code: ws.project.code,
    project_name: ws.project.name,
    period: c.period_month,
    status: ws.snapshot?.status ?? null,
    basis: ws.snapshot?.status === "approved" ? "approved" : "indicative",
    version_no: ws.snapshot?.version_no ?? null,
    frozen: ws.frozen,
    period_state: ws.period_state,
    approvals: {
      prepared_by: ws.snapshot?.prepared_by ?? null,
      submitted_by: ws.snapshot?.submitted_by ?? null,
      approved_by: ws.snapshot?.approved_by ?? null,
      approved_at: ws.snapshot?.approved_at ?? null,
      correction_reason: ws.snapshot?.correction_reason ?? null,
    },
    provenance: {
      data_date: c.data_date,
      granularity: c.granularity,
      horizon_buckets: c.horizon_buckets,
      forecast_version_id: c.forecast_version_id,
      source_precedence: Object.entries(SOURCE_PRECEDENCE)
        .sort((a, b) => a[1] - b[1])
        .map(([k]) => k),
      line_counts: counts,
      suppressed_lines: c.suppressed.length,
      fx_entries: c.fx.length,
      fx_missing: c.fx_missing,
      fx_stale: c.fx.some((f) => f.stale),
    },
    reconciliation: c.reconciliation,
    scenario_watermark: "governed-basis-no-scenario-overlay",
    reporting_currency: c.reporting_currency,
    measures: c.measures,
    funding: c.funding,
    buckets: c.buckets,
    facilities: c.facilities,
    covenants: c.covenants,
    exceptions: c.exceptions,
    fx: c.fx,
    reconciled: c.reconciliation.balanced,
  };
}

export async function loadPortfolioCashflowAppendix(
  ctx: AuthContext,
  filter: PortfolioCashFilter,
): Promise<PortfolioCashData> {
  return loadPortfolioCashflow(ctx, filter);
}
