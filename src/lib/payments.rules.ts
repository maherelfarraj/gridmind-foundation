// P-194 — Payment recording + invoice lifecycle v2: pure rules (no I/O, unit-testable).
import { z } from "zod";

export const PAYMENT_METHODS = ["bank_transfer", "cash", "cheque", "card", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const RECONCILIATION_STATUSES = ["unmatched", "matched", "partial", "excluded"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const PAYMENT_RECORD_STATUSES = ["recorded", "voided"] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

/** Only these invoice statuses accept payments. */
export const PAYABLE_INVOICE_STATUSES = ["approved", "sent", "partially_paid"] as const;

/** Statuses that count towards the overdue computation. */
export const OVERDUE_ELIGIBLE_STATUSES = ["approved", "sent", "partially_paid"] as const;

export const EPSILON = 0.005;

export function paymentMethodLabel(m: PaymentMethod): string {
  return {
    bank_transfer: "Bank transfer",
    cash: "Cash",
    cheque: "Cheque",
    card: "Card",
    other: "Other",
  }[m];
}

export function reconciliationLabel(s: ReconciliationStatus): string {
  return { unmatched: "Unmatched", matched: "Matched", partial: "Partial", excluded: "Excluded" }[
    s
  ];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const RecordPaymentSchema = z.object({
  invoice_id: z.string().uuid(),
  amount: z.number().finite().gt(0),
  currency_code: z.string().min(3).max(3).optional(),
  payment_date: z.string().regex(DATE_RE),
  method: z.enum(PAYMENT_METHODS),
  bank_reference: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentSchema>;

export const VoidPaymentSchema = z.object({
  payment_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const MarkInvoiceSentSchema = z.object({ invoice_id: z.string().uuid() });

export const ApproveInvoiceSchema = z.object({ invoice_id: z.string().uuid() });

/** Statuses an invoice can be approved from. */
export const APPROVABLE_INVOICE_STATUSES = ["draft", "submitted"] as const;

export function canApproveInvoice(status: string): boolean {
  return (APPROVABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}

export const ListPaymentsSchema = z.object({
  direction: z.enum(["receivable", "payable"]).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reconciliation_status: z.enum(RECONCILIATION_STATUSES).optional(),
  project_id: z.string().uuid().optional(),
  date_from: z.string().regex(DATE_RE).optional(),
  date_to: z.string().regex(DATE_RE).optional(),
  q: z.string().max(200).optional(),
});
export type ListPaymentsInput = z.infer<typeof ListPaymentsSchema>;

/* -------------------------------------------------------------------------- */
/* Money math (cents-integer so 0.1 + 0.2 doesn't drift)                      */
/* -------------------------------------------------------------------------- */

const cents = (n: number) => Math.round(Number(n || 0) * 100);
const money = (c: number) => Math.round(c) / 100;

export interface InvoiceMoney {
  amount: number;
  tax_amount: number;
  paid_amount: number;
}

/** amount_total = amount + tax_amount */
export function invoiceTotal(inv: InvoiceMoney): number {
  return money(cents(inv.amount) + cents(inv.tax_amount));
}

/** balance = amount + tax_amount - paid_amount */
export function invoiceBalance(inv: InvoiceMoney): number {
  return money(cents(inv.amount) + cents(inv.tax_amount) - cents(inv.paid_amount));
}

/** Overpayment guard: paid_amount + amount > amount_total + 0.005 */
export function isOverpayment(inv: InvoiceMoney, amount: number): boolean {
  return money(cents(inv.paid_amount) + cents(amount)) > invoiceTotal(inv) + EPSILON;
}

export function acceptsPayment(status: string): boolean {
  return (PAYABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}

/** Status after a payment lands: paid at zero balance, else partially_paid. */
export function statusAfterPayment(inv: InvoiceMoney, amount: number): "paid" | "partially_paid" {
  const newPaid = money(cents(inv.paid_amount) + cents(amount));
  return invoiceTotal(inv) - newPaid <= EPSILON ? "paid" : "partially_paid";
}

/** Status after voiding a payment: reopens paid → partially_paid / sent. */
export function statusAfterVoid(
  inv: InvoiceMoney & { status: string },
  amount: number,
): { status: string; paid_amount: number } {
  const newPaid = Math.max(0, money(cents(inv.paid_amount) - cents(amount)));
  let status = inv.status;
  if (inv.status === "paid" || inv.status === "partially_paid") {
    status = newPaid > EPSILON ? "partially_paid" : "sent";
  }
  return { status, paid_amount: newPaid };
}

/**
 * Overdue is computed, never stored:
 * due_date < today AND balance > 0 AND status in (approved|sent|partially_paid).
 */
export function isOverdue(
  inv: InvoiceMoney & { status: string; due_date: string | null },
  today: string,
): boolean {
  if (!inv.due_date) return false;
  if (!(OVERDUE_ELIGIBLE_STATUSES as readonly string[]).includes(inv.status)) return false;
  if (inv.due_date >= today) return false;
  return invoiceBalance(inv) > EPSILON;
}

export function todayIso(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Formula strings surfaced in tooltips next to every computed number. */
export const FORMULAS = {
  total: "amount_total = amount + tax_amount",
  balance: "balance = amount + tax_amount − paid_amount",
  balanceAfter: "balance after = amount + tax_amount − (paid_amount + this payment)",
  amountBase: "amount_base = amount × fx_rate_to_base (frozen at entry)",
  overdue: "overdue = due_date < today AND balance > 0",
} as const;
