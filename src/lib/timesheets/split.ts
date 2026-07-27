// P-228 — Regular/overtime split math. PURE module: no React, no Supabase.
import { TIMESHEET_POLICY, type TimesheetActivity } from "@/lib/timesheets/policy";

export interface SplitResult {
  regular: number;
  overtime: number;
}

export interface WeeklyEntryInput {
  work_date: string;
  activity: TimesheetActivity | string;
  hours: number;
}

export interface WeeklyTotals extends SplitResult {
  byActivity: Record<string, number>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Split one day's hours into regular vs overtime against the daily standard. */
export function splitDailyHours(
  hours: number,
  standard: number = TIMESHEET_POLICY.standardDailyHours,
): SplitResult {
  const h = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  return {
    regular: round2(Math.min(h, standard)),
    overtime: round2(Math.max(0, h - standard)),
  };
}

/**
 * Sum entries into weekly regular/overtime totals. The split is applied per
 * work_date across all rows (a person can only work 8 regular hours a day
 * regardless of how many projects those hours were booked against).
 */
export function computeWeeklyTotals(
  entries: readonly WeeklyEntryInput[],
  standard: number = TIMESHEET_POLICY.standardDailyHours,
): WeeklyTotals {
  const perDay = new Map<string, number>();
  const byActivity: Record<string, number> = {};

  for (const e of entries) {
    const hours = Number.isFinite(e.hours) ? Math.max(0, Number(e.hours)) : 0;
    if (hours === 0) continue;
    perDay.set(e.work_date, (perDay.get(e.work_date) ?? 0) + hours);
    byActivity[e.activity] = round2((byActivity[e.activity] ?? 0) + hours);
  }

  let regular = 0;
  let overtime = 0;
  for (const dayHours of perDay.values()) {
    const s = splitDailyHours(dayHours, standard);
    regular += s.regular;
    overtime += s.overtime;
  }

  return { regular: round2(regular), overtime: round2(overtime), byActivity };
}

/** Total hours booked on one day across all rows. */
export function dailyTotal(entries: readonly WeeklyEntryInput[], workDate: string): number {
  return round2(
    entries
      .filter((e) => e.work_date === workDate)
      .reduce((sum, e) => sum + (Number.isFinite(e.hours) ? Math.max(0, Number(e.hours)) : 0), 0),
  );
}

/** Hours between two "HH:MM" clock stamps, clamped to 0–24, rounded to 0.25h. */
export function clockHours(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return 0;
  return Math.min(24, Math.round((minutes / 60) * 4) / 4);
}
