// P-080 — Invoices CSV export.
import { toCsv } from "@/lib/csv";
import { invoiceStatusLabel, type InvoiceRow } from "@/lib/invoices.rules";
import type { InvoiceRow as _R } from "@/lib/invoices.functions";

// Reuse the runtime InvoiceRow shape from either module (they match).
type Row = _R;

export function toInvoicesCsv(rows: readonly Row[]): string {
  return toCsv(
    [
      "invoice_number",
      "direction",
      "status",
      "project_id",
      "contract_id",
      "amount",
      "tax_amount",
      "currency_code",
      "milestone_label",
      "issue_date",
      "due_date",
      "paid_at",
      "created_at",
    ],
    rows.map((r) => [
      r.invoice_number,
      r.direction,
      invoiceStatusLabel(r.status),
      r.project_id ?? "",
      r.contract_id ?? "",
      r.amount.toFixed(2),
      r.tax_amount.toFixed(2),
      r.currency_code,
      r.milestone_label ?? "",
      r.issue_date ?? "",
      r.due_date ?? "",
      r.paid_at ?? "",
      r.created_at,
    ]),
  );
}
// Silence the unused import.
export type { InvoiceRow } from "@/lib/invoices.rules";
