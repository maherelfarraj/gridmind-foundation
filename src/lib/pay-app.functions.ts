// P-079 — Pay applications server functions (createServerFn + zod + audit).
import { createServerFn } from "@tanstack/react-start";
import { assertPeriodOpen } from "@/lib/finance/periods";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import type { ContractRow, SovLine } from "@/lib/contracts.rules";
import {
  PayAppCreateSchema,
  PayAppLineValidationError,
  PayAppUpdateSchema,
  computePayAppTotals,
  nextInvoiceNumber,
  nextPayAppNumber,
  reconcilePayApp,
  validateCertifyInput,
  type PayAppLine,
  type PayAppRow,
  type ReconciliationResult,
} from "@/lib/pay-app.rules";

const CERTIFY_ROLES = ["project_admin", "finance_admin", "company_admin"] as const;
const APPROVE_ROLES = ["finance_admin", "company_admin"] as const;

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

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (ctx as any).user.id)
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

function toRow(r: any): PayAppRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    contract_id: r.contract_id,
    application_number: Number(r.application_number),
    period_start: r.period_start,
    period_end: r.period_end,
    status: r.status,
    lines: Array.isArray(r.lines) ? (r.lines as PayAppLine[]) : [],
    total_scheduled: Number(r.total_scheduled ?? 0),
    total_certified: Number(r.total_certified ?? 0),
    retention_pct: Number(r.retention_pct ?? 0),
    retention_amount: Number(r.retention_amount ?? 0),
    net_amount: Number(r.net_amount ?? 0),
    reconciliation: r.reconciliation ?? {},
    certified_by: r.certified_by ?? null,
    certified_at: r.certified_at ?? null,
    approved_by: r.approved_by ?? null,
    approved_at: r.approved_at ?? null,
    reject_note: r.reject_note ?? null,
    invoice_id: r.invoice_id ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toContract(r: any): ContractRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id ?? null,
    contract_number: r.contract_number,
    title: r.title,
    contract_type: r.contract_type,
    counterparty: r.counterparty,
    status: r.status,
    value: r.value == null ? null : Number(r.value),
    currency_code: r.currency_code ?? null,
    schedule_of_values: Array.isArray(r.schedule_of_values)
      ? (r.schedule_of_values as SovLine[])
      : [],
    signed_at: r.signed_at ?? null,
    effective_date: r.effective_date ?? null,
    expiry_date: r.expiry_date ?? null,
    file_path: r.file_path ?? null,
    retention_until: r.retention_until ?? null,
    created_by: r.created_by ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getPayAppAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canCertify: boolean; canApprove: boolean }> => {
    requireSupabaseAuth(context);
    const [canCertify, canApprove] = await Promise.all([
      hasAnyRole(context, CERTIFY_ROLES),
      hasAnyRole(context, APPROVE_ROLES),
    ]);
    return { canCertify, canApprove };
  });

// ---------------------------------------------------------------------------
// List / Get
// ---------------------------------------------------------------------------
export const listPayApplications = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ rows: PayAppRow[] }> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("pay_applications")
      .select("*")
      .eq("project_id", data.project_id)
      .order("application_number", { ascending: false });
    if (error) throw error;
    return { rows: ((rows ?? []) as any[]).map(toRow) };
  });

export const getPayApplication = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ payApp: PayAppRow; contract: ContractRow }> => {
    requireSupabaseAuth(context);
    const { data: r, error } = await context.supabase
      .from("pay_applications")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!r) httpError(404, "not_found");
    const payApp = toRow(r);
    const { data: c, error: cErr } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", payApp.contract_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!c) httpError(404, "contract_not_found");
    return { payApp, contract: toContract(c) };
  });

