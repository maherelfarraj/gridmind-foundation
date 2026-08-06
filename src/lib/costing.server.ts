// GC-01/GC-02 — Server-only loaders + aggregation for the project Costing workspace.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { loadFxRates, resolveBaseCurrency } from "@/lib/ar-aging.server";
import { buildCbsTree, type CbsMetrics, type CbsRow } from "@/lib/costing.cbs";
import { convertMoney, resolveFx, sumMoney } from "@/lib/costing.fx";
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
      .select("cost_code_id, original_amount, approved_changes, current_amount, currency_code")
      .eq("project_id", projectId),
    sb
      .from("purchase_orders")
      .select(
        "id, po_number, status, total_amount, currency_code, cost_code_id, vendor:vendor_id(name)",
      )
      .eq("project_id", projectId),
    sb
      .from("subcontracts")
      .select(
        "id, subcontract_number, title, status, contract_value, currency_code, cost_code_id, vendor:vendor_id(name)",
      )
      .eq("project_id", projectId),
    sb
      .from("change_orders")
      .select("id, co_number, title, status, amount, currency_code, cost_code_id")
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
        "id, invoice_number, direction, status, amount, paid_amount, currency_code, cost_code_id, issue_date, due_date",
      )
      .eq("project_id", projectId)
      .order("issue_date", { ascending: false }),
    sb
      .from("payments")
      .select(
        "id, payment_number, direction, record_status, amount, currency_code, payment_date, method, invoice_id",
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
      .select("id, code, name, parent_id")
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

  const budgets: {
    cost_code_id: string | null;
    original_amount: number;
    approved_changes: number;
    current_amount: number;
    currency_code: string;
  }[] = (budgetsQ.data ?? []).map((b: any) => ({
    cost_code_id: (b.cost_code_id as string | null) ?? null,
    original_amount: Number(b.original_amount ?? 0),
    approved_changes: Number(b.approved_changes ?? 0),
    current_amount: Number(b.current_amount ?? 0),
    currency_code: b.currency_code ?? "USD",
  }));

  // --- reporting currency + FX (one authorized project-scoped payload) ------
  const baseCurrency = (await resolveBaseCurrency(ctx, projectId)).toUpperCase();
  const fallbackCurrency = baseCurrency;
  const today = new Date().toISOString().slice(0, 10);

  const usedCurrencies = new Set<string>([baseCurrency]);
  const note = (c: unknown) => usedCurrencies.add(String(c ?? fallbackCurrency).toUpperCase());
  for (const b of budgets) note(b.currency_code);
  for (const r of posQ.data ?? []) note((r as any).currency_code);
  for (const r of subsQ.data ?? []) note((r as any).currency_code);
  for (const r of cosQ.data ?? []) note((r as any).currency_code);
  for (const r of invoicesQ.data ?? []) note((r as any).currency_code);
  for (const r of paymentsQ.data ?? []) note((r as any).currency_code);
  for (const r of accrualsQ.data ?? []) note((r as any).currency_code);
  for (const r of forecastsQ.data ?? []) note((r as any).currency_code);

  const rateMap = await loadFxRates(ctx, [...usedCurrencies], baseCurrency, today);
  const fxMissing = [...usedCurrencies].filter((c) => !rateMap.has(c)).sort();
  const rateOf = (code: string | null | undefined): number => {
    const c = (code ?? fallbackCurrency).toUpperCase();
    return rateMap.get(c) ?? (c === baseCurrency ? 1 : 0);
  };
  /** Convert a transaction amount to project currency, rounding exactly once. */
  const toBase = (amount: number, code: string | null | undefined): number =>
    convertMoney(amount, rateOf(code));

  const commitments: CostingCommitmentRow[] = [
    ...(posQ.data ?? []).map((p: any) => ({
      id: p.id,
      kind: "purchase_order" as const,
      reference: p.po_number,
      counterparty: p.vendor?.name ?? null,
      status: p.status,
      amount: Number(p.total_amount ?? 0),
      currency_code: p.currency_code ?? fallbackCurrency,
      amount_base: toBase(Number(p.total_amount ?? 0), p.currency_code),
      cost_code_id: (p.cost_code_id as string | null) ?? null,
    })),
    ...(subsQ.data ?? []).map((s: any) => ({
      id: s.id,
      kind: "subcontract" as const,
      reference: s.subcontract_number,
      counterparty: s.vendor?.name ?? s.title ?? null,
      status: s.status,
      amount: Number(s.contract_value ?? 0),
      currency_code: s.currency_code ?? fallbackCurrency,
      amount_base: toBase(Number(s.contract_value ?? 0), s.currency_code),
      cost_code_id: (s.cost_code_id as string | null) ?? null,
    })),
    ...(cosQ.data ?? []).map((c: any) => ({
      id: c.id,
      kind: "change_order" as const,
      reference: c.co_number,
      counterparty: c.title ?? null,
      status: c.status,
      amount: Number(c.amount ?? 0),
      currency_code: c.currency_code ?? fallbackCurrency,
      amount_base: toBase(Number(c.amount ?? 0), c.currency_code),
      cost_code_id: (c.cost_code_id as string | null) ?? null,
    })),
  ];

  const invoices: CostingInvoiceRow[] = (invoicesQ.data ?? []).map((i: any) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    direction: i.direction,
    status: i.status,
    amount: Number(i.amount ?? 0),
    amount_base: toBase(Number(i.amount ?? 0), i.currency_code),
    paid_amount: Number(i.paid_amount ?? 0),
    currency_code: i.currency_code ?? fallbackCurrency,
    cost_code_id: (i.cost_code_id as string | null) ?? null,
    issue_date: i.issue_date ?? null,
    due_date: i.due_date ?? null,
  }));

  // Payments inherit the cost code of the invoice they settle.
  const invoiceCostCode = new Map(invoices.map((i) => [i.id, i.cost_code_id]));

  const payments: CostingPaymentRow[] = (paymentsQ.data ?? []).map((p: any) => ({
    id: p.id,
    payment_number: p.payment_number,
    direction: p.direction,
    record_status: p.record_status,
    amount: Number(p.amount ?? 0),
    amount_base: toBase(Number(p.amount ?? 0), p.currency_code),
    currency_code: p.currency_code ?? fallbackCurrency,
    cost_code_id: (p.invoice_id ? (invoiceCostCode.get(p.invoice_id) ?? null) : null) as
      | string
      | null,
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
    amount_base: Number(a.amount_base ?? a.amount ?? 0),
    currency_code: a.currency_code,
    status: a.status,
    description: a.description ?? null,
    approved_at: a.approved_at ?? null,
    reversed_at: a.reversed_at ?? null,
    reversal_reason: a.reversal_reason ?? null,
    created_at: a.created_at,
    base_currency_code: a.base_currency_code ?? a.currency_code,
    fx_rate: Number(a.fx_rate ?? 1),
    fx_rate_date: a.fx_rate_date ?? null,
    fx_source: (a.fx_source ?? "parity") as "parity" | "table" | "manual",
    fx_override_reason: a.fx_override_reason ?? null,
    fx_locked_at: a.fx_locked_at ?? null,
  }));

  const forecasts: CostingForecastRow[] = (forecastsQ.data ?? []).map((f: any) => ({
    id: f.id,
    project_id: f.project_id,
    cost_code_id: f.cost_code_id,
    cost_code: f.cost_code?.code ?? null,
    period: f.period,
    etc_amount: Number(f.etc_amount ?? 0),
    etc_amount_base: Number(f.etc_amount_base ?? f.etc_amount ?? 0),
    currency_code: f.currency_code,
    notes: f.notes ?? null,
    base_currency_code: f.base_currency_code ?? f.currency_code,
    fx_rate: Number(f.fx_rate ?? 1),
    fx_rate_date: f.fx_rate_date ?? null,
    fx_source: (f.fx_source ?? "parity") as "parity" | "table" | "manual",
    fx_override_reason: f.fx_override_reason ?? null,
    fx_locked_at: f.fx_locked_at ?? null,
  }));

  const rollups = computeCostingRollup({
    budgets,
    commitments,
    invoices: invoices as CostingInvoiceInput[],
    payments: payments as CostingPaymentInput[],
    accruals: accruals as unknown as CostingAccrualInput[],
    forecasts: forecasts as unknown as CostingForecastInput[],
  });

  // --- CBS roll-up in project currency (single reconciled payload) ---------
  const { rows: cbs, total: baseRollup } = buildCbsTree({
    costCodes: (codesQ.data ?? []).map((c: any) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      parent_id: (c.parent_id as string | null) ?? null,
    })),
    budgets: budgets.map((b) => ({
      cost_code_id: b.cost_code_id,
      original: toBase(b.original_amount, b.currency_code),
      approved_changes: toBase(b.approved_changes, b.currency_code),
      current: toBase(b.current_amount, b.currency_code),
    })),
    commitments: commitments.map((c) => ({
      id: c.id,
      cost_code_id: c.cost_code_id,
      kind: c.kind,
      status: c.status,
      amount_base: c.amount_base,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      cost_code_id: i.cost_code_id,
      direction: i.direction,
      status: i.status,
      amount_base: i.amount_base,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      cost_code_id: p.cost_code_id,
      direction: p.direction,
      record_status: p.record_status,
      amount_base: p.amount_base,
    })),
    accruals: accruals.map((a) => ({
      id: a.id,
      cost_code_id: a.cost_code_id,
      status: a.status,
      amount_base: a.amount_base,
    })),
    forecasts: forecasts.map((f) => ({
      id: f.id,
      cost_code_id: f.cost_code_id,
      etc_amount_base: f.etc_amount_base,
    })),
  });

  // --- per-currency subtotals for the forecast view ------------------------
  const subtotalCodes = [
    ...new Set([...forecasts.map((f) => f.currency_code), ...accruals.map((a) => a.currency_code)]),
  ].sort();
  const currencySubtotals: CostingCurrencySubtotal[] = subtotalCodes.map((code) => ({
    currency_code: code,
    forecast_txn: sumMoney(
      forecasts.filter((f) => f.currency_code === code).map((f) => f.etc_amount),
    ),
    forecast_base: sumMoney(
      forecasts.filter((f) => f.currency_code === code).map((f) => f.etc_amount_base),
    ),
    accrual_txn: sumMoney(
      accruals.filter((a) => a.currency_code === code && a.status === "approved").map((a) => a.amount),
    ),
    accrual_base: sumMoney(
      accruals
        .filter((a) => a.currency_code === code && a.status === "approved")
        .map((a) => a.amount_base),
    ),
  }));

  return {
    project: { id: project.id, name: project.name, code: project.code },
    baseCurrency,
    fxRates: [...usedCurrencies].sort().map((c) => ({
      currency_code: c,
      rate: rateMap.get(c) ?? 0,
      as_of: rateMap.has(c) ? today : null,
      stale: false,
    })),
    fxMissing,
    rollups,
    baseRollup,
    cbs,
    currencySubtotals,
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
    costCodes: (codesQ.data ?? []).map((c: any) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      parent_id: (c.parent_id as string | null) ?? null,
    })),
  };

}

