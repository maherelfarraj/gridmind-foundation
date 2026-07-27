// P-198 — Bank reconciliation I/O helpers (kept out of *.functions.ts).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { audit, hasAnyRole, httpError, toPaymentRow, type PaymentRow } from "@/lib/payments.server";
import {
  monthRange,
  summarize,
  type ListReconciliationInput,
  type ReconStatus,
  type ReconSummary,
  type ReconTarget,
} from "@/lib/reconciliation.rules";

export const RECON_FULL_ROLES = ["finance_admin", "company_admin"] as const;
export const RECON_PAYABLE_ROLES = ["procurement_admin"] as const;

export interface ReconAccess {
  canAll: boolean;
  canPayableOnly: boolean;
  canWrite: boolean;
}

export async function resolveReconAccess(ctx: AuthContext): Promise<ReconAccess> {
  const [canAll, payable] = await Promise.all([
    hasAnyRole(ctx, RECON_FULL_ROLES),
    hasAnyRole(ctx, RECON_PAYABLE_ROLES),
  ]);
  const canPayableOnly = !canAll && payable;
  return { canAll, canPayableOnly, canWrite: canAll || canPayableOnly };
}

export function assertCanReconcile(access: ReconAccess, direction: string): void {
  if (access.canAll) return;
  if (access.canPayableOnly && direction === "payable") return;
  if (access.canPayableOnly) {
    httpError(403, "forbidden", "Procurement admins may reconcile payable payments only.");
  }
  httpError(403, "forbidden", "You do not have permission to reconcile payments.");
}

/** All recorded + voided payments in the month, with invoice/project labels. */
export async function loadMonthPayments(
  ctx: AuthContext,
  month: string,
): Promise<PaymentRow[]> {
  const { from, to } = monthRange(month);
  const { data, error } = await ctx.supabase
    .from("payments")
    .select("*, invoices(invoice_number), projects(name)")
    .gte("payment_date", from)
    .lte("payment_date", to)
    .order("payment_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(toPaymentRow);
}

export function filterReconRows(
  rows: PaymentRow[],
  filters: Pick<ListReconciliationInput, "status" | "direction">,
): PaymentRow[] {
  return rows.filter((r) => {
    if (filters.status !== "all" && r.reconciliation_status !== filters.status) return false;
    if (filters.direction !== "all" && r.direction !== filters.direction) return false;
    return true;
  });
}

export function summarizeMonth(rows: PaymentRow[]): ReconSummary {
  return summarize(
    rows.map((r) => ({
      reconciliation_status: r.reconciliation_status as ReconStatus,
      record_status: r.record_status,
      amount: r.amount,
    })),
  );
}

/** Fetch payments by id and guard voided / non-transitionable rows. */
export async function loadReconcilablePayments(
  ctx: AuthContext,
  ids: string[],
  opts: { requireSourceStatuses?: readonly string[] } = {},
): Promise<PaymentRow[]> {
  const { data, error } = await ctx.supabase
    .from("payments")
    .select("*, invoices(invoice_number), projects(name)")
    .in("id", ids);
  if (error) throw error;
  const rows = ((data ?? []) as Record<string, unknown>[]).map(toPaymentRow);
  if (rows.length !== ids.length) {
    httpError(404, "payment_not_found", "One or more payments were not found in your company.");
  }
  const voided = rows.filter((r) => r.record_status === "voided");
  if (voided.length > 0) {
    httpError(
      422,
      "payment_voided",
      `Voided payments cannot be reconciled (${voided.map((v) => v.payment_number).join(", ")}).`,
    );
  }
  if (opts.requireSourceStatuses) {
    const bad = rows.filter(
      (r) => !opts.requireSourceStatuses!.includes(r.reconciliation_status as string),
    );
    if (bad.length > 0) {
      httpError(
        422,
        "invalid_source_status",
        `Only unmatched or partial payments can be bulk-updated (${bad
          .map((b) => b.payment_number)
          .join(", ")}).`,
      );
    }
  }
  return rows;
}

export interface ReconPatch {
  id: string;
  from: ReconStatus;
  bank_reference: string | null;
  note: string | null;
}

/** Apply one status to many payments in a single statement, then audit each. */
export async function applyReconciliation(
  ctx: AuthContext,
  patches: ReconPatch[],
  status: ReconTarget,
): Promise<void> {
  // Grouped by the values that differ so each statement stays atomic.
  for (const p of patches) {
    const patch: Record<string, unknown> = { reconciliation_status: status };
    if (p.bank_reference !== null) patch.bank_reference = p.bank_reference;
    if (p.note !== null) patch.notes = p.note;
    const { error } = await ctx.supabase
      .from("payments")
      .update(patch as never)
      .eq("id", p.id);
    if (error) throw error;
  }
  await Promise.all(
    patches.map((p) =>
      audit(ctx, "payment.reconcile", "payments", p.id, {
        payment_id: p.id,
        from: p.from,
        to: status,
        bank_reference: p.bank_reference,
        ...(p.note ? { note: p.note } : {}),
      }),
    ),
  );
}

export async function auditBulk(
  ctx: AuthContext,
  count: number,
  status: ReconTarget,
): Promise<void> {
  await audit(ctx, "payment.reconcile_bulk", "payments", null, { count, status });
}
