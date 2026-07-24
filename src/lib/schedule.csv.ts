// P-073 — CSV export of variance table.
import type { ScheduleTaskRow } from "@/lib/schedule.functions";
import {
  baselineByTaskId,
  computeVariance,
  type BaselineSnapshotEntry,
} from "@/lib/schedule.rules";

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildVarianceCsv(
  tasks: ScheduleTaskRow[],
  baselineName: string | null,
  snapshot: BaselineSnapshotEntry[] | null,
): string {
  const header = [
    "Task",
    "Discipline",
    "Status",
    "Progress %",
    "Start",
    "End",
    "Baseline",
    "Baseline start",
    "Baseline end",
    "Start var (days)",
    "Finish var (days)",
  ];
  const rows: string[] = [header.map(escapeCsv).join(",")];
  const map = baselineByTaskId(snapshot);
  for (const t of tasks) {
    const b = map.get(t.id);
    const v = computeVariance(t, b);
    rows.push(
      [
        t.name,
        t.discipline ?? "",
        t.status,
        t.progress_pct,
        t.start_date,
        t.end_date,
        baselineName ?? "",
        b?.start_date ?? "",
        b?.end_date ?? "",
        v.start_var_days ?? "",
        v.finish_var_days ?? "",
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  return rows.join("\n");
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
