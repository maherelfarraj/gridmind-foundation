// P-194 — Payment recording + invoice lifecycle v2 server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { toCsv } from "@/lib/csv";
import { assertExportAllowed } from "@/lib/export-guard";
import { assertPeriodOpen } from "@/lib/finance/periods";
import {
  ApproveInvoiceSchema,
  ListPaymentsSchema,
  MarkInvoiceSentSchema,
  RecordPaymentSchema,
  VoidPaymentSchema,
  canApproveInvoice,
  invoiceBalance,
  paymentMethodLabel,
  reconciliationLabel,
  todayIso,
} from "@/lib/payments.rules";
import {
  FINANCE_ROLES,
  PAYABLE_PAYMENT_ROLES,
  applyPaymentToInvoice,
  assertMatchNotBlocked,
  assertPaymentAllowed,
  audit,
  hasAnyRole,
  httpError,
  loadInvoiceForPayment,
  rethrowInsertError,
  reversePaymentOnInvoice,
  queryPayments,
  toPaymentRow,
  type PaymentRow,
} from "@/lib/payments.server";

export type { PaymentRow };

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getPaymentsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canFinance: boolean; canPayable: boolean }> => {
    requireSupabaseAuth(context);
    const [canFinance, canPayable] = await Promise.all([
      hasAnyRole(context, FINANCE_ROLES),
      hasAnyRole(context, PAYABLE_PAYMENT_ROLES),
    ]);
    return { canFinance, canPayable };
  });

// ---------------------------------------------------------------------------
// Record payment
// ---------------------------------------------------------------------------
export const recordPayment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => RecordPaymentSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ payment: PaymentRow; invoice_status: string; balance_after: number }> => {
      requireSupabaseAuth(context);
      const invoice = await loadInvoiceForPayment(context, data.invoice_id);

      // procurement_admin may record payments on payable invoices only.
      const roles = invoice.direction === "payable" ? PAYABLE_PAYMENT_ROLES : FINANCE_ROLES;
      if (!(await hasAnyRole(context, roles))) httpError(403, "forbidden");

      await assertPeriodOpen(context.supabase, invoice.company_id, data.payment_date);
      assertPaymentAllowed(invoice, data.amount);
      await assertMatchNotBlocked(context, invoice);

      const { data: ins, error } = await context.supabase
        .from("payments")
        .insert({
          company_id: invoice.company_id,
          invoice_id: invoice.id,
          amount: data.amount,
          currency_code: data.currency_code ?? invoice.currency_code,
          payment_date: data.payment_date,
          method: data.method,
          bank_reference: data.bank_reference ?? null,
          notes: data.notes ?? null,
          received_by: context.user!.id,
        } as never)
        .select("*")
        .maybeSingle();
      if (error) rethrowInsertError(error);
      const payment = toPaymentRow(ins as Record<string, unknown>);

      const applied = await applyPaymentToInvoice(context, invoice, data.amount);
      await audit(context, "payment.record", "payments", payment.id, {
        invoice_id: invoice.id,
        amount: data.amount,
        balance_after: applied.balance_after,
      });

      // P-269 — payment advice to the counterparty (non-blocking side effect).
      const { notify, recipientLocale, vendorEmail } = await import("@/lib/email/dispatch.server");
      const payee = await vendorEmail(
        context.supabase,
        (invoice as unknown as { vendor_id?: string | null }).vendor_id,
      );
      await notify({
        event: "payment",
        to: payee,
        companyId: invoice.company_id,
        entity: "payments",
        entityId: payment.id,
        actorId: context.user?.id ?? null,
        locale: await recipientLocale(context.supabase, payee ?? ""),
        params: {
          invoice_number: (invoice as unknown as { invoice_number?: string }).invoice_number ?? "",
          amount: data.amount,
          currency: payment.currency_code,
          payment_date: data.payment_date,
          balance_after: applied.balance_after,
          method: data.method,
        },
      });

      return {
        payment,
        invoice_status: applied.status,
        balance_after: applied.balance_after,
      };
    },
  );

// ---------------------------------------------------------------------------
// Void payment
// ---------------------------------------------------------------------------
export const voidPayment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => VoidPaymentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ invoice_status: string; paid_amount: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");

    const { data: pRaw, error } = await context.supabase
      .from("payments")
      .select("*")
      .eq("id", data.payment_id)
      .maybeSingle();
    if (error) throw error;
    if (!pRaw) httpError(404, "payment_not_found");
    const payment = toPaymentRow(pRaw as Record<string, unknown>);
    if (payment.record_status === "voided") httpError(422, "already_voided");
    await assertPeriodOpen(
      context.supabase,
      (pRaw as { company_id: string }).company_id,
      payment.payment_date,
    );

    const { error: vErr } = await context.supabase
      .from("payments")
      .update({
        record_status: "voided",
        voided_reason: data.reason,
        voided_by: context.user!.id,
        voided_at: new Date().toISOString(),
      } as never)
      .eq("id", payment.id);
    if (vErr) throw vErr;

    const invoice = await loadInvoiceForPayment(context, payment.invoice_id);
    const next = await reversePaymentOnInvoice(context, invoice, payment.amount);
    await audit(context, "payment.void", "payments", payment.id, {
      invoice_id: payment.invoice_id,
      amount: payment.amount,
      reason: data.reason,
      invoice_status: next.status,
    });
    return { invoice_status: next.status, paid_amount: next.paid_amount };
  });

