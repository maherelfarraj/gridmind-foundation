// P-074 — CSV export for the risk register.
import type { RiskRow } from "@/lib/risks.functions";
import { ageOfRow, RISK_CATEGORY_LABEL, RISK_STATUS_LABEL } from "@/lib/risks.rules";

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildRisksCsv(rows: RiskRow[]): string {
  const header = [
    "Title",
    "Category",
    "Probability",
    "Impact",
    "Score",
    "Status",
    "Owner",
    "Identified",
    "Target close",
    "Age (days)",
    "Contingency",
    "Currency",
  ];
  const lines: string[] = [header.map(escapeCsv).join(",")];
  const today = new Date();
  for (const r of rows) {
    lines.push(
      [
        r.title,
        RISK_CATEGORY_LABEL[r.category],
        r.probability,
        r.impact,
        r.score,
        RISK_STATUS_LABEL[r.status],
        r.owner_name || r.owner_email || "",
        r.identified_at,
        r.target_close_date ?? "",
        ageOfRow(r, today),
        r.contingency_amount ?? "",
        r.currency_code ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
