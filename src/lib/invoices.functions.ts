// P-080 — Invoices server functions: list / detail / mark-paid (with 3WM guard) /
// milestone billing. Extends P-079's read-only getInvoice.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import type { ContractRow, SovLine } from "@/lib/contracts.rules";
import {
  INVOICE_DIRECTIONS,
  INVOICE_STATUSES,
  MarkInvoicePaidSchema,
  MilestoneBillSchema,
  computeMilestoneBill,
  milestoneLabelFor,
  sumPriorBilledPerLine,
  type InvoiceDirection,
  type InvoiceStatus,
} from "@/lib/invoices.rules";
import { invoiceBalance, isOverdue, todayIso } from "@/lib/payments.rules";

const FINANCE_ROLES = ["finance_admin", "company_admin"] as const;

function httpError(status: number, code: string, message?: string, extra?: unknown): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code, ...(extra ? { extra } : {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(ctx: AuthContext, roles: readonly string[]): Promise<boolean> {
  const r = await Promise.all(
    roles.map((role) => ctx.supabase.rpc("has_company_role", { p_role: role as any })),
  );
  return r.some((x) => Boolean(x?.data));
}

async function currentCompanyId(ctx: AuthContext & { user: { id: string } }): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  const id = (data as any)?.company_id as string | undefined;
  if (!id) httpError(400, "no_company", "User is not linked to a company.");
  return id!;
}

async function audit(
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

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  direction: InvoiceDirection;
  status: InvoiceStatus;
  amount: number;
  tax_amount: number;
  currency_code: string;
  issue_date: string | null;
  due_date: string | null;
  paid_at: string | null;
  milestone_label: string | null;
  retention_pct: number;
  contract_id: string | null;
  project_id: string | null;
  vendor_id: string | null;
  created_at: string;
  paid_amount: number;
  last_payment_at: string | null;
  /** Computed in the query layer — never stored. */
  balance: number;
  overdue: boolean;
}

function toRow(r: any): InvoiceRow {
  return {
    id: r.id,
    invoice_number: r.invoice_number,
    direction: r.direction,
    status: r.status,
    amount: Number(r.amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    currency_code: r.currency_code,
    issue_date: r.issue_date ?? null,
    due_date: r.due_date ?? null,
    paid_at: r.paid_at ?? null,
    milestone_label: r.milestone_label ?? null,
    retention_pct: Number(r.retention_pct ?? 0),
    contract_id: r.contract_id ?? null,
    project_id: r.project_id ?? null,
    vendor_id: r.vendor_id ?? null,
    created_at: r.created_at,
    paid_amount: Number(r.paid_amount ?? 0),
    last_payment_at: r.last_payment_at ?? null,
    balance: invoiceBalance({
      amount: Number(r.amount ?? 0),
      tax_amount: Number(r.tax_amount ?? 0),
      paid_amount: Number(r.paid_amount ?? 0),
    }),
    overdue: isOverdue(
      {
        amount: Number(r.amount ?? 0),
        tax_amount: Number(r.tax_amount ?? 0),
        paid_amount: Number(r.paid_amount ?? 0),
        status: r.status,
        due_date: r.due_date ?? null,
      },
      todayIso(),
    ),
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getInvoicesAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyRole(context, FINANCE_ROLES) };
  });

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export const listInvoices = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid().optional(),
        direction: z.enum(INVOICE_DIRECTIONS).optional(),
        status: z.enum(INVOICE_STATUSES).optional(),
        q: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ rows: InvoiceRow[] }> => {
    requireSupabaseAuth(context);
    let query = context.supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.project_id) query = query.eq("project_id", data.project_id);
    if (data.direction) query = query.eq("direction", data.direction);
    if (data.status) query = query.eq("status", data.status);
    if (data.q && data.q.trim()) {
      const like = `%${data.q.trim().replace(/[%_]/g, "\\$&")}%`;
      query = query.or(`invoice_number.ilike.${like},milestone_label.ilike.${like}`);
    }
    const { data: rows, error } = await query;
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

// ---------------------------------------------------------------------------
// Detail: invoice + contract + linked pay app + debit note aggregate + match block state
// ---------------------------------------------------------------------------
export interface InvoiceDetail {
  invoice: InvoiceRow;
  contract: { id: string; contract_number: string; title: string } | null;
  pay_app: { id: string; application_number: number } | null;
  debit_notes_open_sum: number;
  payment_release_blocked: boolean;
  blocked_match_ids: string[];
}

