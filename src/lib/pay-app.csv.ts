// P-079 — CSV export for pay applications list.
import { toCsv } from "@/lib/csv";
import type { PayAppRow } from "@/lib/pay-app.rules";
import { payAppStatusLabel } from "@/lib/pay-app.rules";

export function toPayAppCsv(rows: readonly PayAppRow[]): string {
  return toCsv(
    [
      "application_number",
      "contract_id",
      "period_start",
      "period_end",
      "status",
      "total_scheduled",
      "total_certified",
      "retention_pct",
      "retention_amount",
      "net_amount",
      "invoice_id",
      "created_at",
    ],
    rows.map((r) => [
      r.application_number,
      r.contract_id,
      r.period_start,
      r.period_end,
      payAppStatusLabel(r.status),
      r.total_scheduled.toFixed(2),
      r.total_certified.toFixed(2),
      r.retention_pct,
      r.retention_amount.toFixed(2),
      r.net_amount.toFixed(2),
      r.invoice_id ?? "",
      r.created_at,
    ]),
  );
}
