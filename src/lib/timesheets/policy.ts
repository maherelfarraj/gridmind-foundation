// P-228 — Timesheet policy constants. PURE module: no React, no Supabase.
//
// `weekendDays` uses ISO day-of-week numbering (Monday = 1 … Sunday = 7) with
// the *zero-based* Friday/Saturday pair expressed as [5, 6] — the default
// Jordan weekend (Friday and Saturday). Companies operating on a
// Saturday/Sunday weekend can override this per company policy; nothing in the
// split math depends on the value, it only drives weekend column shading.
export const TIMESHEET_POLICY = {
  /** Hours per day counted as regular before overtime kicks in. */
  standardDailyHours: 8,
  /** Jordan weekend by default: Friday = 5, Saturday = 6 (ISO day-of-week). */
  weekendDays: [5, 6] as number[],
  /** Weekly overtime beyond this many hours is flagged for review. */
  overtimeWeeklyFlagThreshold: 10,
  /** Annual leave entitlement seeded on new leave balances. */
  defaultAnnualEntitlementDays: 21,
} as const;

export type TimesheetActivity =
  | "regular"
  | "overtime"
  | "travel"
  | "leave_annual"
  | "leave_sick"
  | "leave_unpaid";

export const TIMESHEET_ACTIVITIES: readonly TimesheetActivity[] = [
  "regular",
  "overtime",
  "travel",
  "leave_annual",
  "leave_sick",
  "leave_unpaid",
];

export const ACTIVITY_LABELS: Record<TimesheetActivity, string> = {
  regular: "Regular",
  overtime: "Overtime",
  travel: "Travel",
  leave_annual: "Annual leave",
  leave_sick: "Sick leave",
  leave_unpaid: "Unpaid leave",
};

/** Human copy for the weekly totals tooltip. */
export function overtimeRuleText(standard = TIMESHEET_POLICY.standardDailyHours): string {
  return `Hours beyond ${standard}/day count as overtime`;
}