export const getInvoiceDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvoiceDetail> => {
    requireSupabaseAuth(context);
    const { data: r, error } = await context.supabase
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!r) httpError(404, "not_found");
    const invoice = toRow(r);

    const [contractRes, payAppRes, dnRes, matchRes] = await Promise.all([
      invoice.contract_id
        ? context.supabase
            .from("contracts")
            .select("id, contract_number, title")
            .eq("id", invoice.contract_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as const),
      context.supabase
        .from("pay_applications")
        .select("id, application_number")
        .eq("invoice_id", invoice.id)
        .maybeSingle(),
      context.supabase.from("debit_notes").select("amount, status").eq("invoice_id", invoice.id),
      invoice.direction === "payable"
        ? context.supabase
            .from("three_way_matches")
            .select("id, payment_release_blocked")
            .eq("invoice_id", invoice.id)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (contractRes && "error" in contractRes && contractRes.error) throw contractRes.error;
    if (payAppRes.error) throw payAppRes.error;
    if (dnRes.error) throw dnRes.error;
    if ("error" in matchRes && matchRes.error) throw matchRes.error;

    const openSum = ((dnRes.data ?? []) as { amount: number; status: string }[])
      .filter((d) => d.status === "issued" || d.status === "settled")
      .reduce((acc, d) => acc + Number(d.amount || 0), 0);
    const blocked = (
      (matchRes.data ?? []) as { id: string; payment_release_blocked: boolean }[]
    ).filter((m) => m.payment_release_blocked);

    return {
      invoice,
      contract: (contractRes.data as any) ?? null,
      pay_app: (payAppRes.data as any) ?? null,
      debit_notes_open_sum: openSum,
      payment_release_blocked: blocked.length > 0,
      blocked_match_ids: blocked.map((m) => m.id),
    };
  });

