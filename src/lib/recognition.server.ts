// GC-15 — Governed revenue / WIP / PoC recognition I/O layer.
//
// NON-POSTING by construction: this module only ever writes to the
// recognition_* tables. It READS contracts, change orders, invoices,
// payments, approved forecasts and approved EVM reports and never updates
// them. Every write is guarded by role, period lock, optimistic concurrency
// and lifecycle rules, and emits an append-only recognition_events row.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { resolveCostingFx } from "@/lib/costing.server";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";
import {
  applySensitivity,
  approvalBlockers,
  canTransition,
  computeLine,
  DEFAULT_POLICY,
  deriveExceptions,
  evaluateRecognitionAlerts,
  isFrozen,
  reconcile,
  RECOGNITION_DISCLAIMER,
  rollupLines,
  rollupPortfolio,
  concentrationBy,
  violatesSegregation,
  type AdjustmentDecisionInput,
  type ObligationInput,
  type ObligationWriteInput,
  type PortfolioProjectInput,
  type RecognitionAdjustmentInput,
  type RecognitionAlert,
  type RecognitionException,
  type RecognitionLine,
  type RecognitionMethod,
  type RecognitionPolicy,
  type RecognitionSettingsInput,
  type RecognitionStatus,
  type RecognitionTotals,
  type ReconciliationCheck,
  type JsonRecord,
  type SensitivityQueryInput,
  type SnapshotBuildInput,
  type SnapshotCorrectionInput,
  type SnapshotTransitionInput,
  type PortfolioRecognitionQuery,
} from "@/lib/recognition.rules";

export { RECOGNITION_DISCLAIMER };

export const RECOGNITION_WRITE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;
export const RECOGNITION_APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

export interface RecognitionAccess {
  canWrite: boolean;
  canApprove: boolean;
}

export async function resolveRecognitionAccess(ctx: AuthContext): Promise<RecognitionAccess> {
  const [canWrite, canApprove] = await Promise.all([
    hasAnyRole(ctx, RECOGNITION_WRITE_ROLES),
    hasAnyRole(ctx, RECOGNITION_APPROVE_ROLES),
  ]);
  return { canWrite, canApprove };
}

async function requireWrite(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, RECOGNITION_WRITE_ROLES)))
    httpError(403, "forbidden", "Project controls or finance role required.");
}

async function requireApprove(ctx: AuthContext): Promise<void> {
  if (!(await hasAnyRole(ctx, RECOGNITION_APPROVE_ROLES)))
    httpError(403, "forbidden", "Finance or company admin role required.");
}

/** Degrade gracefully when an optional source table is absent. */
async function safeRows<T>(
  run: () => Promise<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await run();
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200") return [];
    throw error;
  }
  return data ?? [];
}

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

async function projectContext(
  ctx: AuthContext,
  projectId: string,
): Promise<{ company_id: string; name: string; currency: string }> {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found", "Project not found in your company.");
  const row = data as unknown as { company_id: string; name: string };
  // Project reporting currency lives on the financial config, not on projects.
  const cfg = await safeRows<{ currency_code: string | null }>(() =>
    (ctx.supabase as any)
      .from("project_financial_config")
      .select("currency_code")
      .eq("project_id", projectId),
  );
  return {
    company_id: row.company_id,
    name: row.name,
    currency: (cfg[0]?.currency_code ?? "USD").toUpperCase(),
  };
}

