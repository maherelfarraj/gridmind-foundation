// GC-01/GC-02 — Server-only loaders + aggregation for the project Costing workspace.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { loadFxRates, resolveBaseCurrency } from "@/lib/ar-aging.server";
import { buildCbsTree, type CbsMetrics, type CbsRow } from "@/lib/costing.cbs";
import { convertMoney, sumMoney } from "@/lib/costing.fx";
import {
  computeCostingRollup,
  type CostingAccrualInput,
  type CostingCommitmentInput,
  type CostingForecastInput,
  type CostingInvoiceInput,
  type CostingPaymentInput,
  type CostingRollup,
} from "@/lib/costing.rules";


export function costingHttpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const COSTING_WRITE_ROLES = ["finance_admin", "project_admin", "company_admin"] as const;

export async function hasAnyCostingRole(
  ctx: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => ctx.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

export async function loadCostingProject(ctx: AuthContext, projectId: string) {
  const { data, error } = await ctx.supabase
    .from("projects")
    .select("id, company_id, name, code")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) costingHttpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string; code: string };
}

export async function costingAudit(
  ctx: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await ctx.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Row shapes returned to the client
// ---------------------------------------------------------------------------
export interface CostingFxSnapshot {
  base_currency_code: string;
  fx_rate: number;
  fx_rate_date: string | null;
  fx_source: "parity" | "table" | "manual";
  fx_override_reason: string | null;
  fx_locked_at: string | null;
}

export interface CostingAccrualRow extends CostingFxSnapshot {
  id: string;
  project_id: string;
  cost_code_id: string;
  cost_code: string | null;
  period: string;
  amount: number;
  amount_base: number;
  currency_code: string;
  status: "draft" | "approved" | "reversed";
  description: string | null;
  approved_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface CostingForecastRow extends CostingFxSnapshot {
  id: string;
  project_id: string;
  cost_code_id: string;
  cost_code: string | null;
  period: string;
  etc_amount: number;
  etc_amount_base: number;
  currency_code: string;
  notes: string | null;
}

export interface CostingContractRow {
  id: string;
  contract_number: string;
  title: string;
  counterparty: string;
  contract_type: string;
  status: string;
  value: number;
  currency_code: string;
}

export interface CostingInvoiceRow {
  id: string;
  invoice_number: string;
  direction: string;
  status: string;
  amount: number;
  amount_base: number;
  paid_amount: number;
  currency_code: string;
  cost_code_id: string | null;
  issue_date: string | null;
  due_date: string | null;
}

export interface CostingPaymentRow {
  id: string;
  payment_number: string;
  direction: string;
  record_status: string;
  amount: number;
  amount_base: number;
  currency_code: string;
  cost_code_id: string | null;
  payment_date: string | null;
  method: string | null;
}

export interface CostingCommitmentRow extends CostingCommitmentInput {
  amount_base: number;
  cost_code_id: string | null;
}

export interface CostingCurrencySubtotal {
  currency_code: string;
  forecast_txn: number;
  forecast_base: number;
  accrual_txn: number;
  accrual_base: number;
}

export interface CostingWorkspaceData {
  project: { id: string; name: string; code: string };
  /** Reporting/base currency for the project. */
  baseCurrency: string;
  /** currency -> rate into base, plus the effective date used. */
  fxRates: { currency_code: string; rate: number; as_of: string | null; stale: boolean }[];
  fxMissing: string[];
  rollups: CostingRollup[];
  /** Single reconciled roll-up expressed in project currency. */
  baseRollup: CbsMetrics;
  cbs: CbsRow[];
  currencySubtotals: CostingCurrencySubtotal[];
  commitments: CostingCommitmentRow[];
  contracts: CostingContractRow[];
  invoices: CostingInvoiceRow[];
  payments: CostingPaymentRow[];
  accruals: CostingAccrualRow[];
  forecasts: CostingForecastRow[];
  costCodes: { id: string; code: string; name: string; parent_id: string | null }[];
}


// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export async function loadCostingWorkspace(
  ctx: AuthContext,
  projectId: string,
): Promise<CostingWorkspaceData> {
  const project = await loadCostingProject(ctx, projectId);
  const sb = ctx.supabase as any;

  const [
    budgetsQ,
    posQ,
    subsQ,
    cosQ,
    contractsQ,
    invoicesQ,
    paymentsQ,
    accrualsQ,
    forecastsQ,
    codesQ,
  ] = await Promise.all([
    sb
      .from("budgets")
      .select("original_amount, approved_changes, current_amount, currency_code")
      .eq("project_id", projectId),
    sb
      .from("purchase_orders")
      .select("id, po_number, status, total_amount, currency_code, vendor:vendor_id(name)")
      .eq("project_id", projectId),
    sb
      .from("subcontracts")
      .select(
        "id, subcontract_number, title, status, contract_value, currency_code, vendor:vendor_id(name)",
      )
      .eq("project_id", projectId),
    sb
      .from("change_orders")
      .select("id, co_number, title, status, amount, currency_code")
      .eq("project_id", projectId),
    sb
      .from("contracts")
      .select(
        "id, contract_number, title, counterparty, contract_type, status, value, currency_code",
      )
      .eq("project_id", projectId)
      .order("contract_number", { ascending: true }),
    sb
      .from("invoices")
      .select(
        "id, invoice_number, direction, status, amount, paid_amount, currency_code, issue_date, due_date",
      )
      .eq("project_id", projectId)
      .order("issue_date", { ascending: false }),
    sb
      .from("payments")
      .select(
        "id, payment_number, direction, record_status, amount, currency_code, payment_date, method",
      )
      .eq("project_id", projectId)
      .order("payment_date", { ascending: false }),
    sb
      .from("cost_accruals")
      .select("*, cost_code:cost_code_id(code)")
      .eq("project_id", projectId)
      .order("period", { ascending: false }),
    sb
      .from("cost_forecast_periods")
      .select("*, cost_code:cost_code_id(code)")
      .eq("project_id", projectId)
      .order("period", { ascending: true }),
    sb
      .from("cost_codes")
      .select("id, code, name")
      .eq("project_id", projectId)
      .order("code", { ascending: true }),
  ]);

  for (const q of [
    budgetsQ,
    posQ,
    subsQ,
    cosQ,
    contractsQ,
    invoicesQ,
    paymentsQ,
    accrualsQ,
    forecastsQ,
    codesQ,
  ]) {
    if (q?.error) throw q.error;
  }

  const budgets = (budgetsQ.data ?? []).map((b: any) => ({
    original_amount: Number(b.original_amount ?? 0),
    approved_changes: Number(b.approved_changes ?? 0),
    current_amount: Number(b.current_amount ?? 0),
    currency_code: b.currency_code ?? "USD",
  }));

  const fallbackCurrency = budgets[0]?.currency_code ?? "USD";

  const commitments: CostingCommitmentInput[] = [
    ...(posQ.data ?? []).map((p: any) => ({
      id: p.id,
      kind: "purchase_order" as const,
      reference: p.po_number,
      counterparty: p.vendor?.name ?? null,
      status: p.status,
      amount: Number(p.total_amount ?? 0),
      currency_code: p.currency_code ?? fallbackCurrency,
    })),
    ...(subsQ.data ?? []).map((s: any) => ({
      id: s.id,
      kind: "subcontract" as const,
      reference: s.subcontract_number,
      counterparty: s.vendor?.name ?? s.title ?? null,
      status: s.status,
      amount: Number(s.contract_value ?? 0),
      currency_code: s.currency_code ?? fallbackCurrency,
    })),
    ...(cosQ.data ?? []).map((c: any) => ({
      id: c.id,
      kind: "change_order" as const,
      reference: c.co_number,
      counterparty: c.title ?? null,
      status: c.status,
      amount: Number(c.amount ?? 0),
      currency_code: c.currency_code ?? fallbackCurrency,
    })),
  ];

  const invoices: CostingInvoiceRow[] = (invoicesQ.data ?? []).map((i: any) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    direction: i.direction,
    status: i.status,
    amount: Number(i.amount ?? 0),
    paid_amount: Number(i.paid_amount ?? 0),
    currency_code: i.currency_code ?? fallbackCurrency,
    issue_date: i.issue_date ?? null,
    due_date: i.due_date ?? null,
  }));

  const payments: CostingPaymentRow[] = (paymentsQ.data ?? []).map((p: any) => ({
    id: p.id,
    payment_number: p.payment_number,
    direction: p.direction,
    record_status: p.record_status,
    amount: Number(p.amount ?? 0),
    currency_code: p.currency_code ?? fallbackCurrency,
    payment_date: p.payment_date ?? null,
    method: p.method ?? null,
  }));

  const accruals: CostingAccrualRow[] = (accrualsQ.data ?? []).map((a: any) => ({
    id: a.id,
    project_id: a.project_id,
    cost_code_id: a.cost_code_id,
    cost_code: a.cost_code?.code ?? null,
    period: a.period,
    amount: Number(a.amount ?? 0),
    currency_code: a.currency_code,
    status: a.status,
    description: a.description ?? null,
    approved_at: a.approved_at ?? null,
    reversed_at: a.reversed_at ?? null,
    reversal_reason: a.reversal_reason ?? null,
    created_at: a.created_at,
  }));

  const forecasts: CostingForecastRow[] = (forecastsQ.data ?? []).map((f: any) => ({
    id: f.id,
    project_id: f.project_id,
    cost_code_id: f.cost_code_id,
    cost_code: f.cost_code?.code ?? null,
    period: f.period,
    etc_amount: Number(f.etc_amount ?? 0),
    currency_code: f.currency_code,
    notes: f.notes ?? null,
  }));

  const rollups = computeCostingRollup({
    budgets,
    commitments,
    invoices: invoices as CostingInvoiceInput[],
    payments: payments as CostingPaymentInput[],
    accruals: accruals as unknown as CostingAccrualInput[],
    forecasts: forecasts as unknown as CostingForecastInput[],
  });

  return {
    project: { id: project.id, name: project.name, code: project.code },
    rollups,
    commitments,
    contracts: (contractsQ.data ?? []).map((c: any) => ({
      id: c.id,
      contract_number: c.contract_number,
      title: c.title,
      counterparty: c.counterparty,
      contract_type: c.contract_type,
      status: c.status,
      value: Number(c.value ?? 0),
      currency_code: c.currency_code ?? fallbackCurrency,
    })),
    invoices,
    payments,
    accruals,
    forecasts,
    costCodes: (codesQ.data ?? []).map((c: any) => ({ id: c.id, code: c.code, name: c.name })),
  };
}
