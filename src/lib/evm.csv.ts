// P-076 — CSV export for EVM snapshots.
import type { EvmSnapshotRow } from "@/lib/evm.functions";

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildEvmCsv(rows: EvmSnapshotRow[]): string {
  const header = [
    "snapshot_date",
    "currency",
    "BAC",
    "PV",
    "EV",
    "AC",
    "SPI",
    "CPI",
    "EAC",
    "source",
  ].join(",");
  const body = rows
    .map((r) =>
      [
        r.snapshot_date,
        r.currency_code,
        r.budget_at_completion.toFixed(2),
        r.planned_value.toFixed(2),
        r.earned_value.toFixed(2),
        r.actual_cost.toFixed(2),
        r.spi == null ? "" : r.spi.toFixed(3),
        r.cpi == null ? "" : r.cpi.toFixed(3),
        r.estimate_at_completion == null ? "" : r.estimate_at_completion.toFixed(2),
        r.source,
      ]
        .map(esc)
        .join(","),
    )
    .join("\n");
  return `${header}\n${body}\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
