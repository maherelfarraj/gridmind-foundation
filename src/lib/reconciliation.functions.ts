// P-198 — Bank reconciliation server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import type { PaymentRow } from "@/lib/payments.server";
import {
  BulkReconcileSchema,
  ReconcilePaymentSchema,
  ListReconciliationSchema,
  BULK_SOURCE_STATUSES,
  bulkReference,
  type ReconStatus,
  type ReconSummary,
} from "@/lib/reconciliation.rules";
import {
  applyReconciliation,
  assertCanReconcile,
  auditBulk,
  filterReconRows,
  loadMonthPayments,
  loadReconcilablePayments,
  resolveReconAccess,
  summarizeMonth,
  type ReconAccess,
} from "@/lib/reconciliation.server";

export const getReconciliationAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<ReconAccess> => {
    requireSupabaseAuth(context);
    return resolveReconAccess(context);
  });

export const getReconciliationMonth = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListReconciliationSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ rows: PaymentRow[]; summary: ReconSummary; month: string }> => {
      requireSupabaseAuth(context);
      const all = await loadMonthPayments(context, data.month);
      return {
        month: data.month,
        summary: summarizeMonth(all),
        rows: filterReconRows(all, data),
      };
    },
  );

export const reconcilePayment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ReconcilePaymentSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: ReconStatus; from: ReconStatus }> => {
    requireSupabaseAuth(context);
    const access = await resolveReconAccess(context);
    const [payment] = await loadReconcilablePayments(context, [data.payment_id]);
    assertCanReconcile(access, payment.direction);

    const from = payment.reconciliation_status as ReconStatus;
    await applyReconciliation(
      context,
      [
        {
          id: payment.id,
          from,
          // Re-matching replaces the stored reference when one is supplied.
          bank_reference: data.bank_reference?.trim() ? data.bank_reference.trim() : null,
          note: data.note?.trim() ? data.note.trim() : null,
        },
      ],
      data.status,
    );
    return { status: data.status, from };
  });

export const bulkReconcilePayments = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => BulkReconcileSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ updated: number; status: ReconStatus }> => {
    requireSupabaseAuth(context);
    const access = await resolveReconAccess(context);
    const rows = await loadReconcilablePayments(context, data.payment_ids, {
      requireSourceStatuses: BULK_SOURCE_STATUSES,
    });
    for (const r of rows) assertCanReconcile(access, r.direction);

    const note = data.note?.trim() ? data.note.trim() : null;
    await applyReconciliation(
      context,
      rows.map((r, i) => ({
        id: r.id,
        from: r.reconciliation_status as ReconStatus,
        bank_reference: bulkReference(data.bank_reference_prefix, i),
        note,
      })),
      data.status,
    );
    await auditBulk(context, rows.length, data.status);
    return { updated: rows.length, status: data.status };
  });

export const listReconciliationMonths = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).optional().parse(input))
  .handler(async ({ context }): Promise<{ months: string[] }> => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase
      .from("payments")
      .select("payment_date")
      .order("payment_date", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const months = Array.from(
      new Set(((data ?? []) as { payment_date: string }[]).map((r) => r.payment_date.slice(0, 7))),
    );
    return { months };
  });
