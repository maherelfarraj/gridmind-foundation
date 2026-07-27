// P-228 — Client-side grid state helpers. PURE module: no React, no Supabase.
import type { TimesheetActivity } from "@/lib/timesheets/policy";

export interface GridEntry {
  work_date: string;
  project_id: string | null;
  cwp_id: string | null;
  activity: string;
  hours: number;
  notes: string | null;
}

export interface GridRow {
  key: string;
  project_id: string | null;
  cwp_id: string | null;
  activity: TimesheetActivity | string;
  notes: string | null;
  /** work_date → hours */
  hours: Record<string, number>;
}

export function rowKey(project_id: string | null, cwp_id: string | null, activity: string): string {
  return `${project_id ?? "-"}|${cwp_id ?? "-"}|${activity}`;
}

/** Fold persisted entries into grid rows keyed by project/CWP/activity. */
export function toGridRows(entries: readonly GridEntry[]): GridRow[] {
  const map = new Map<string, GridRow>();
  for (const e of entries) {
    const key = rowKey(e.project_id, e.cwp_id, e.activity);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        project_id: e.project_id,
        cwp_id: e.cwp_id,
        activity: e.activity,
        notes: e.notes ?? null,
        hours: {},
      };
      map.set(key, row);
    }
    row.hours[e.work_date] = Number(e.hours) || 0;
    if (e.notes && !row.notes) row.notes = e.notes;
  }
  return [...map.values()];
}

/** Flatten grid rows back into per-cell payloads for the upsert server fn. */
export function toCells(rows: readonly GridRow[], days: readonly string[]): GridEntry[] {
  const cells: GridEntry[] = [];
  for (const row of rows) {
    for (const day of days) {
      cells.push({
        work_date: day,
        project_id: row.project_id,
        cwp_id: row.cwp_id,
        activity: row.activity,
        hours: Number(row.hours[day] ?? 0),
        notes: row.notes,
      });
    }
  }
  return cells;
}

export function clampHours(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(24, Math.max(0, Math.round(value * 100) / 100));
}