async function logEvent(
  ctx: AuthContext,
  row: {
    company_id: string;
    project_id?: string | null;
    snapshot_id?: string | null;
    entity_type: string;
    entity_id?: string | null;
    event_type: string;
    from_status?: string | null;
    to_status?: string | null;
    detail?: JsonRecord;
  },
): Promise<void> {
  const { error } = await (ctx.supabase as any).from("recognition_events").insert({
    ...row,
    detail: row.detail ?? {},
    actor_id: ctx.user?.id ?? null,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Settings and obligations
// ---------------------------------------------------------------------------
export interface RecognitionSettingsRow extends RecognitionSettingsInput {
  id: string;
}

export async function loadSettings(
  ctx: AuthContext,
  projectId: string,
): Promise<RecognitionSettingsRow | null> {
  const rows = await safeRows<Record<string, unknown>>(() =>
    (ctx.supabase as any).from("recognition_settings").select("*").eq("project_id", projectId),
  );
  return (rows[0] as unknown as RecognitionSettingsRow | undefined) ?? null;
}

export function policyFrom(
  settings: RecognitionSettingsRow | null,
  fallbackMethod: RecognitionMethod = "cost_to_cost",
): RecognitionPolicy {
  if (!settings) return { ...DEFAULT_POLICY, default_method: fallbackMethod };
  return {
    default_method: settings.default_method ?? fallbackMethod,
    policy_version: settings.policy_version ?? "v1",
    constraint_pct: n(settings.constraint_pct),
    include_unapproved_variations: Boolean(settings.include_unapproved_variations),
    include_unapproved_claims: Boolean(settings.include_unapproved_claims),
    loss_provision_enabled: settings.loss_provision_enabled !== false,
    cap_progress_at_100: settings.cap_progress_at_100 !== false,
    allow_revenue_reversal: Boolean(settings.allow_revenue_reversal),
  };
}

export async function saveSettings(
  ctx: AuthContext,
  input: RecognitionSettingsInput,
): Promise<{ id: string }> {
  await requireWrite(ctx);
  const { company_id } = await projectContext(ctx, input.project_id);
  const { data, error } = await (ctx.supabase as any)
    .from("recognition_settings")
    .upsert(
      {
        ...input,
        company_id,
        created_by: ctx.user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "project_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id,
    project_id: input.project_id,
    entity_type: "settings",
    entity_id: data.id,
    event_type: "settings_saved",
    detail: { policy_version: input.policy_version, default_method: input.default_method },
  });
  await audit(ctx, "recognition_settings", data.id, "update", { project_id: input.project_id });
  return { id: data.id as string };
}

export interface ObligationRow extends ObligationWriteInput {
  id: string;
  company_id: string;
  version_no: number;
  row_version: number;
}

export async function listObligations(
  ctx: AuthContext,
  projectId: string,
): Promise<ObligationRow[]> {
  return (await safeRows<ObligationRow>(() =>
    (ctx.supabase as any)
      .from("recognition_obligations")
      .select("*")
      .eq("project_id", projectId)
      .order("code", { ascending: true }),
  )) as ObligationRow[];
}

export async function saveObligation(
  ctx: AuthContext,
  input: ObligationWriteInput,
): Promise<{ id: string }> {
  await requireWrite(ctx);
  const { company_id } = await projectContext(ctx, input.project_id);
  const payload = { ...input, company_id, updated_at: new Date().toISOString() };

  if (input.id) {
    if (!input.row_version)
      httpError(400, "row_version_required", "Concurrency token is required for updates.");
    const { data, error } = await (ctx.supabase as any)
      .from("recognition_obligations")
      .update({ ...payload, row_version: input.row_version + 1 })
      .eq("id", input.id)
      .eq("row_version", input.row_version)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      httpError(409, "version_conflict", "This obligation changed elsewhere. Reload and retry.");
    await logEvent(ctx, {
      company_id,
      project_id: input.project_id,
      entity_type: "obligation",
      entity_id: input.id,
      event_type: "obligation_updated",
      detail: { code: input.code },
    });
    await audit(ctx, "recognition_obligations", input.id, "update", { code: input.code });
    return { id: input.id };
  }

  const { data, error } = await (ctx.supabase as any)
    .from("recognition_obligations")
    .insert({ ...payload, created_by: ctx.user?.id ?? null })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id,
    project_id: input.project_id,
    entity_type: "obligation",
    entity_id: data.id,
    event_type: "obligation_created",
    detail: { code: input.code },
  });
  await audit(ctx, "recognition_obligations", data.id, "insert", { code: input.code });
  return { id: data.id as string };
}

// ---------------------------------------------------------------------------
// Authoritative basis gathering
// ---------------------------------------------------------------------------
interface BasisBundle {
  company_id: string;
  project_name: string;
  project_currency: string;
  contracts: {
    id: string;
    contract_number: string;
    counterparty: string | null;
    status: string;
    value: number;
    currency_code: string;
  }[];
  approvedVariations: Map<string, number>;
  unapprovedVariations: Map<string, number>;
  billed: Map<string, number>;
  cash: Map<string, number>;
  costIncurred: number;
  costToComplete: number;
  evmProgress: number | null;
  forecastVersionId: string | null;
  evmReportId: string | null;
  adjustments: { obligation_id: string | null; kind: string; amount: number }[];
}

const OPEN_CONTRACTS = ["signed", "active"];
const BILLED_STATUSES = ["issued", "sent", "approved", "partially_paid", "paid", "overdue"];

async function gatherBasis(
  ctx: AuthContext,
  projectId: string,
  periodMonth: string,
  billingCutoff: string,
): Promise<BasisBundle> {
  const p = await projectContext(ctx, projectId);

  const contracts = (await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("contracts")
      .select("id, contract_number, counterparty, status, value, currency_code")
      .eq("project_id", projectId)
      .in("status", OPEN_CONTRACTS),
  )) as BasisBundle["contracts"];

  const cos = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("change_orders")
      .select("contract_id, status, amount")
      .eq("project_id", projectId),
  );
  const approvedVariations = new Map<string, number>();
  const unapprovedVariations = new Map<string, number>();
  for (const c of cos) {
    const key = (c.contract_id as string) ?? "";
    const target = c.status === "approved" ? approvedVariations : unapprovedVariations;
    if (c.status === "rejected" || c.status === "cancelled") continue;
    target.set(key, n(target.get(key)) + n(c.amount));
  }

  const invoices = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("invoices")
      .select("id, contract_id, direction, status, amount, issue_date")
      .eq("project_id", projectId)
      .eq("direction", "receivable")
      .lte("issue_date", billingCutoff),
  );
  const billed = new Map<string, number>();
  const invoiceContract = new Map<string, string>();
  for (const i of invoices) {
    if (!BILLED_STATUSES.includes(i.status as string)) continue;
    const key = (i.contract_id as string) ?? "";
    billed.set(key, n(billed.get(key)) + n(i.amount));
    invoiceContract.set(i.id as string, key);
  }

  const payments = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("payments")
      .select("invoice_id, record_status, amount, payment_date")
      .eq("project_id", projectId)
      .lte("payment_date", billingCutoff),
  );
  const cash = new Map<string, number>();
  for (const pay of payments) {
    if (pay.record_status === "voided") continue;
    const key = invoiceContract.get(pay.invoice_id as string);
    if (key === undefined) continue;
    cash.set(key, n(cash.get(key)) + n(pay.amount));
  }

  // Approved cost basis: latest approved forecast version, then approved EVM.
  const forecasts = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("forecast_versions")
      .select("id, status, totals, reporting_period")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .order("reporting_period", { ascending: false })
      .limit(1),
  );
  const evm = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("evm_reports")
      .select("id, status, totals, period_month")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .lte("period_month", periodMonth)
      .order("period_month", { ascending: false })
      .limit(1),
  );

  const fTotals = (forecasts[0]?.totals ?? {}) as Record<string, unknown>;
  const eTotals = (evm[0]?.totals ?? {}) as Record<string, unknown>;
  const costIncurred = n(eTotals.ac ?? eTotals.actual_cost ?? fTotals.actual ?? fTotals.actuals);
  const eac = n(eTotals.eac ?? fTotals.eac ?? fTotals.forecast_total);
  const costToComplete = Math.max(0, eac - costIncurred);
  const evmProgressRaw = n(eTotals.ev) && n(eTotals.bac) ? n(eTotals.ev) / n(eTotals.bac) : null;

  const adjustments = (await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_adjustments")
      .select("obligation_id, kind, amount, status, effective_period")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .lte("effective_period", periodMonth),
  )) as BasisBundle["adjustments"];

  return {
    company_id: p.company_id,
    project_name: p.name,
    project_currency: p.currency,
    contracts,
    approvedVariations,
    unapprovedVariations,
    billed,
    cash,
    costIncurred,
    costToComplete,
    evmProgress: evmProgressRaw,
    forecastVersionId: (forecasts[0]?.id as string) ?? null,
    evmReportId: (evm[0]?.id as string) ?? null,
    adjustments,
  };
}

