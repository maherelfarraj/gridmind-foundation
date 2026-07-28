// P-194 — Payment server helpers (I/O). Kept out of *.functions.ts so the
// server-fn splitter never drops module-scope siblings.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  acceptsPayment,
  invoiceBalance,
  invoiceTotal,
  isOverdue,
  isOverpayment,
  statusAfterPayment,
  statusAfterVoid,
  todayIso,
  type PaymentMethod,
  type PaymentRecordStatus,
  type ReconciliationStatus,
} from "@/lib/payments.rules";

export const FINANCE_ROLES = ["finance_admin", "company_admin"] as const;
export const PAYABLE_PAYMENT_ROLES = [
  "finance_admin",
  "company_admin",
  "procurement_admin",
] as const;

export function httpError(status: number, code: string, message?: string, extra?: unknown): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code, ...(extra ? { extra } : {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const r = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as never })),
  );
  return r.some((x) => Boolean(x?.data));
}

export async function audit(
  ctx: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId as never,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

export interface PaymentInvoice {
  id: string;
  company_id: string;
  project_id: string | null;
  invoice_number: string;
  direction: "receivable" | "payable";
  status: string;
  amount: number;
  tax_amount: number;
  paid_amount: number;
  currency_code: string;
  due_date: string | null;
  last_payment_at: string | null;
}

export function toPaymentInvoice(r: Record<string, unknown>): PaymentInvoice {
  return {
    id: String(r.id),
    company_id: String(r.company_id),
    project_id: (r.project_id as string) ?? null,
    invoice_number: String(r.invoice_number),
    direction: r.direction as "receivable" | "payable",
    status: String(r.status),
    amount: Number(r.amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    paid_amount: Number(r.paid_amount ?? 0),
    currency_code: String(r.currency_code),
    due_date: (r.due_date as string) ?? null,
    last_payment_at: (r.last_payment_at as string) ?? null,
  };
}

export interface PaymentRow {
  id: string;
  payment_number: string;
  invoice_id: string;
  invoice_number: string | null;
  direction: "receivable" | "payable";
  project_id: string | null;
  project_name: string | null;
  amount: number;
  currency_code: string;
  fx_rate_to_base: number | null;
  amount_base: number | null;
  base_currency_code: string | null;
  payment_date: string;
  method: PaymentMethod;
  bank_reference: string | null;
  reconciliation_status: ReconciliationStatus;
  record_status: PaymentRecordStatus;
  voided_reason: string | null;
  voided_at: string | null;
  notes: string | null;
  created_at: string;
}

export function toPaymentRow(r: Record<string, any>): PaymentRow {
  return {
    id: r.id,
    payment_number: r.payment_number ?? "—",
    invoice_id: r.invoice_id,
    invoice_number: r.invoices?.invoice_number ?? r.invoice_number ?? null,
    direction: r.direction,
    project_id: r.project_id ?? null,
    project_name: r.projects?.name ?? null,
    amount: Number(r.amount ?? 0),
    currency_code: r.currency_code,
    fx_rate_to_base: r.fx_rate_to_base === null ? null : Number(r.fx_rate_to_base),
    amount_base: r.amount_base === null ? null : Number(r.amount_base),
    base_currency_code: r.base_currency_code ?? null,
    payment_date: r.payment_date,
    method: r.method,
    bank_reference: r.bank_reference ?? null,
    reconciliation_status: r.reconciliation_status,
    record_status: r.record_status,
    voided_reason: r.voided_reason ?? null,
    voided_at: r.voided_at ?? null,
    notes: r.notes ?? null,
    created_at: r.created_at,
  };
}

export async function loadInvoiceForPayment(
  ctx: AuthContext,
  invoiceId: string,
): Promise<PaymentInvoice> {
  const { data, error } = await ctx.supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "invoice_not_found", "Invoice not found.");
  return toPaymentInvoice(data as Record<string, unknown>);
}

/** P-080 three-way-match release guard — payable invoices only. */
export async function assertMatchNotBlocked(
  ctx: AuthContext,
  invoice: PaymentInvoice,
): Promise<void> {
  if (invoice.direction !== "payable") return;
  const { data, error } = await ctx.supabase
    .from("three_way_matches")
    .select("id, payment_release_blocked")
    .eq("invoice_id", invoice.id);
  if (error) throw error;
  const blocked = ((data ?? []) as { id: string; payment_release_blocked: boolean }[]).filter(
    (m) => m.payment_release_blocked,
  );
  if (blocked.length > 0) {
    await audit(ctx, "invoice.pay_blocked", "invoices", invoice.id, {
      blocked_match_ids: blocked.map((m) => m.id),
    });
    httpError(422, "payment_release_blocked", "Payment release blocked by 3-way match variance.", {
      blocked_match_ids: blocked.map((m) => m.id),
    });
  }
}

export function assertPaymentAllowed(invoice: PaymentInvoice, amount: number): void {
  if (!acceptsPayment(invoice.status)) {
    httpError(
      422,
      "invoice_status_rejects_payment",
      `Invoice status "${invoice.status}" does not accept payments. Approve or send it first.`,
    );
  }
  if (isOverpayment(invoice, amount)) {
    httpError(
      422,
      "overpayment_blocked",
      `Overpayment blocked — balance is ${invoiceBalance(invoice).toFixed(2)} of ${invoiceTotal(
        invoice,
      ).toFixed(2)}.`,
    );
  }
}

/** Translate the DB trigger's FX guard into the canonical P-077 blocking error. */
export function rethrowInsertError(err: unknown): never {
  const message = (err as { message?: string })?.message ?? "";
  if (message.includes("fx_rate_missing")) {
    httpError(
      400,
      "no_fx_rate",
      "No FX rate for this currency on or before the payment date. Add one in FX rates.",
    );
  }
  throw err as Error;
}

/**
 * Read back the invoice payment state after a ledger write.
 * P-247: paid_amount / paid_at / paid status are DB-maintained by the
 * `payments_sync_invoice_state` trigger — the app never writes them.
 */
async function readInvoicePaymentState(
  ctx: AuthContext,
  invoiceId: string,
): Promise<{ status: string; paid_amount: number; amount: number; tax_amount: number }> {
  const { data, error } = await ctx.supabase
    .from("invoices")
    .select("status, paid_amount, amount, tax_amount")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    status: String(r.status ?? ""),
    paid_amount: Number(r.paid_amount ?? 0),
    amount: Number(r.amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
  };
}

export async function applyPaymentToInvoice(
  ctx: AuthContext,
  invoice: PaymentInvoice,
  _amount: number,
): Promise<{ status: string; paid_amount: number; balance_after: number }> {
  const next = await readInvoicePaymentState(ctx, invoice.id);
  return {
    status: next.status,
    paid_amount: next.paid_amount,
    balance_after: invoiceBalance(next),
  };
}

export async function reversePaymentOnInvoice(
  ctx: AuthContext,
  invoice: PaymentInvoice,
  _amount: number,
): Promise<{ status: string; paid_amount: number }> {
  const next = await readInvoicePaymentState(ctx, invoice.id);
  return { status: next.status, paid_amount: next.paid_amount };
}


export function decorateOverdue<
  T extends { status: string; due_date: string | null; amount: number; tax_amount: number },
>(rows: T[], paidMap: (r: T) => number): (T & { balance: number; overdue: boolean })[] {
  const today = todayIso();
  return rows.map((r) => {
    const money = { amount: r.amount, tax_amount: r.tax_amount, paid_amount: paidMap(r) };
    return {
      ...r,
      balance: invoiceBalance(money),
      overdue: isOverdue({ ...money, status: r.status, due_date: r.due_date }, today),
    };
  });
}

/** Shared register query used by both listPayments and the CSV export. */
export async function queryPayments(
  ctx: AuthContext,
  filters: {
    direction?: string;
    method?: string;
    reconciliation_status?: string;
    project_id?: string;
    date_from?: string;
    date_to?: string;
    q?: string;
  },
): Promise<PaymentRow[]> {
  let query = ctx.supabase
    .from("payments")
    .select("*, invoices(invoice_number), projects(name)")
    .order("payment_date", { ascending: false })
    .limit(500);
  if (filters.direction) query = query.eq("direction", filters.direction as never);
  if (filters.method) query = query.eq("method", filters.method as never);
  if (filters.reconciliation_status)
    query = query.eq("reconciliation_status", filters.reconciliation_status as never);
  if (filters.project_id) query = query.eq("project_id", filters.project_id);
  if (filters.date_from) query = query.gte("payment_date", filters.date_from);
  if (filters.date_to) query = query.lte("payment_date", filters.date_to);
  if (filters.q && filters.q.trim()) {
    const like = `%${filters.q.trim().replace(/[%_]/g, "\\$&")}%`;
    query = query.or(`payment_number.ilike.${like},bank_reference.ilike.${like}`);
  }
  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toPaymentRow);
}
