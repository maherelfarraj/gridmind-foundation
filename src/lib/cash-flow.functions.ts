// P-077 — Cash-flow server functions with FX-at-entry immutability.
import { createServerFn } from "@tanstack/react-start";
import { assertPeriodOpen } from "@/lib/finance/periods";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  createCashFlowSchema,
  listCashFlowsSchema,
  normalizePeriod,
  voidCashFlowSchema,
  type CashFlowRow,
} from "@/lib/cash-flow.rules";

const WRITE_ROLES = ["finance_admin", "company_admin"] as const;

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function loadProject(context: AuthContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string };
}

async function loadBaseCurrency(context: AuthContext, projectId: string): Promise<string> {
  const { data, error } = await context.supabase
    .from("project_financial_config")
    .select("currency_code")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  const code = (data as any)?.currency_code as string | undefined;
  if (!code)
    httpError(
      400,
      "no_base_currency",
      "Project has no base currency — set it in Finance settings first.",
    );
  return code!;
}

/**
 * Look up the FX rate from `currency` → `base` for the given period.
 * Uses `fx_rates.as_of <= period`, latest first. If currency == base, returns 1.
 * Throws a clear blocking error if no rate exists — no silent 1.0 fallback.
 */
async function resolveFxRate(
  context: AuthContext,
  fromCurrency: string,
  baseCurrency: string,
  period: string,
): Promise<number> {
  if (fromCurrency === baseCurrency) return 1;
  const { data, error } = await context.supabase
    .from("fx_rates")
    .select("rate, as_of")
    .eq("base_code", fromCurrency)
    .eq("quote_code", baseCurrency)
    .lte("as_of", period)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    httpError(
      400,
      "no_fx_rate",
      `No FX rate for ${fromCurrency}→${baseCurrency} on or before ${period}. Add one in FX rates.`,
    );
  return Number((data as any).rate);
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "cash_flows",
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toRow(r: any): CashFlowRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    period: r.period,
    direction: r.direction,
    kind: r.kind,
    category: r.category,
    amount: Number(r.amount ?? 0),
    currency_code: r.currency_code,
    fx_rate_to_base: r.fx_rate_to_base == null ? null : Number(r.fx_rate_to_base),
    amount_base: r.amount_base == null ? null : Number(r.amount_base),
    base_currency_code: r.base_currency_code ?? null,
    reference_type: r.reference_type ?? null,
    reference_id: r.reference_id ?? null,
    voided: Boolean(r.voided),
    voided_at: r.voided_at ?? null,
    voided_by: r.voided_by ?? null,
    notes: r.notes ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getCashFlowAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ canWrite: boolean; canVoid: boolean; baseCurrency: string | null }> => {
      requireSupabaseAuth(context);
      const canWrite = await hasAnyRole(context, WRITE_ROLES);
      const canVoid = await hasAnyRole(context, ["finance_admin"]);
      return { canWrite, canVoid, baseCurrency: null };
    },
  );

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export const listCashFlows = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listCashFlowsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ rows: CashFlowRow[]; baseCurrency: string }> => {
    requireSupabaseAuth(context);
    await loadProject(context, data.projectId);
    const baseCurrency = await loadBaseCurrency(context, data.projectId);
    let q = context.supabase
      .from("cash_flows")
      .select("*")
      .eq("project_id", data.projectId)
      .order("period", { ascending: true });
    if (data.from) q = q.gte("period", normalizePeriod(data.from));
    if (data.to) q = q.lte("period", normalizePeriod(data.to));
    if (!data.includeVoided) q = q.eq("voided", false);
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow), baseCurrency };
  });

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export const createCashFlow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createCashFlowSchema.parse(input))
  .handler(async ({ data, context }): Promise<CashFlowRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);
    const baseCurrency = await loadBaseCurrency(context, project.id);
    const period = normalizePeriod(data.period);
    await assertPeriodOpen(context.supabase, project.company_id, period, {
      entity: "cash_flows",
      projectId: project.id,
    });

    const fxRate = await resolveFxRate(context, data.currencyCode, baseCurrency, period);
    const amountBase = Number((data.amount * fxRate).toFixed(2));

    const insert = {
      company_id: project.company_id,
      project_id: project.id,
      period,
      direction: data.direction,
      kind: data.kind,
      category: data.category,
      amount: data.amount,
      currency_code: data.currencyCode,
      fx_rate_to_base: fxRate,
      amount_base: amountBase,
      base_currency_code: baseCurrency,
      reference_type: data.referenceType ?? null,
      reference_id: data.referenceId ?? null,
      notes: data.notes ?? null,
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("cash_flows")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRow(inserted);
    await audit(context, "cash_flow.create", row.id, {
      project_id: project.id,
      period: row.period,
      direction: row.direction,
      kind: row.kind,
      category: row.category,
      amount: row.amount,
      currency_code: row.currency_code,
      fx_rate_to_base: row.fx_rate_to_base,
      amount_base: row.amount_base,
      base_currency_code: row.base_currency_code,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Void (finance_admin only)
// ---------------------------------------------------------------------------
export const voidCashFlow = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => voidCashFlowSchema.parse(input))
  .handler(async ({ data, context }): Promise<CashFlowRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, ["finance_admin"])))
      httpError(403, "forbidden", "Only finance admins can void cash-flow entries.");
    const { data: existing, error: exErr } = await context.supabase
      .from("cash_flows")
      .select("id, project_id, period, company_id, voided")
      .eq("id", data.id)
      .maybeSingle();
    if (exErr) throw exErr;
    if (!existing) httpError(404, "not_found");
    if ((existing as any).voided) httpError(409, "already_voided");
    await assertPeriodOpen(
      context.supabase,
      (existing as any).company_id,
      (existing as any).period,
      {
        entity: "cash_flows",
        entityId: (existing as any).id,
        projectId: (existing as any).project_id ?? null,
      },
    );

    const { data: updated, error } = await context.supabase
      .from("cash_flows")
      .update({
        voided: true,
        voided_at: new Date().toISOString(),
        voided_by: (context as any).user.id,
      } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRow(updated);
    await audit(context, "cash_flow.void", row.id, {
      project_id: row.project_id,
      reason: data.reason ?? null,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Currencies helper (for entry dialog)
// ---------------------------------------------------------------------------
export const listCurrencies = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({ context }): Promise<Array<{ code: string; name: string; symbol: string | null }>> => {
      requireSupabaseAuth(context);
      const { data, error } = await context.supabase
        .from("currencies")
        .select("code, name, symbol")
        .order("code", { ascending: true });
      if (error) throw error;
      return (data ?? []) as any;
    },
  );