/**
 * Build the engine inputs. Obligations declared in recognition_obligations win;
 * otherwise one implicit obligation per open contract is derived so a project
 * with no obligation modelling still reconciles to contract value exactly once.
 */
async function buildObligationInputs(
  ctx: AuthContext,
  projectId: string,
  basis: BasisBundle,
  settings: RecognitionSettingsRow | null,
  reportingCurrency: string,
  dataDate: string,
  priorRevenue: Map<string, number>,
): Promise<ObligationInput[]> {
  const declared = await listObligations(ctx, projectId);
  const active = declared.filter((o) => o.status !== "closed");

  const share = (map: Map<string, number>, contractId: string | null, weight: number): number =>
    n(map.get(contractId ?? "")) * weight;

  const rows: ObligationInput[] = [];

  const fxFor = async (
    currency: string,
  ): Promise<{
    rate: number | null;
    date: string | null;
    source: string | null;
    stale: boolean;
  }> => {
    const res = await resolveCostingFx(ctx, projectId, currency, dataDate);
    return {
      rate: res.fx_rate,
      date: res.fx_rate_date,
      source: res.fx_source,
      stale: res.stale,
    };
  };

  const adjFor = (obligationId: string | null): { kind: any; amount: number }[] =>
    basis.adjustments
      .filter((a) => a.obligation_id === obligationId)
      .map((a) => ({ kind: a.kind as any, amount: n(a.amount) }));

  if (active.length > 0) {
    // Weight cost + billing by allocation share within each contract.
    const allocByContract = new Map<string, number>();
    for (const o of active)
      allocByContract.set(
        o.contract_id ?? "",
        n(allocByContract.get(o.contract_id ?? "")) + n(o.allocation_amount),
      );
    const totalAlloc = active.reduce((a, o) => a + n(o.allocation_amount), 0);

    for (const o of active) {
      const contractTotal = n(allocByContract.get(o.contract_id ?? ""));
      const weight = contractTotal > 0 ? n(o.allocation_amount) / contractTotal : 0;
      const costWeight = totalAlloc > 0 ? n(o.allocation_amount) / totalAlloc : 0;
      const fx = await fxFor(o.currency_code);
      rows.push({
        id: o.id,
        code: o.code,
        label: o.name,
        contract_id: o.contract_id ?? null,
        currency_code: o.currency_code,
        method: o.method,
        progress_basis: o.progress_basis,
        base_price: n(o.allocation_amount),
        approved_variations: share(basis.approvedVariations, o.contract_id ?? null, weight),
        unapproved_variations: share(basis.unapprovedVariations, o.contract_id ?? null, weight),
        unapproved_claims: 0,
        constraint_pct: n(o.constraint_pct) || (settings ? n(settings.constraint_pct) : 0),
        cost_incurred: basis.costIncurred * costWeight,
        cost_to_complete: basis.costToComplete * costWeight,
        milestones: (o.milestones ?? []) as any,
        evm_progress: basis.evmProgress,
        start_date: o.start_date ?? null,
        end_date: o.end_date ?? null,
        is_complete: o.status === "closed",
        prior_revenue: n(priorRevenue.get(o.id)),
        billed_to_date: share(basis.billed, o.contract_id ?? null, weight),
        cash_received: share(basis.cash, o.contract_id ?? null, weight),
        retention_pct: n(o.retention_pct),
        advance_amount: n(o.advance_amount),
        advance_recovery_pct: n(o.advance_recovery_pct),
        adjustments: adjFor(o.id),
        fx_rate: fx.rate,
        fx_rate_date: fx.date,
        fx_source: fx.source,
        fx_stale: fx.stale,
      });
    }
    return rows;
  }

  const totalValue = basis.contracts.reduce((a, c) => a + n(c.value), 0);
  for (const c of basis.contracts) {
    const fx = await fxFor(c.currency_code ?? reportingCurrency);
    const costWeight = totalValue > 0 ? n(c.value) / totalValue : 0;
    rows.push({
      id: c.id,
      code: c.contract_number,
      label: c.counterparty ?? c.contract_number,
      contract_id: c.id,
      currency_code: c.currency_code ?? reportingCurrency,
      method: settings?.default_method ?? "cost_to_cost",
      progress_basis: "cost",
      base_price: n(c.value),
      approved_variations: n(basis.approvedVariations.get(c.id)),
      unapproved_variations: n(basis.unapprovedVariations.get(c.id)),
      constraint_pct: settings ? n(settings.constraint_pct) : 0,
      cost_incurred: basis.costIncurred * costWeight,
      cost_to_complete: basis.costToComplete * costWeight,
      evm_progress: basis.evmProgress,
      prior_revenue: n(priorRevenue.get(c.id)),
      billed_to_date: n(basis.billed.get(c.id)),
      cash_received: n(basis.cash.get(c.id)),
      retention_pct: settings ? n(settings.retention_pct) : 0,
      advance_recovery_pct: settings ? n(settings.advance_recovery_pct) : 0,
      adjustments: adjFor(null),
      fx_rate: fx.rate,
      fx_rate_date: fx.date,
      fx_source: fx.source,
      fx_stale: fx.stale,
    });
  }
  return rows;
}