// ---------------------------------------------------------------------------
// Mark paid — payable invoices run 3-way match guard
// ---------------------------------------------------------------------------
export const markInvoicePaid = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => MarkInvoicePaidSchema.parse(input))
  .handler(async ({ data, context }): Promise<InvoiceRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const { data: cur, error } = await context.supabase
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!cur) httpError(404, "not_found");
    const invoice = toRow(cur);
    if (invoice.status === "paid") httpError(400, "already_paid");
    if (invoice.status === "cancelled") httpError(400, "cancelled");

    if (invoice.direction === "payable") {
      const { data: matches, error: mErr } = await context.supabase
        .from("three_way_matches")
        .select("id, payment_release_blocked")
        .eq("invoice_id", invoice.id);
      if (mErr) throw mErr;
      const blocked = (
        (matches ?? []) as { id: string; payment_release_blocked: boolean }[]
      ).filter((m) => m.payment_release_blocked);
      if (blocked.length > 0) {
        await audit(context, "invoice.pay_blocked", "invoices", invoice.id, {
          blocked_match_ids: blocked.map((m) => m.id),
        });
        httpError(
          422,
          "payment_release_blocked",
          "Payment release blocked by 3-way match variance.",
          { blocked_match_ids: blocked.map((m) => m.id) },
        );
      }
    }

    const paidAt = data.paid_at ? new Date(`${data.paid_at}T00:00:00Z`) : new Date();
    const { data: upd, error: uErr } = await context.supabase
      .from("invoices")
      .update({ status: "paid", paid_at: paidAt.toISOString() })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (uErr) throw uErr;
    const row = toRow(upd);
    await audit(context, "invoice.pay", "invoices", row.id, {
      amount: row.amount,
      currency: row.currency_code,
      direction: row.direction,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Milestone billing — receivable draft invoice against a contract SOV line
// ---------------------------------------------------------------------------
function nextInvoiceNumberFrom(existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^INV-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

export const billMilestone = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => MilestoneBillSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ invoice: InvoiceRow; capped: boolean; cappedPct: number }> => {
      requireSupabaseAuth(context);
      if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
      const companyId = await currentCompanyId(context as AuthContext & { user: { id: string } });

      const { data: cRaw, error: cErr } = await context.supabase
        .from("contracts")
        .select("*")
        .eq("id", data.contract_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!cRaw) httpError(404, "contract_not_found");
      const contract = cRaw as ContractRow;
      if (!["signed", "active"].includes(contract.status)) {
        httpError(400, "contract_not_signed", "Contract must be signed or active.");
      }
      const sov = (
        Array.isArray(contract.schedule_of_values) ? (contract.schedule_of_values as SovLine[]) : []
      ) as SovLine[];
      const line = sov.find((l) => l.line_no === data.sov_line_no);
      if (!line) httpError(404, "sov_line_not_found");

      const { data: prior, error: pErr } = await context.supabase
        .from("invoices")
        .select("milestone_label, amount, status")
        .eq("contract_id", data.contract_id)
        .eq("direction", "receivable");
      if (pErr) throw pErr;
      const byLine = sumPriorBilledPerLine((prior ?? []) as any[]);
      const prevBilled = byLine.get(data.sov_line_no) ?? 0;

      const comp = computeMilestoneBill(line.scheduled_amount, prevBilled, data.pct_to_bill);

      const { data: nums, error: nErr } = await context.supabase
        .from("invoices")
        .select("invoice_number")
        .eq("company_id", companyId);
      if (nErr) throw nErr;
      const invoiceNumber = nextInvoiceNumberFrom(
        ((nums ?? []) as any[]).map((x) => String(x.invoice_number)),
      );

      const { data: ins, error: iErr } = await context.supabase
        .from("invoices")
        .insert({
          company_id: companyId,
          project_id: contract.project_id,
          contract_id: contract.id,
          invoice_number: invoiceNumber,
          direction: "receivable",
          status: "draft",
          amount: comp.amount,
          currency_code: contract.currency_code ?? "USD",
          issue_date: new Date().toISOString().slice(0, 10),
          milestone_label: milestoneLabelFor(line.line_no, line.description, comp.cappedPct),
          created_by: context.user!.id,
        } as any)
        .select("*")
        .maybeSingle();
      if (iErr) throw iErr;
      const row = toRow(ins);
      await audit(context, "invoice.milestone_bill", "invoices", row.id, {
        contract_id: contract.id,
        sov_line_no: line.line_no,
        requested_pct: data.pct_to_bill,
        capped_pct: comp.cappedPct,
        amount: comp.amount,
        hit_cap: comp.hitCap,
      });
      return { invoice: row, capped: comp.hitCap, cappedPct: comp.cappedPct };
    },
  );

// ---------------------------------------------------------------------------
// Milestone summary for the "Bill milestone" dialog
// ---------------------------------------------------------------------------
export interface SovBillingSummary {
  line_no: number;
  description: string;
  scheduled_amount: number;
  billed: number;
  remaining: number;
  pct_billed: number;
}

export const getContractBillingSummary = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ contract_id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      lines: SovBillingSummary[];
      currency_code: string | null;
      status: string;
    }> => {
      requireSupabaseAuth(context);
      const { data: cRaw, error: cErr } = await context.supabase
        .from("contracts")
        .select("id, status, currency_code, schedule_of_values")
        .eq("id", data.contract_id)
        .maybeSingle();
      if (cErr) throw cErr;
      if (!cRaw) httpError(404, "contract_not_found");
      const sov = (
        Array.isArray((cRaw as any).schedule_of_values)
          ? ((cRaw as any).schedule_of_values as SovLine[])
          : []
      ) as SovLine[];
      const { data: prior, error: pErr } = await context.supabase
        .from("invoices")
        .select("milestone_label, amount, status")
        .eq("contract_id", data.contract_id)
        .eq("direction", "receivable");
      if (pErr) throw pErr;
      const byLine = sumPriorBilledPerLine((prior ?? []) as any[]);
      const lines: SovBillingSummary[] = sov.map((l) => {
        const billed = byLine.get(l.line_no) ?? 0;
        const rem = Math.max(0, l.scheduled_amount - billed);
        const pct = l.scheduled_amount > 0 ? (billed / l.scheduled_amount) * 100 : 0;
        return {
          line_no: l.line_no,
          description: l.description,
          scheduled_amount: l.scheduled_amount,
          billed,
          remaining: rem,
          pct_billed: Math.round(pct * 100) / 100,
        };
      });
      return {
        lines,
        currency_code: (cRaw as any).currency_code ?? null,
        status: (cRaw as any).status as string,
      };
    },
  );

// Keep the P-079 read-only fetcher for backwards compatibility.
export const getInvoice = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<InvoiceRow | null> => {
    requireSupabaseAuth(context);
    const { data: r, error } = await context.supabase
      .from("invoices")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    return r ? toRow(r) : null;
  });
