// P-075 — Budget CSV export.
import type { BudgetRow, CostCodeRow } from "@/lib/budget.functions";
import { variance } from "@/lib/budget.rules";

function escape(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildBudgetCsv(costCodes: CostCodeRow[], budgets: BudgetRow[]): string {
  const budgetByCode = new Map<string, BudgetRow>();
  for (const b of budgets) {
    const prev = budgetByCode.get(b.cost_code_id);
    if (!prev || b.version > prev.version) budgetByCode.set(b.cost_code_id, b);
  }
  const header = [
    "code",
    "name",
    "wbs_code",
    "wbs_name",
    "original",
    "approved_changes",
    "current",
    "committed",
    "actual",
    "variance",
    "currency",
    "active",
  ];
  const lines: string[] = [header.join(",")];
  for (const c of costCodes) {
    const b = budgetByCode.get(c.id);
    const row = [
      c.code,
      c.name,
      c.wbs_code ?? "",
      c.wbs_name ?? "",
      b?.original_amount ?? 0,
      b?.approved_changes ?? 0,
      b?.current_amount ?? 0,
      b?.committed_amount ?? 0,
      b?.actual_amount ?? 0,
      b ? variance(b.current_amount, b.committed_amount, b.actual_amount) : 0,
      b?.currency_code ?? "",
      c.is_active ? "yes" : "no",
    ];
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