async function priorApprovedRevenue(
  ctx: AuthContext,
  projectId: string,
  periodMonth: string,
): Promise<Map<string, number>> {
  const snaps = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_snapshots")
      .select("id, period_month, status")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .lt("period_month", periodMonth)
      .order("period_month", { ascending: false })
      .limit(1),
  );
  const out = new Map<string, number>();
  const prior = snaps[0];
  if (!prior) return out;
  const lines = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_snapshot_lines")
      .select("obligation_id, cumulative_revenue")
      .eq("snapshot_id", prior.id),
  );
  for (const l of lines)
    if (l.obligation_id) out.set(l.obligation_id as string, n(l.cumulative_revenue));
  return out;
}

// ---------------------------------------------------------------------------
// Snapshot lifecycle
// ---------------------------------------------------------------------------
export interface SnapshotRow {
  id: string;
  project_id: string;
  period_month: string;
  data_date: string;
  billing_cutoff: string;
  status: RecognitionStatus;
  row_version: number;
  version_no: number;
  method: RecognitionMethod;
  policy_version: string;
  reporting_currency: string;
  project_currency: string;
  forecast_version_id: string | null;
  evm_report_id: string | null;
  contract_basis: JsonRecord;
  fx_provenance: JsonRecord;
  inclusion_rules: JsonRecord;
  totals: RecognitionTotals;
  quality: JsonRecord;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  correction_reason: string | null;
  prepared_by: string | null;
  prepared_at: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export async function buildSnapshot(
  ctx: AuthContext,
  input: SnapshotBuildInput,
): Promise<{ id: string }> {
  await requireWrite(ctx);
  const settings = await loadSettings(ctx, input.project_id);
  const basis = await gatherBasis(ctx, input.project_id, input.period_month, input.billing_cutoff);
  const reporting = (
    input.reporting_currency ??
    settings?.reporting_currency ??
    basis.project_currency
  ).toUpperCase();
  const policy = policyFrom(settings);
  const prior = await priorApprovedRevenue(ctx, input.project_id, input.period_month);
  const obligations = await buildObligationInputs(
    ctx,
    input.project_id,
    basis,
    settings,
    reporting,
    input.data_date,
    prior,
  );

  const lines = obligations.map((o) => computeLine(o, policy, input.data_date));
  const totals = rollupLines(lines);
  const checks = reconcile(lines, totals);
  const exceptions = deriveExceptions(lines, totals, policy, checks);

  // Only ONE working snapshot per project/period — rebuild replaces it.
  const existing = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_snapshots")
      .select("id, status, version_no")
      .eq("project_id", input.project_id)
      .eq("period_month", input.period_month)
      .order("version_no", { ascending: false }),
  );
  const working = existing.find((s: any) => s.status === "working");
  if (working) {
    const { error } = await (ctx.supabase as any)
      .from("recognition_snapshots")
      .delete()
      .eq("id", working.id)
      .eq("status", "working");
    if (error) throw error;
  }
  const versionNo = (existing[0]?.version_no ?? 0) + 1;

