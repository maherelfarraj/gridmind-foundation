// P-073 — Pure rules and zod schemas for schedule + baselines.
import { z } from "zod";
import { differenceInCalendarDays, parseISO } from "date-fns";

import { WBS_DISCIPLINES, type WbsDiscipline } from "@/lib/wbs-rules";

// ---------------------------------------------------------------------------
// Enums / types
// ---------------------------------------------------------------------------
export const SCHEDULE_TASK_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "on_hold",
  "cancelled",
] as const;
export type ScheduleTaskStatus = (typeof SCHEDULE_TASK_STATUSES)[number];

export const SCHEDULE_STATUS_LABEL: Record<ScheduleTaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
  cancelled: "Cancelled",
};

export interface ScheduleTaskLite {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
  status: ScheduleTaskStatus;
  is_milestone: boolean;
  predecessor_ids: string[];
}

export interface BaselineSnapshotEntry {
  task_id: string;
  code: string | null;
  name: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date YYYY-MM-DD");

export const scheduleTaskWritableSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  discipline: z.enum(WBS_DISCIPLINES).nullable().optional(),
  start_date: isoDate,
  end_date: isoDate,
  progress_pct: z.number().min(0).max(100),
  status: z.enum(SCHEDULE_TASK_STATUSES),
  is_milestone: z.boolean(),
  sort_order: z.number().int().min(0).max(9999).default(0),
  wbs_item_id: z.string().uuid().nullable().optional(),
  predecessor_ids: z.array(z.string().uuid()).max(50).default([]),
});

export const scheduleTaskCreateSchema = scheduleTaskWritableSchema
  .extend({
    projectId: z.string().uuid(),
  })
  .refine((v) => v.end_date >= v.start_date, {
    message: "End must be on or after start",
    path: ["end_date"],
  });

export const scheduleTaskUpdateSchema = z.object({
  id: z.string().uuid(),
  patch: scheduleTaskWritableSchema.partial(),
});

export const scheduleTaskDeleteSchema = z.object({
  id: z.string().uuid(),
});

export const baselineCreateSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const baselineLockSchema = z.object({ id: z.string().uuid() });
export const baselineDeleteSchema = z.object({ id: z.string().uuid() });

export type ScheduleTaskCreateInput = z.infer<typeof scheduleTaskCreateSchema>;
export type ScheduleTaskUpdateInput = z.infer<typeof scheduleTaskUpdateSchema>;
export type BaselineCreateInput = z.infer<typeof baselineCreateSchema>;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
export function toDate(iso: string): Date {
  return parseISO(iso);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return differenceInCalendarDays(toDate(toIso), toDate(fromIso));
}

export function isOverdue(
  row: Pick<ScheduleTaskLite, "end_date" | "progress_pct" | "status">,
  today: Date = new Date(),
): boolean {
  if (row.status === "completed" || row.status === "cancelled") return false;
  if (row.progress_pct >= 100) return false;
  return differenceInCalendarDays(today, toDate(row.end_date)) > 0;
}

// ---------------------------------------------------------------------------
// Bar color (semantic tokens only)
// ---------------------------------------------------------------------------
export function barColorForStatus(
  status: ScheduleTaskStatus,
  overdue: boolean,
): string {
  if (overdue && status === "in_progress") return "bg-destructive";
  switch (status) {
    case "completed":
      return "bg-muted-foreground";
    case "in_progress":
      return "bg-primary";
    case "on_hold":
      return "bg-warning";
    case "cancelled":
      return "bg-muted";
    case "not_started":
    default:
      return "bg-secondary";
  }
}

// ---------------------------------------------------------------------------
// Predecessor cycle detection
// ---------------------------------------------------------------------------
export function wouldCreateCycle(
  taskId: string,
  newPredecessors: string[],
  allTasks: Array<Pick<ScheduleTaskLite, "id" | "predecessor_ids">>,
): boolean {
  if (newPredecessors.includes(taskId)) return true;
  const map = new Map<string, string[]>();
  for (const t of allTasks) {
    map.set(t.id, [...(t.predecessor_ids ?? [])]);
  }
  map.set(taskId, [...newPredecessors]);

  // DFS from taskId following predecessor edges; if we ever revisit taskId → cycle.
  const stack: string[] = [taskId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    const preds = map.get(cur) ?? [];
    for (const p of preds) {
      if (p === taskId) return true;
      if (seen.has(p)) continue;
      seen.add(p);
      stack.push(p);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Snapshot + variance
// ---------------------------------------------------------------------------
export function buildSnapshotEntries(
  tasks: Array<
    Pick<
      ScheduleTaskLite,
      "id" | "name" | "start_date" | "end_date" | "progress_pct"
    > & { code?: string | null }
  >,
): BaselineSnapshotEntry[] {
  return tasks.map((t) => ({
    task_id: t.id,
    code: t.code ?? null,
    name: t.name,
    start_date: t.start_date,
    end_date: t.end_date,
    progress_pct: t.progress_pct,
  }));
}

export interface Variance {
  start_var_days: number | null;
  finish_var_days: number | null;
}

export function computeVariance(
  current: Pick<ScheduleTaskLite, "start_date" | "end_date">,
  baseline: BaselineSnapshotEntry | undefined,
): Variance {
  if (!baseline)
    return { start_var_days: null, finish_var_days: null };
  return {
    start_var_days: daysBetween(baseline.start_date, current.start_date),
    finish_var_days: daysBetween(baseline.end_date, current.end_date),
  };
}

export function baselineByTaskId(
  snapshot: BaselineSnapshotEntry[] | null | undefined,
): Map<string, BaselineSnapshotEntry> {
  const m = new Map<string, BaselineSnapshotEntry>();
  for (const s of snapshot ?? []) m.set(s.task_id, s);
  return m;
}

// ---------------------------------------------------------------------------
// KPI math
// ---------------------------------------------------------------------------
export function weightedProgress(
  tasks: Array<
    Pick<ScheduleTaskLite, "start_date" | "end_date" | "progress_pct">
  >,
): number {
  let num = 0;
  let den = 0;
  for (const t of tasks) {
    const d = Math.max(1, daysBetween(t.start_date, t.end_date) + 1);
    num += d * t.progress_pct;
    den += d;
  }
  return den === 0 ? 0 : Math.round((num / den) * 10) / 10;
}

export function avgFinishVariance(
  tasks: Array<Pick<ScheduleTaskLite, "id" | "end_date">>,
  snapshot: BaselineSnapshotEntry[] | null | undefined,
): number | null {
  if (!snapshot || snapshot.length === 0) return null;
  const map = baselineByTaskId(snapshot);
  const diffs: number[] = [];
  for (const t of tasks) {
    const b = map.get(t.id);
    if (!b) continue;
    diffs.push(daysBetween(b.end_date, t.end_date));
  }
  if (diffs.length === 0) return null;
  const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.round(avg * 10) / 10;
}

export type VarianceBand = "ok" | "warning" | "destructive";

export function bandForFinishVariance(v: number | null): VarianceBand {
  if (v == null) return "ok";
  if (v > 14) return "destructive";
  if (v > 0) return "warning";
  return "ok";
}