// ---------------------------------------------------------------------------
// GC-02 — FX resolution for costing writes (forecasts + accruals)
// ---------------------------------------------------------------------------
export interface CostingFxResult {
  base_currency_code: string;
  fx_rate: number | null;
  fx_rate_date: string | null;
  fx_source: "parity" | "table" | "manual";
  fx_override_reason: string | null;
  stale: boolean;
  missing: boolean;
}

/**
 * Resolve the effective-dated rate for one transaction currency into the
 * project's reporting currency. Manual overrides win, same-currency is parity,
 * otherwise the latest fx_rates row on or before `onDate` is used.
 */
export async function resolveCostingFx(
  ctx: AuthContext,
  projectId: string,
  txnCurrency: string,
  onDate: string,
  override?: { rate: number; reason: string } | null,
): Promise<CostingFxResult> {
  const base = (await resolveBaseCurrency(ctx, projectId)).toUpperCase();
  const txn = txnCurrency.toUpperCase();

  let tableRate: { rate: number; as_of: string } | null = null;
  if (!override && txn !== base) {
    const { data } = await (ctx.supabase as any)
      .from("fx_rates")
      .select("rate, as_of")
      .eq("base_code", txn)
      .eq("quote_code", base)
      .lte("as_of", onDate)
      .order("as_of", { ascending: false })
      .limit(1);
    const row = (data ?? [])[0];
    if (row) tableRate = { rate: Number(row.rate), as_of: row.as_of as string };
  }

  const res = resolveFx({
    txnCurrency: txn,
    baseCurrency: base,
    onDate,
    tableRate,
    override: override ?? null,
  });
  return {
    base_currency_code: base,
    fx_rate: res.rate,
    fx_rate_date: res.rate_date,
    fx_source: res.source,
    fx_override_reason: res.override_reason,
    stale: res.stale,
    missing: res.missing,
  };
}