// ---------------------------------------------------------------------------
// Create — pre-fills lines from contract SOV with prev_certified carry-over
// ---------------------------------------------------------------------------
export const createPayApplication = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => PayAppCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<PayAppRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, CERTIFY_ROLES))) {
      httpError(
        403,
        "forbidden",
        "Only project/finance/company admins can create pay applications.",
      );
    }
    const companyId = await currentCompanyId(context);

    const { data: cRaw, error: cErr } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", data.contract_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cRaw) httpError(404, "contract_not_found");
    const contract = toContract(cRaw);
    if (!["signed", "active"].includes(contract.status)) {
      httpError(
        400,
        "contract_not_signed",
        "Contract must be signed or active before pay applications.",
      );
    }
    if (contract.schedule_of_values.length === 0) {
      httpError(400, "sov_empty", "Contract has no Schedule of Values to bill against.");
    }

    // Latest approved pay app for this contract → carry prev_certified.
    const { data: prev, error: pErr } = await context.supabase
      .from("pay_applications")
      .select("lines, application_number")
      .eq("contract_id", data.contract_id)
      .in("status", ["approved", "invoiced"] as any)
      .order("application_number", { ascending: false })
      .limit(1);
    if (pErr) throw pErr;
    const prevLines: PayAppLine[] = Array.isArray(prev?.[0]?.lines)
      ? (prev![0]!.lines as PayAppLine[])
      : [];
    const prevByNo = new Map<number, number>();
    for (const l of prevLines) prevByNo.set(l.sov_line_no, Number(l.total_certified || 0));

    const seededLines: PayAppLine[] = contract.schedule_of_values.map((sov) => ({
      sov_line_no: sov.line_no,
      description: sov.description,
      scheduled_amount: sov.scheduled_amount,
      prev_certified: prevByNo.get(sov.line_no) ?? 0,
      this_period: 0,
      total_certified: prevByNo.get(sov.line_no) ?? 0,
      pct_complete: 0,
    }));

    const retentionPct = data.retention_pct ?? 5;
    const totals = computePayAppTotals(seededLines, retentionPct);

    // Next per-contract application number.
    const { data: nums, error: nErr } = await context.supabase
      .from("pay_applications")
      .select("application_number")
      .eq("contract_id", data.contract_id);
    if (nErr) throw nErr;
    const appNo = nextPayAppNumber(
      ((nums ?? []) as any[]).map((r) => Number(r.application_number)),
    );

    const insert = {
      company_id: companyId,
      project_id: data.project_id,
      contract_id: data.contract_id,
      application_number: appNo,
      period_start: data.period_start,
      period_end: data.period_end,
      status: "draft",
      lines: totals.lines as any,
      total_scheduled: totals.total_scheduled,
      total_certified: totals.total_certified,
      retention_pct: retentionPct,
      retention_amount: totals.retention_amount,
      net_amount: totals.net_amount,
      created_by: (context as any).user.id,
    };
    const { data: ins, error: iErr } = await context.supabase
      .from("pay_applications")
      .insert(insert as any)
      .select("*")
      .maybeSingle();
    if (iErr) throw iErr;
    const row = toRow(ins);
    await audit(context, "pay_app.create", "pay_applications", row.id, {
      contract_id: row.contract_id,
      application_number: row.application_number,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Update lines (draft only)
// ---------------------------------------------------------------------------
export const updatePayApplicationLines = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => PayAppUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<PayAppRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, CERTIFY_ROLES))) {
      httpError(403, "forbidden");
    }
    const { data: cur, error } = await context.supabase
      .from("pay_applications")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!cur) httpError(404, "not_found");
    const row = toRow(cur);
    if (row.status !== "draft")
      httpError(400, "not_draft", "Only draft pay applications can be edited.");

    const nextLines: PayAppLine[] = row.lines.map((l) => ({
      ...l,
      this_period: Number(data.this_period_by_line_no[String(l.sov_line_no)] ?? l.this_period ?? 0),
    }));
    try {
      validateCertifyInput(nextLines);
    } catch (e) {
      if (e instanceof PayAppLineValidationError) {
        httpError(400, "line_invalid", e.message, { failures: e.failures });
      }
      throw e;
    }
    const retentionPct = data.retention_pct ?? row.retention_pct;
    const totals = computePayAppTotals(nextLines, retentionPct);
    const { data: upd, error: uErr } = await context.supabase
      .from("pay_applications")
      .update({
        lines: totals.lines as any,
        total_scheduled: totals.total_scheduled,
        total_certified: totals.total_certified,
        retention_pct: retentionPct,
        retention_amount: totals.retention_amount,
        net_amount: totals.net_amount,
      })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (uErr) throw uErr;
    const rowUpd = toRow(upd);
    await audit(context, "pay_app.update", "pay_applications", rowUpd.id, {
      total_certified: rowUpd.total_certified,
      net_amount: rowUpd.net_amount,
    });
    return rowUpd;
  });