  const { data, error } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .insert({
      company_id: basis.company_id,
      project_id: input.project_id,
      period_month: input.period_month,
      data_date: input.data_date,
      billing_cutoff: input.billing_cutoff,
      status: "working",
      version_no: versionNo,
      method: policy.default_method,
      policy_version: policy.policy_version,
      reporting_currency: reporting,
      project_currency: basis.project_currency,
      forecast_version_id: basis.forecastVersionId,
      evm_report_id: basis.evmReportId,
      contract_basis: {
        contracts: basis.contracts.map((c) => ({
          id: c.id,
          number: c.contract_number,
          value: n(c.value),
          currency: c.currency_code,
          status: c.status,
        })),
        obligation_count: obligations.length,
        derived_from_contracts: obligations.every((o) => o.contract_id === o.id),
      },
      fx_provenance: {
        reporting_currency: reporting,
        rate_date: input.data_date,
        rates: lines.map((l) => ({
          currency: l.currency_code,
          rate: l.fx_rate,
          as_of: l.fx_rate_date,
          source: l.fx_source,
          stale: l.fx_stale,
        })),
      },
      inclusion_rules: {
        contract_statuses: OPEN_CONTRACTS,
        invoice_statuses: BILLED_STATUSES,
        include_unapproved_variations: policy.include_unapproved_variations,
        include_unapproved_claims: policy.include_unapproved_claims,
        constraint_pct: policy.constraint_pct,
        cap_progress_at_100: policy.cap_progress_at_100,
        billing_cutoff: input.billing_cutoff,
      },
      totals,
      quality: {
        reconciliation: checks,
        exception_count: exceptions.length,
        blocker_count: approvalBlockers(exceptions).length,
      },
      prepared_by: ctx.user?.id ?? null,
      prepared_at: new Date().toISOString(),
      created_by: ctx.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const snapshotId = data.id as string;

  if (lines.length > 0) {
    const { error: lineError } = await (ctx.supabase as any)
      .from("recognition_snapshot_lines")
      .insert(
        lines.map((l, idx) => ({
          company_id: basis.company_id,
          snapshot_id: snapshotId,
          obligation_id: obligations[idx]?.id ?? null,
          contract_id: l.contract_id,
          label: l.label,
          method: l.method,
          currency_code: l.currency_code,
          fx_rate: l.fx_rate,
          fx_rate_date: l.fx_rate_date,
          fx_source: l.fx_source,
          fx_stale: l.fx_stale,
          transaction_price: l.transaction_price,
          approved_variations: l.approved_variations,
          constrained_consideration: l.constrained_consideration,
          cost_incurred: l.cost_incurred,
          cost_to_complete: l.cost_to_complete,
          eac: l.eac,
          progress_pct: l.progress_pct,
          cumulative_revenue: l.cumulative_revenue,
          prior_revenue: l.prior_revenue,
          period_revenue: l.period_revenue,
          gross_profit: l.gross_profit,
          loss_provision: l.loss_provision,
          billed_to_date: l.billed_to_date,
          cash_received: l.cash_received,
          contract_asset: l.contract_asset,
          contract_liability: l.contract_liability,
          retention_receivable: l.retention_receivable,
          advance_balance: l.advance_balance,
          unbilled_receivable: l.unbilled_receivable,
          remaining_revenue: l.remaining_revenue,
          cumulative_revenue_reporting: l.cumulative_revenue_reporting,
          period_revenue_reporting: l.period_revenue_reporting,
          contract_asset_reporting: l.contract_asset_reporting,
          contract_liability_reporting: l.contract_liability_reporting,
          provenance: { code: l.code, flags: l.flags, progress_basis: l.progress_basis },
          sort_order: idx,
        })),
      );
    if (lineError) throw lineError;
  }

  if (exceptions.length > 0) {
    const { error: exError } = await (ctx.supabase as any).from("recognition_exceptions").insert(
      exceptions.map((e) => ({
        company_id: basis.company_id,
        snapshot_id: snapshotId,
        project_id: input.project_id,
        code: e.code,
        severity: e.severity,
        message: e.message,
        context: e.context,
      })),
    );
    if (exError) throw exError;
  }

  await logEvent(ctx, {
    company_id: basis.company_id,
    project_id: input.project_id,
    snapshot_id: snapshotId,
    entity_type: "snapshot",
    entity_id: snapshotId,
    event_type: "snapshot_built",
    to_status: "working",
    detail: { version_no: versionNo, lines: lines.length, exceptions: exceptions.length },
  });
  await audit(ctx, "recognition_snapshots", snapshotId, "insert", {
    period_month: input.period_month,
  });
  return { id: snapshotId };
}

export async function transitionSnapshot(
  ctx: AuthContext,
  input: SnapshotTransitionInput,
): Promise<{ ok: true }> {
  const { data: current, error } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .select(
      "id, company_id, project_id, period_month, status, row_version, prepared_by, submitted_by",
    )
    .eq("id", input.snapshot_id)
    .maybeSingle();
  if (error) throw error;
  if (!current) httpError(404, "snapshot_not_found", "Recognition snapshot not found.");

  const from = current.status as RecognitionStatus;
  if (!canTransition(from, input.to_status))
    httpError(409, "invalid_transition", `Cannot move a ${from} snapshot to ${input.to_status}.`);

  if (input.to_status === "approved") {
    await requireApprove(ctx);
    if (
      violatesSegregation({
        approver_id: ctx.user?.id ?? "",
        prepared_by: current.prepared_by,
        submitted_by: current.submitted_by,
      })
    )
      httpError(
        403,
        "segregation_of_duties",
        "The approver must differ from the preparer and submitter.",
      );

    const exceptions = await listExceptions(ctx, input.snapshot_id);
    const blockers = exceptions.filter((e) => e.severity === "critical");
    if (blockers.length > 0)
      httpError(409, "approval_blocked", "Resolve critical recognition exceptions first.", {
        blockers: blockers.map((b) => b.code),
      });
  } else {
    await requireWrite(ctx);
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: input.to_status,
    row_version: input.row_version + 1,
    updated_at: now,
  };
  if (input.to_status === "submitted") {
    patch.submitted_by = ctx.user?.id ?? null;
    patch.submitted_at = now;
  }
  if (input.to_status === "approved") {
    patch.approved_by = ctx.user?.id ?? null;
    patch.approved_at = now;
  }
  if (input.to_status === "working") {
    patch.submitted_by = null;
    patch.submitted_at = null;
  }

  const { data: updated, error: upError } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .update(patch)
    .eq("id", input.snapshot_id)
    .eq("row_version", input.row_version)
    .select("id")
    .maybeSingle();
  if (upError) throw upError;
  if (!updated)
    httpError(409, "version_conflict", "This snapshot changed elsewhere. Reload and retry.");

  await logEvent(ctx, {
    company_id: current.company_id,
    project_id: current.project_id,
    snapshot_id: input.snapshot_id,
    entity_type: "snapshot",
    entity_id: input.snapshot_id,
    event_type: `snapshot_${input.to_status}`,
    from_status: from,
    to_status: input.to_status,
    detail: { note: input.note ?? null },
  });
  await audit(ctx, "recognition_snapshots", input.snapshot_id, "update", {
    from,
    to: input.to_status,
  });
  return { ok: true };
}

/** Correction lineage: supersede the approved snapshot and rebuild a working one. */
export async function correctSnapshot(
  ctx: AuthContext,
  input: SnapshotCorrectionInput,
): Promise<{ id: string }> {
  await requireApprove(ctx);
  const { data: current, error } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .select(
      "id, company_id, project_id, period_month, data_date, billing_cutoff, status, row_version, reporting_currency",
    )
    .eq("id", input.snapshot_id)
    .maybeSingle();
  if (error) throw error;
  if (!current) httpError(404, "snapshot_not_found", "Recognition snapshot not found.");
  if (current.status !== "approved")
    httpError(409, "not_approved", "Only an approved snapshot can be corrected.");

  const rebuilt = await buildSnapshot(ctx, {
    project_id: current.project_id,
    period_month: current.period_month,
    data_date: current.data_date,
    billing_cutoff: current.billing_cutoff,
    reporting_currency: current.reporting_currency,
  });

  const now = new Date().toISOString();
  const { error: supError } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .update({
      status: "superseded",
      superseded_by_id: rebuilt.id,
      superseded_at: now,
      correction_reason: input.reason,
      row_version: current.row_version + 1,
      updated_at: now,
    })
    .eq("id", current.id)
    .eq("row_version", current.row_version);
  if (supError) throw supError;

  const { error: linkError } = await (ctx.supabase as any)
    .from("recognition_snapshots")
    .update({ supersedes_id: current.id, correction_reason: input.reason })
    .eq("id", rebuilt.id);
  if (linkError) throw linkError;

  await logEvent(ctx, {
    company_id: current.company_id,
    project_id: current.project_id,
    snapshot_id: current.id,
    entity_type: "snapshot",
    entity_id: current.id,
    event_type: "snapshot_superseded",
    from_status: "approved",
    to_status: "superseded",
    detail: { reason: input.reason, replacement_id: rebuilt.id },
  });
  await audit(ctx, "recognition_snapshots", current.id, "update", { correction: input.reason });
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Adjustments
// ---------------------------------------------------------------------------
export async function saveAdjustment(
  ctx: AuthContext,
  input: RecognitionAdjustmentInput,
): Promise<{ id: string }> {
  await requireWrite(ctx);
  const { company_id } = await projectContext(ctx, input.project_id);
  const payload = {
    ...input,
    company_id,
    prepared_by: ctx.user?.id ?? null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    if (!input.row_version)
      httpError(400, "row_version_required", "Concurrency token is required for updates.");
    const { data, error } = await (ctx.supabase as any)
      .from("recognition_adjustments")
      .update({ ...payload, row_version: input.row_version + 1 })
      .eq("id", input.id)
      .eq("row_version", input.row_version)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data)
      httpError(409, "version_conflict", "This adjustment changed or is no longer editable.");
    await audit(ctx, "recognition_adjustments", input.id, "update", { kind: input.kind });
    return { id: input.id };
  }

  const { data, error } = await (ctx.supabase as any)
    .from("recognition_adjustments")
    .insert({ ...payload, created_by: ctx.user?.id ?? null })
    .select("id")
    .single();
  if (error) throw error;
  await logEvent(ctx, {
    company_id,
    project_id: input.project_id,
    entity_type: "adjustment",
    entity_id: data.id,
    event_type: "adjustment_created",
    detail: { kind: input.kind, amount: input.amount, reason: input.reason },
  });
  await audit(ctx, "recognition_adjustments", data.id, "insert", { kind: input.kind });
  return { id: data.id as string };
}

export async function decideAdjustment(
  ctx: AuthContext,
  input: AdjustmentDecisionInput,
): Promise<{ ok: true }> {
  await requireApprove(ctx);
  const { data: current, error } = await (ctx.supabase as any)
    .from("recognition_adjustments")
    .select("id, company_id, project_id, status, row_version, prepared_by")
    .eq("id", input.adjustment_id)
    .maybeSingle();
  if (error) throw error;
  if (!current) httpError(404, "adjustment_not_found", "Adjustment not found.");
  if (current.status !== "draft")
    httpError(409, "already_decided", "This adjustment has already been decided.");
  if (input.decision === "approve" && current.prepared_by === (ctx.user?.id ?? null))
    httpError(403, "segregation_of_duties", "An adjustment cannot be authorised by its preparer.");

  const now = new Date().toISOString();
  const patch =
    input.decision === "approve"
      ? { status: "approved", authorized_by: ctx.user?.id ?? null, authorized_at: now }
      : { status: "voided", voided_by: ctx.user?.id ?? null, voided_at: now };

  const { data, error: upError } = await (ctx.supabase as any)
    .from("recognition_adjustments")
    .update({ ...patch, row_version: input.row_version + 1, updated_at: now })
    .eq("id", input.adjustment_id)
    .eq("row_version", input.row_version)
    .select("id")
    .maybeSingle();
  if (upError) throw upError;
  if (!data) httpError(409, "version_conflict", "This adjustment changed elsewhere.");

  await logEvent(ctx, {
    company_id: current.company_id,
    project_id: current.project_id,
    entity_type: "adjustment",
    entity_id: input.adjustment_id,
    event_type: `adjustment_${input.decision}`,
    detail: { note: input.note ?? null },
  });
  await audit(ctx, "recognition_adjustments", input.adjustment_id, "update", {
    decision: input.decision,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listExceptions(
  ctx: AuthContext,
  snapshotId: string,
): Promise<RecognitionException[]> {
  const rows = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_exceptions")
      .select("code, severity, message, context")
      .eq("snapshot_id", snapshotId),
  );
  return rows as RecognitionException[];
}

export interface RecognitionWorkspace {
  project_id: string;
  project_name: string;
  project_currency: string;
  reporting_currency: string;
  period_month: string;
  settings: RecognitionSettingsRow | null;
  policy: RecognitionPolicy;
  snapshot: SnapshotRow | null;
  lines: RecognitionLine[];
  totals: RecognitionTotals | null;
  reconciliation: ReconciliationCheck[];
  exceptions: RecognitionException[];
  blockers: RecognitionException[];
  obligations: ObligationRow[];
  adjustments: JsonRecord[];
  history: SnapshotRow[];
  events: JsonRecord[];
  frozen: boolean;
  access: RecognitionAccess;
}

function lineFromRow(row: Record<string, any>): RecognitionLine {
  const prov = (row.provenance ?? {}) as Record<string, unknown>;
  const cumulative = n(row.cumulative_revenue);
  const gross = n(row.gross_profit);
  return {
    obligation_id: (row.obligation_id as string) ?? (row.id as string),
    code: (prov.code as string) ?? (row.label as string),
    label: row.label as string,
    contract_id: (row.contract_id as string) ?? null,
    currency_code: row.currency_code as string,
    method: row.method as RecognitionMethod,
    progress_basis: (prov.progress_basis as any) ?? "cost",
    base_price:
      n(row.transaction_price) - n(row.approved_variations) - n(row.constrained_consideration),
    approved_variations: n(row.approved_variations),
    constrained_consideration: n(row.constrained_consideration),
    transaction_price: n(row.transaction_price),
    cost_incurred: n(row.cost_incurred),
    cost_to_complete: n(row.cost_to_complete),
    eac: n(row.eac),
    progress_pct: n(row.progress_pct),
    progress_capped: Boolean((prov.flags as string[])?.includes("progress_capped")),
    prior_revenue: n(row.prior_revenue),
    cumulative_revenue: cumulative,
    period_revenue: n(row.period_revenue),
    gross_profit: gross,
    margin_pct: cumulative === 0 ? null : (gross / cumulative) * 100,
    loss_provision: n(row.loss_provision),
    billed_to_date: n(row.billed_to_date),
    cash_received: n(row.cash_received),
    contract_asset: n(row.contract_asset),
    contract_liability: n(row.contract_liability),
    retention_receivable: n(row.retention_receivable),
    advance_balance: n(row.advance_balance),
    unbilled_receivable: n(row.unbilled_receivable),
    remaining_revenue: n(row.remaining_revenue),
    fx_rate: row.fx_rate === null ? null : n(row.fx_rate),
    fx_rate_date: (row.fx_rate_date as string) ?? null,
    fx_source: (row.fx_source as string) ?? null,
    fx_stale: Boolean(row.fx_stale),
    cumulative_revenue_reporting: n(row.cumulative_revenue_reporting),
    period_revenue_reporting: n(row.period_revenue_reporting),
    contract_asset_reporting: n(row.contract_asset_reporting),
    contract_liability_reporting: n(row.contract_liability_reporting),
    flags: ((prov.flags as any[]) ?? []) as any,
  };
}

export async function loadRecognitionWorkspace(
  ctx: AuthContext,
  projectId: string,
  periodMonth?: string,
): Promise<RecognitionWorkspace> {
  const p = await projectContext(ctx, projectId);
  const settings = await loadSettings(ctx, projectId);
  const policy = policyFrom(settings);

  const history = (await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("period_month", { ascending: false })
      .order("version_no", { ascending: false })
      .limit(24),
  )) as SnapshotRow[];

  const snapshot =
    (periodMonth ? history.find((s) => s.period_month === periodMonth) : history[0]) ?? null;

  const lineRows = snapshot
    ? await safeRows<any>(() =>
        (ctx.supabase as any)
          .from("recognition_snapshot_lines")
          .select("*")
          .eq("snapshot_id", snapshot.id)
          .order("sort_order", { ascending: true }),
      )
    : [];
  const lines = lineRows.map(lineFromRow);
  const totals = snapshot ? rollupLines(lines) : null;
  const reconciliation = totals ? reconcile(lines, totals) : [];
  const exceptions = snapshot ? await listExceptions(ctx, snapshot.id) : [];

  const [obligations, adjustments, events] = await Promise.all([
    listObligations(ctx, projectId),
    safeRows<any>(() =>
      (ctx.supabase as any)
        .from("recognition_adjustments")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50),
    ),
    safeRows<any>(() =>
      (ctx.supabase as any)
        .from("recognition_events")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(50),
    ),
  ]);

  return {
    project_id: projectId,
    project_name: p.name,
    project_currency: p.currency,
    reporting_currency: snapshot?.reporting_currency ?? settings?.reporting_currency ?? p.currency,
    period_month: snapshot?.period_month ?? periodMonth ?? "",
    settings,
    policy,
    snapshot,
    lines,
    totals,
    reconciliation,
    exceptions,
    blockers: exceptions.filter((e) => e.severity === "critical"),
    obligations,
    adjustments,
    history,
    events,
    frozen: snapshot ? isFrozen(snapshot.status) : false,
    access: await resolveRecognitionAccess(ctx),
  };
}

// ---------------------------------------------------------------------------
// Sensitivity (non-posting)
// ---------------------------------------------------------------------------
export async function runSensitivity(
  ctx: AuthContext,
  input: SensitivityQueryInput,
): Promise<ReturnType<typeof applySensitivity>> {
  const settings = await loadSettings(ctx, input.project_id);
  const policy = policyFrom(settings);
  const snapshots = await safeRows<any>(() =>
    (ctx.supabase as any)
      .from("recognition_snapshots")
      .select("id, data_date, billing_cutoff, reporting_currency")
      .eq("project_id", input.project_id)
      .eq("period_month", input.period_month)
      .order("version_no", { ascending: false })
      .limit(1),
  );
  const snap = snapshots[0];
  const dataDate = (snap?.data_date as string) ?? input.period_month;
  const basis = await gatherBasis(
    ctx,
    input.project_id,
    input.period_month,
    (snap?.billing_cutoff as string) ?? dataDate,
  );
  const prior = await priorApprovedRevenue(ctx, input.project_id, input.period_month);
  const obligations = await buildObligationInputs(
    ctx,
    input.project_id,
    basis,
    settings,
    (snap?.reporting_currency as string) ?? basis.project_currency,
    dataDate,
    prior,
  );
  return applySensitivity(obligations, policy, dataDate, input);
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------
export interface PortfolioRecognitionView {
  period_month: string | null;
  reporting_currency: string;
  rows: PortfolioProjectInput[];
  rollup: ReturnType<typeof rollupPortfolio>;
  concentration: {
    customer: ReturnType<typeof concentrationBy>;
    project: ReturnType<typeof concentrationBy>;
    currency: ReturnType<typeof concentrationBy>;
    method: ReturnType<typeof concentrationBy>;
  };
  alerts: RecognitionAlert[];
  access: RecognitionAccess;
}

export async function loadPortfolioRecognition(
  ctx: AuthContext,
  query: PortfolioRecognitionQuery,
): Promise<PortfolioRecognitionView> {
  let builder = (ctx.supabase as any)
    .from("recognition_snapshots")
    .select(
      "id, project_id, period_month, data_date, status, method, reporting_currency, totals, version_no",
    )
    .order("period_month", { ascending: false })
    .order("version_no", { ascending: false })
    .limit(500);
  if (query.period_month) builder = builder.eq("period_month", query.period_month);
  if (query.status !== "all") builder = builder.eq("status", query.status);

  const snaps = await safeRows<any>(() => builder);

  // Latest snapshot per project.
  const latest = new Map<string, any>();
  for (const s of snaps) if (!latest.has(s.project_id)) latest.set(s.project_id, s);

  const projectIds = [...latest.keys()];
  const projects = projectIds.length
    ? await safeRows<any>(() =>
        (ctx.supabase as any).from("projects").select("id, name, client_name").in("id", projectIds),
      )
    : [];
  const nameById = new Map(projects.map((p: any) => [p.id as string, p]));

  const asOf = new Date().toISOString().slice(0, 10);
  const rows: PortfolioProjectInput[] = [...latest.values()].map((s) => {
    const p = nameById.get(s.project_id);
    return {
      project_id: s.project_id as string,
      project_name: (p?.name as string) ?? s.project_id,
      customer: (p?.client_name as string) ?? null,
      currency_code: (s.reporting_currency as string) ?? "USD",
      method: s.method as RecognitionMethod,
      status: s.status as RecognitionStatus,
      period_month: s.period_month as string,
      data_date: s.data_date as string,
      totals: (s.totals ?? {}) as RecognitionTotals,
    };
  });

  return {
    period_month: query.period_month ?? rows[0]?.period_month ?? null,
    reporting_currency: query.reporting_currency ?? rows[0]?.currency_code ?? "USD",
    rows,
    rollup: rollupPortfolio(rows),
    concentration: {
      customer: concentrationBy(rows, "customer"),
      project: concentrationBy(rows, "project"),
      currency: concentrationBy(rows, "currency"),
      method: concentrationBy(rows, "method"),
    },
    alerts: evaluateRecognitionAlerts(rows, asOf),
    access: await resolveRecognitionAccess(ctx),
  };
}

// ---------------------------------------------------------------------------
// Close-pack appendix
// ---------------------------------------------------------------------------
export interface RecognitionAppendix {
  scope: "project" | "portfolio";
  basis: "approved" | "indicative";
  disclaimer: string;
  project_id: string | null;
  project_name: string | null;
  period_month: string | null;
  data_date: string | null;
  billing_cutoff: string | null;
  status: RecognitionStatus | null;
  version_no: number | null;
  frozen: boolean;
  watermark: string | null;
  policy: { method: RecognitionMethod | null; policy_version: string | null };
  reporting_currency: string;
  totals: RecognitionTotals | null;
  obligations: {
    code: string;
    label: string;
    method: RecognitionMethod;
    progress_pct: number;
    cumulative_revenue: number;
    billed_to_date: number;
    contract_asset: number;
    contract_liability: number;
  }[];
  reconciliation: ReconciliationCheck[];
  exceptions: RecognitionException[];
  approvals: {
    prepared_by: string | null;
    prepared_at: string | null;
    submitted_by: string | null;
    submitted_at: string | null;
    approved_by: string | null;
    approved_at: string | null;
  };
  fx_provenance: JsonRecord;
  inclusion_rules: JsonRecord;
  adjustments: { kind: string; amount: number; reason: string; status: string }[];
}

export async function loadRecognitionAppendix(
  ctx: AuthContext,
  projectId: string,
  periodMonth?: string,
): Promise<RecognitionAppendix> {
  const ws = await loadRecognitionWorkspace(ctx, projectId, periodMonth);
  const s = ws.snapshot;
  return {
    scope: "project",
    basis: s?.status === "approved" ? "approved" : "indicative",
    disclaimer: RECOGNITION_DISCLAIMER,
    project_id: projectId,
    project_name: ws.project_name,
    period_month: s?.period_month ?? null,
    data_date: s?.data_date ?? null,
    billing_cutoff: s?.billing_cutoff ?? null,
    status: s?.status ?? null,
    version_no: s?.version_no ?? null,
    frozen: ws.frozen,
    watermark: s ? (s.status === "approved" ? null : s.status.toUpperCase()) : "NO SNAPSHOT",
    policy: { method: s?.method ?? null, policy_version: s?.policy_version ?? null },
    reporting_currency: ws.reporting_currency,
    totals: ws.totals,
    obligations: ws.lines.map((l) => ({
      code: l.code,
      label: l.label,
      method: l.method,
      progress_pct: l.progress_pct,
      cumulative_revenue: l.cumulative_revenue,
      billed_to_date: l.billed_to_date,
      contract_asset: l.contract_asset,
      contract_liability: l.contract_liability,
    })),
    reconciliation: ws.reconciliation,
    exceptions: ws.exceptions,
    approvals: {
      prepared_by: s?.prepared_by ?? null,
      prepared_at: s?.prepared_at ?? null,
      submitted_by: s?.submitted_by ?? null,
      submitted_at: s?.submitted_at ?? null,
      approved_by: s?.approved_by ?? null,
      approved_at: s?.approved_at ?? null,
    },
    fx_provenance: s?.fx_provenance ?? {},
    inclusion_rules: s?.inclusion_rules ?? {},
    adjustments: (ws.adjustments as any[]).map((a) => ({
      kind: a.kind as string,
      amount: n(a.amount),
      reason: a.reason as string,
      status: a.status as string,
    })),
  };
}
