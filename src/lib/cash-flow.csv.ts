// P-077 — CSV export for cash flows.
import type { CashFlowRow } from "@/lib/cash-flow.rules";

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCashFlowCsv(rows: CashFlowRow[]): string {
  const header = [
    "period",
    "direction",
    "kind",
    "category",
    "amount",
    "currency",
    "fx_rate_to_base",
    "amount_base",
    "base_currency",
    "reference_type",
    "reference_id",
    "voided",
    "notes",
    "created_at",
  ].join(",");
  const body = rows
    .map((r) =>
      [
        r.period,
        r.direction,
        r.kind,
        r.category,
        r.amount.toFixed(2),
        r.currency_code,
        r.fx_rate_to_base == null ? "" : r.fx_rate_to_base.toFixed(6),
        r.amount_base == null ? "" : r.amount_base.toFixed(2),
        r.base_currency_code ?? "",
        r.reference_type ?? "",
        r.reference_id ?? "",
        r.voided ? "true" : "false",
        r.notes ?? "",
        r.created_at,
      ]
        .map(esc)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

export function downloadCashFlowCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
