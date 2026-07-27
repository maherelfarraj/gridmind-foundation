// P-229 — Submission guards, approval routing choice and inbox summary math.
// PURE module: no React, no Supabase, no I/O.
import {
  TIMESHEET_ACTIVITIES,
  TIMESHEET_POLICY,
  type TimesheetActivity,
} from "@/lib/timesheets/policy";
import { computeWeeklyTotals } from "@/lib/timesheets/split";
import { weekDays } from "@/lib/timesheets/week";

const TIMESHEET_ACTIVITY_SET = new Set<string>(TIMESHEET_ACTIVITIES);

export interface SubmitEntry {
  work_date: string;
  activity: TimesheetActivity | string;
  hours: number;
  project_id?: string | null;
  notes?: string | null;
}

export interface SubmitViolation {
  code: "empty_timesheet" | "invalid_hours" | "date_outside_week" | "invalid_activity";
  message: string;
}

/**
 * Server-side re-validation of a whole week before it leaves draft.
 * Returns the first violation, or null when the week can be submitted.
 */
export function validateSubmission(
  entries: readonly SubmitEntry[],
  weekStart: string,
): SubmitViolation | null {
  if (entries.length === 0) {
    return { code: "empty_timesheet", message: "Add hours before submitting." };
  }
  const days = new Set(weekDays(weekStart));
  for (const e of entries) {
    const hours = Number(e.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      return {
        code: "invalid_hours",
        message: `Hours must be between 0 and 24 (got ${String(e.hours)} on ${e.work_date}).`,
      };
    }
    if (!days.has(e.work_date)) {
      return {
        code: "date_outside_week",
        message: `${e.work_date} is outside the week starting ${weekStart}.`,
      };
    }
    if (!TIMESHEET_ACTIVITY_SET.has(String(e.activity))) {
      return { code: "invalid_activity", message: `Unknown activity "${String(e.activity)}".` };
    }
  }
  if (entries.every((e) => Number(e.hours) <= 0)) {
    return { code: "empty_timesheet", message: "Add hours before submitting." };
  }
  return null;
}

export type ApprovalRouteMode = "foreman" | "construction_admin" | "inline_step2";

/**
 * approval_chain_steps is single-role per step, so step 1 is seeded as
 * `foreman`. The step-1 pool is really foreman OR construction_admin; when
 * neither role has a holder we bypass the engine's company_admin fallback and
 * open the instance directly at step 2 (project_admin).
 */
export function chooseApprovalRoute(counts: {
  foreman: number;
  construction_admin: number;
}): ApprovalRouteMode {
  if (counts.foreman > 0) return "foreman";
  if (counts.construction_admin > 0) return "construction_admin";
  return "inline_step2";
}

export interface ProjectHours {
  project_id: string | null;
  hours: number;
}

/** Per-project hours breakdown for the approver's weekly summary card. */
export function hoursByProject(entries: readonly SubmitEntry[]): ProjectHours[] {
  const acc = new Map<string, number>();
  for (const e of entries) {
    const hours = Number(e.hours);
    if (!Number.isFinite(hours) || hours <= 0) continue;
    const key = e.project_id ?? "";
    acc.set(key, (acc.get(key) ?? 0) + hours);
  }
  return [...acc.entries()]
    .map(([k, hours]) => ({
      project_id: k === "" ? null : k,
      hours: Math.round(hours * 100) / 100,
    }))
    .sort((a, b) => b.hours - a.hours);
}

/** Overtime is only flagged above the weekly policy threshold. */
export function isOvertimeFlagged(
  overtimeHours: number,
  threshold: number = TIMESHEET_POLICY.overtimeWeeklyFlagThreshold,
): boolean {
  return Number(overtimeHours) > threshold;
}

/** Notes worth surfacing to an approver, deduped and trimmed. */
export function collectNotes(entries: readonly SubmitEntry[]): string[] {
  const seen = new Set<string>();
  for (const e of entries) {
    const note = (e.notes ?? "").trim();
    if (note) seen.add(note);
  }
  return [...seen];
}

/** Totals used by both the submit path and the approver card. */
export function submissionTotals(entries: readonly SubmitEntry[]) {
  return computeWeeklyTotals(entries);
}