// ---------------------------------------------------------------------------
// Certify
// ---------------------------------------------------------------------------
export const certifyPayApplication = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PayAppRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, CERTIFY_ROLES))) httpError(403, "forbidden");
    const { data: cur, error } = await context.supabase
      .from("pay_applications")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!cur) httpError(404, "not_found");
    const row = toRow(cur);
    if (row.status !== "draft")
      httpError(400, "not_draft", "Only draft pay applications can be certified.");
    await assertPeriodOpen(
      context.supabase,
      (cur as { company_id: string }).company_id,
      row.period_end,
    );
    try {
      validateCertifyInput(row.lines);
    } catch (e) {
      if (e instanceof PayAppLineValidationError) {
        httpError(400, "line_invalid", e.message, { failures: e.failures });
      }
      throw e;
    }
    const totals = computePayAppTotals(row.lines, row.retention_pct);
    const { data: upd, error: uErr } = await context.supabase
      .from("pay_applications")
      .update({
        status: "certified",
        lines: totals.lines as any,
        total_scheduled: totals.total_scheduled,
        total_certified: totals.total_certified,
        retention_amount: totals.retention_amount,
        net_amount: totals.net_amount,
        certified_by: (context as any).user.id,
        certified_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (uErr) throw uErr;
    const rowUpd = toRow(upd);
    await audit(context, "pay_app.certify", "pay_applications", rowUpd.id, {
      total_certified: rowUpd.total_certified,
      net_amount: rowUpd.net_amount,
    });
    return rowUpd;
  });

// ---------------------------------------------------------------------------
// Approve — runs server-side reconciliation gate
// ---------------------------------------------------------------------------
export const approvePayApplication = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PayAppRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, APPROVE_ROLES))) {
      httpError(403, "forbidden", "Only finance or company admins can approve pay applications.");
    }
    const { data: cur, error } = await context.supabase
      .from("pay_applications")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!cur) httpError(404, "not_found");
    const row = toRow(cur);
    if (row.status !== "certified") {
      httpError(400, "not_certified", "Only certified pay applications can be approved.");
    }
    await assertPeriodOpen(
      context.supabase,
      (cur as { company_id: string }).company_id,
      row.period_end,
    );
    const { data: cRaw, error: cErr } = await context.supabase
      .from("contracts")
      .select("*")
      .eq("id", row.contract_id)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!cRaw) httpError(404, "contract_not_found");
    const contract = toContract(cRaw);
    const totals = computePayAppTotals(row.lines, row.retention_pct);
    const rec: ReconciliationResult = reconcilePayApp({
      contract_status: contract.status,
      contract_value: contract.value,
      lines: totals.lines,
      totals,
    });

    if (!rec.ok) {
      await context.supabase
        .from("pay_applications")
        .update({ reconciliation: rec as any })
        .eq("id", data.id);
      await audit(context, "pay_app.approve_blocked", "pay_applications", row.id, {
        failures: rec.failures,
      });
      httpError(422, "reconciliation_failed", "Reconciliation blocked approval.", {
        reconciliation: rec,
      });
    }

    const { data: upd, error: uErr } = await context.supabase
      .from("pay_applications")
      .update({
        status: "approved",
        reconciliation: rec as any,
        approved_by: (context as any).user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (uErr) throw uErr;
    const rowUpd = toRow(upd);
    await audit(context, "pay_app.approve", "pay_applications", rowUpd.id, {
      reconciliation: rec,
      net_amount: rowUpd.net_amount,
    });
    return rowUpd;
  });