// ---------------------------------------------------------------------------
// Approve (draft | submitted → approved)
// ---------------------------------------------------------------------------
export const approveInvoice = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ApproveInvoiceSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const invoice = await loadInvoiceForPayment(context, data.invoice_id);
    if (invoice.status === "approved") return { status: "approved" };
    if (!canApproveInvoice(invoice.status)) {
      httpError(
        422,
        "invalid_transition",
        `Invoice status "${invoice.status}" cannot be approved.`,
      );
    }
    await assertPeriodOpen(context.supabase, invoice.company_id, todayIso());
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "approved" } as never)
      .eq("id", invoice.id);
    if (error) throw error;
    await audit(context, "invoice.approve", "invoices", invoice.id, {
      invoice_number: invoice.invoice_number,
      from_status: invoice.status,
    });
    return { status: "approved" };
  });

// ---------------------------------------------------------------------------
// Mark sent (approved → sent)
// ---------------------------------------------------------------------------
export const markInvoiceSent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => MarkInvoiceSentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, FINANCE_ROLES))) httpError(403, "forbidden");
    const invoice = await loadInvoiceForPayment(context, data.invoice_id);
    if (invoice.status !== "approved") {
      httpError(422, "invalid_transition", "Only approved invoices can be marked as sent.");
    }
    await assertPeriodOpen(context.supabase, invoice.company_id, todayIso());
    const { error } = await context.supabase
      .from("invoices")
      .update({ status: "sent" } as never)
      .eq("id", invoice.id);
    if (error) throw error;
    await audit(context, "invoice.send", "invoices", invoice.id, {
      invoice_number: invoice.invoice_number,
    });
    return { status: "sent" };
  });

// ---------------------------------------------------------------------------
// Payment history for one invoice
// ---------------------------------------------------------------------------
export const listInvoicePayments = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ invoice_id: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: PaymentRow[]; paid_amount: number; balance: number }> => {
      requireSupabaseAuth(context);
      const [payRes, invoice] = await Promise.all([
        context.supabase
          .from("payments")
          .select("*")
          .eq("invoice_id", data.invoice_id)
          .order("payment_date", { ascending: false }),
        loadInvoiceForPayment(context, data.invoice_id),
      ]);
      if (payRes.error) throw payRes.error;
      return {
        rows: ((payRes.data ?? []) as Record<string, unknown>[]).map(toPaymentRow),
        paid_amount: invoice.paid_amount,
        balance: invoiceBalance(invoice),
      };
    },
  );

// ---------------------------------------------------------------------------
// Payments register (server-filtered)
// ---------------------------------------------------------------------------
export const listPayments = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListPaymentsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ rows: PaymentRow[] }> => {
    requireSupabaseAuth(context);
    return { rows: await queryPayments(context, data) };
  });

// ---------------------------------------------------------------------------
// CSV export — gated by P-113 export locks
// ---------------------------------------------------------------------------
export const exportPaymentsCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListPaymentsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ csv: string; filename: string }> => {
    requireSupabaseAuth(context);
    await assertExportAllowed(context.supabase as never, data.project_id ?? null, "csv");
    const rows = await queryPayments(context, data);
    const csv = toCsv(
      [
        "payment_number",
        "invoice_number",
        "direction",
        "project",
        "payment_date",
        "method",
        "amount",
        "currency_code",
        "amount_base",
        "base_currency_code",
        "bank_reference",
        "reconciliation",
        "status",
      ],
      rows.map((r) => [
        r.payment_number,
        r.invoice_number ?? "",
        r.direction,
        r.project_name ?? "",
        r.payment_date,
        paymentMethodLabel(r.method),
        r.amount.toFixed(2),
        r.currency_code,
        r.amount_base === null ? "" : r.amount_base.toFixed(2),
        r.base_currency_code ?? "",
        r.bank_reference ?? "",
        reconciliationLabel(r.reconciliation_status),
        r.record_status,
      ]),
    );
    return { csv, filename: `payments-${new Date().toISOString().slice(0, 10)}.csv` };
  });