// ---------------------------------------------------------------------------
// Reject
// ---------------------------------------------------------------------------
export const rejectPayApplication = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), note: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PayAppRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, APPROVE_ROLES))) httpError(403, "forbidden");
    const { data: upd, error } = await context.supabase
      .from("pay_applications")
      .update({
        status: "rejected",
        reject_note: data.note,
        approved_by: (context as any).user.id,
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .in("status", ["certified", "submitted", "draft"] as any)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!upd)
      httpError(400, "not_rejectable", "Pay application cannot be rejected in its current state.");
    const row = toRow(upd);
    await audit(context, "pay_app.reject", "pay_applications", row.id, { note: data.note });
    return row;
  });

// ---------------------------------------------------------------------------
// Generate receivable invoice
// ---------------------------------------------------------------------------
export const generatePayAppInvoice = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ payApp: PayAppRow; invoice_id: string; invoice_number: string }> => {
      requireSupabaseAuth(context);
      if (!(await hasAnyRole(context, APPROVE_ROLES))) httpError(403, "forbidden");
      const companyId = await currentCompanyId(context);

      const { data: cur, error } = await context.supabase
        .from("pay_applications")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw error;
      if (!cur) httpError(404, "not_found");
      const row = toRow(cur);
      if (row.status !== "approved") {
        httpError(400, "not_approved", "Only approved pay applications can be invoiced.");
      }
      if (row.invoice_id) httpError(400, "already_invoiced");
      await assertPeriodOpen(context.supabase, companyId, new Date().toISOString().slice(0, 10));

      const { data: cRaw, error: cErr } = await context.supabase
        .from("contracts")
        .select("currency_code")
        .eq("id", row.contract_id)
        .maybeSingle();
      if (cErr) throw cErr;
      const currency = (cRaw as any)?.currency_code ?? "USD";

      const { data: existing, error: eErr } = await context.supabase
        .from("invoices")
        .select("invoice_number")
        .eq("company_id", companyId);
      if (eErr) throw eErr;
      const invoiceNumber = nextInvoiceNumber(
        ((existing ?? []) as any[]).map((r) => String(r.invoice_number)),
      );

      const { data: inv, error: iErr } = await context.supabase
        .from("invoices")
        .insert({
          company_id: companyId,
          project_id: row.project_id,
          invoice_number: invoiceNumber,
          direction: "receivable",
          status: "submitted",
          contract_id: row.contract_id,
          amount: row.net_amount,
          currency_code: currency,
          issue_date: issueDate,
          due_date: defaultDueDate(issueDate),
          milestone_label: `Pay App #${row.application_number}`,
          retention_pct: row.retention_pct,
          created_by: (context as any).user.id,
        } as any)
        .select("id, invoice_number")
        .maybeSingle();
      if (iErr) throw iErr;
      const invoiceId = (inv as any)?.id as string;

      const { data: upd, error: uErr } = await context.supabase
        .from("pay_applications")
        .update({ status: "invoiced", invoice_id: invoiceId })
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (uErr) throw uErr;

      await audit(context, "invoice.create", "invoices", invoiceId, {
        pay_app_id: row.id,
        amount: row.net_amount,
        currency,
      });
      await audit(context, "pay_app.invoice", "pay_applications", row.id, {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
      });
      return { payApp: toRow(upd), invoice_id: invoiceId, invoice_number: invoiceNumber };
    },
  );

// ---------------------------------------------------------------------------
// Signed contracts for the "new pay app" picker
// ---------------------------------------------------------------------------
export const listContractsForPayApp = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ project_id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      rows: Pick<
        ContractRow,
        "id" | "contract_number" | "title" | "value" | "currency_code" | "status"
      >[];
    }> => {
      requireSupabaseAuth(context);
      const { data: rows, error } = await context.supabase
        .from("contracts")
        .select("id, contract_number, title, value, currency_code, status")
        .eq("project_id", data.project_id)
        .in("status", ["signed", "active"] as any)
        .order("contract_number");
      if (error) throw error;
      return {
        rows: ((rows ?? []) as any[]).map((r) => ({
          id: r.id,
          contract_number: r.contract_number,
          title: r.title,
          value: r.value == null ? null : Number(r.value),
          currency_code: r.currency_code ?? null,
          status: r.status,
        })),
      };
    },
  );
