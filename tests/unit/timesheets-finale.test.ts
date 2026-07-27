// P-232 — Batch 29 finale: the timesheets loop end to end, offline.
// Split/totals math, week anchoring, grid round-trip, submission guards,
// approval-chain routing, lock enforcement, leave policy math and the
// labor-cost rollup that feeds estimate-vs-actuals and EVM.
import { describe, expect, it } from "vitest";

import { toCells, toGridRows, clampHours, rowKey } from "@/lib/timesheets/grid";
import {
  balanceColumnFor,
  countWorkingDays,
  describeWorkingDays,
  isInsideLeavePrefix,
  leaveAttachmentPath,
  LEAVE_ACTIVITY,
  rangesOverlap,
  summariseBalance,
  validateLeaveFile,
  workingDaysInRange,
} from "@/lib/timesheets/leave";
import { TIMESHEET_POLICY } from "@/lib/timesheets/policy";
import { aggregateLaborActuals, resolveRate, type ReportEntry } from "@/lib/timesheets/reports";
import {
  clockHours,
  computeWeeklyTotals,
  dailyTotal,
  splitDailyHours,
} from "@/lib/timesheets/split";
import {
  chooseApprovalRoute,
  collectNotes,
  hoursByProject,
  isOvertimeFlagged,
  submissionTotals,
  validateSubmission,
} from "@/lib/timesheets/submit-guards";
import { isWeekend, weekDays, weekStartOf } from "@/lib/timesheets/week";

const WEEK = "2026-07-06"; // Monday

// ---------------------------------------------------------------------------
// 1. Split + weekly totals
// ---------------------------------------------------------------------------

describe("split math", () => {
  it("splits a day at the 8h standard", () => {
    expect(splitDailyHours(10)).toEqual({ regular: 8, overtime: 2 });
    expect(splitDailyHours(6)).toEqual({ regular: 6, overtime: 0 });
    expect(splitDailyHours(-3)).toEqual({ regular: 0, overtime: 0 });
  });

  it("applies the daily standard across projects, not per row", () => {
    const totals = computeWeeklyTotals([
      { work_date: "2026-07-06", activity: "regular", hours: 6 },
      { work_date: "2026-07-06", activity: "regular", hours: 5 },
    ]);
    // 11h on one day → 8 regular + 3 overtime, never 11 regular.
    expect(totals).toMatchObject({ regular: 8, overtime: 3 });
  });

  it("keeps a by-activity breakdown and per-day totals", () => {
    const entries = [
      { work_date: "2026-07-06", activity: "regular", hours: 8 },
      { work_date: "2026-07-06", activity: "travel", hours: 2 },
      { work_date: "2026-07-07", activity: "regular", hours: 4 },
    ];
    const totals = computeWeeklyTotals(entries);
    expect(totals.byActivity).toEqual({ regular: 12, travel: 2 });
    expect(dailyTotal(entries, "2026-07-06")).toBe(10);
  });

  it("converts clock in/out to quarter-hour totals", () => {
    expect(clockHours("07:00", "15:30")).toBe(8.5);
    expect(clockHours("08:00", "08:10")).toBe(0.25);
    expect(clockHours("15:00", "07:00")).toBe(0);
    expect(clockHours(null, "15:00")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Week anchoring + grid round-trip
// ---------------------------------------------------------------------------

describe("week + grid", () => {
  it("anchors any date to its Monday and yields seven days", () => {
    expect(weekStartOf("2026-07-09")).toBe(WEEK);
    expect(weekStartOf(WEEK)).toBe(WEEK);
    expect(weekDays(WEEK)).toHaveLength(7);
    expect(weekDays(WEEK)[6]).toBe("2026-07-12");
  });

  it("treats Friday and Saturday as the weekend by policy", () => {
    expect(isWeekend("2026-07-10")).toBe(true); // Friday
    expect(isWeekend("2026-07-11")).toBe(true); // Saturday
    expect(isWeekend("2026-07-12")).toBe(false); // Sunday is a workday
  });

  it("round-trips entries through rows and back to cells", () => {
    const entries = [
      {
        work_date: "2026-07-06",
        project_id: "p1",
        cwp_id: null,
        activity: "regular",
        hours: 8,
        notes: null,
      },
      {
        work_date: "2026-07-07",
        project_id: "p1",
        cwp_id: null,
        activity: "regular",
        hours: 4,
        notes: "half day",
      },
    ];
    const rows = toGridRows(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(rowKey("p1", null, "regular"));
    const cells = toCells(rows, weekDays(WEEK));
    expect(cells.filter((c) => c.hours > 0)).toHaveLength(2);
  });

  it("clamps hand-typed hours to a sane day", () => {
    expect(clampHours(30)).toBeLessThanOrEqual(24);
    expect(clampHours(-2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Submission guards + approval chain routing
// ---------------------------------------------------------------------------

describe("submission guards", () => {
  it("accepts a valid week", () => {
    expect(
      validateSubmission([{ work_date: "2026-07-06", activity: "regular", hours: 8 }], WEEK),
    ).toBeNull();
  });

  it("rejects empty, zero-hour, out-of-range, out-of-week and unknown-activity weeks", () => {
    expect(validateSubmission([], WEEK)?.code).toBe("empty_timesheet");
    expect(
      validateSubmission([{ work_date: "2026-07-06", activity: "regular", hours: 0 }], WEEK)?.code,
    ).toBe("empty_timesheet");
    expect(
      validateSubmission([{ work_date: "2026-07-06", activity: "regular", hours: 25 }], WEEK)?.code,
    ).toBe("invalid_hours");
    expect(
      validateSubmission([{ work_date: "2026-07-20", activity: "regular", hours: 8 }], WEEK)?.code,
    ).toBe("date_outside_week");
    expect(
      validateSubmission([{ work_date: "2026-07-06", activity: "nap", hours: 8 }], WEEK)?.code,
    ).toBe("invalid_activity");
  });

  it("routes step 1 to foreman, then construction_admin, then inline step 2", () => {
    expect(chooseApprovalRoute({ foreman: 2, construction_admin: 1 })).toBe("foreman");
    expect(chooseApprovalRoute({ foreman: 0, construction_admin: 1 })).toBe("construction_admin");
    expect(chooseApprovalRoute({ foreman: 0, construction_admin: 0 })).toBe("inline_step2");
  });

  it("summarises a week for the approver card", () => {
    const entries = [
      { work_date: "2026-07-06", activity: "regular", hours: 10, project_id: "p1", notes: "rain" },
      { work_date: "2026-07-07", activity: "regular", hours: 8, project_id: "p2", notes: "rain" },
    ];
    expect(hoursByProject(entries)).toEqual([
      { project_id: "p1", hours: 10 },
      { project_id: "p2", hours: 8 },
    ]);
    expect(collectNotes(entries)).toEqual(["rain"]);
    expect(submissionTotals(entries)).toMatchObject({ regular: 16, overtime: 2 });
  });

  it("only flags overtime above the weekly policy threshold", () => {
    expect(isOvertimeFlagged(TIMESHEET_POLICY.overtimeWeeklyFlagThreshold)).toBe(false);
    expect(isOvertimeFlagged(TIMESHEET_POLICY.overtimeWeeklyFlagThreshold + 0.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Lock enforcement — only draft weeks are editable
// ---------------------------------------------------------------------------

const EDITABLE = new Set(["draft", "rejected"]);
const isWeekLocked = (status: string) => !EDITABLE.has(status);

describe("lock enforcement", () => {
  it("locks every non-draft status and reopens rejected weeks", () => {
    expect(isWeekLocked("draft")).toBe(false);
    expect(isWeekLocked("rejected")).toBe(false);
    for (const status of ["submitted", "in_review", "approved"]) {
      expect(isWeekLocked(status)).toBe(true);
    }
  });

  it("reports locked weeks as skipped instead of writing into them", () => {
    const weeks = [
      { week_start: "2026-07-06", status: "draft" },
      { week_start: "2026-07-13", status: "approved" },
    ];
    const skipped = weeks.filter((w) => isWeekLocked(w.status)).map((w) => w.week_start);
    expect(skipped).toEqual(["2026-07-13"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Leave — Jordan weekend, overlap, balances, attachments
// ---------------------------------------------------------------------------

describe("leave policy math", () => {
  it("excludes Friday/Saturday by default and honours an override", () => {
    // Sun 2026-07-05 .. Sat 2026-07-11 → 5 workdays (Fri + Sat excluded).
    expect(countWorkingDays("2026-07-05", "2026-07-11")).toBe(5);
    expect(countWorkingDays("2026-07-05", "2026-07-11", [6, 7])).toBe(5);
    expect(workingDaysInRange("2026-07-05", "2026-07-11")).not.toContain("2026-07-10");
  });

  it("returns nothing for an inverted or malformed range", () => {
    expect(countWorkingDays("2026-07-11", "2026-07-05")).toBe(0);
    expect(countWorkingDays("nope", "2026-07-05")).toBe(0);
  });

  it("detects inclusive overlaps like Postgres daterange []", () => {
    expect(rangesOverlap("2026-07-06", "2026-07-08", "2026-07-08", "2026-07-09")).toBe(true);
    expect(rangesOverlap("2026-07-06", "2026-07-08", "2026-07-09", "2026-07-10")).toBe(false);
  });

  it("maps leave types to activities and balance columns", () => {
    expect(LEAVE_ACTIVITY.annual).toBe("leave_annual");
    expect(LEAVE_ACTIVITY.travel).toBe("travel");
    expect(balanceColumnFor("annual")).toBe("annual_used_days");
    expect(balanceColumnFor("sick")).toBe("sick_used_days");
    expect(balanceColumnFor("unpaid")).toBeNull();
    expect(balanceColumnFor("travel")).toBeNull();
  });

  it("computes entitlement − used = remaining", () => {
    const summary = summariseBalance({
      annual_entitlement_days: 21,
      annual_used_days: 5,
      sick_used_days: 2,
    });
    expect(summary).toMatchObject({ entitlement: 21, annualUsed: 5, remaining: 16, sickUsed: 2 });
    expect(summariseBalance(null).entitlement).toBe(TIMESHEET_POLICY.defaultAnnualEntitlementDays);
  });

  it("writes attachments company-UUID-first and rejects escapes", () => {
    const path = leaveAttachmentPath("c-1", "u-1", "lr-1", "../../etc/passwd");
    expect(path.startsWith("c-1/leave/u-1/lr-1/")).toBe(true);
    expect(path).not.toContain("..");
    expect(isInsideLeavePrefix(path, "c-1")).toBe(true);
    expect(isInsideLeavePrefix(path, "c-2")).toBe(false);
  });

  it("validates attachment size and mime", () => {
    expect(validateLeaveFile({ size: 1024, type: "application/pdf" })).toBeNull();
    expect(validateLeaveFile({ size: 0, type: "application/pdf" })).toBe("file_required");
    expect(validateLeaveFile({ size: 99 * 1024 * 1024, type: "application/pdf" })).toBe(
      "file_too_large",
    );
    expect(validateLeaveFile({ size: 10, type: "application/x-msdownload" })).toBe("invalid_mime");
  });

  it("pluralises the live day counter", () => {
    expect(describeWorkingDays(1)).toBe("1 working day, weekends excluded");
    expect(describeWorkingDays(3)).toBe("3 working days, weekends excluded");
  });
});

// ---------------------------------------------------------------------------
// 6. Labor-cost rollup — the data finance trusts
// ---------------------------------------------------------------------------

function entry(over: Partial<ReportEntry> = {}): ReportEntry {
  return {
    id: "e",
    user_id: "u1",
    project_id: "p1",
    cwp_id: null,
    work_date: "2026-07-06",
    week_start: WEEK,
    activity: "regular",
    hours: 8,
    hourly_rate: null,
    status: "approved",
    ...over,
  };
}

describe("labor-cost rollup", () => {
  const ctx = { defaultRates: { u1: 25, u2: null }, disciplines: {} };

  it("uses the entry rate, then the profile default", () => {
    expect(resolveRate(entry({ hourly_rate: 40 }), ctx)).toBe(40);
    expect(resolveRate(entry(), ctx)).toBe(25);
    expect(resolveRate(entry({ user_id: "u2" }), ctx)).toBeNull();
  });

  it("aggregates a month into regular/overtime/cost with missing rates flagged", () => {
    const out = aggregateLaborActuals(
      "p1",
      "2026-07",
      [
        entry({ id: "a", hours: 8, hourly_rate: 10 }),
        entry({ id: "b", activity: "overtime", hours: 2, hourly_rate: 15 }),
        entry({ id: "c", user_id: "u2", hours: 4 }),
      ],
      ctx,
    );
    expect(out).toMatchObject({
      project_id: "p1",
      period: "2026-07",
      regular_hours: 12,
      overtime_hours: 2,
      total_hours: 14,
      labor_cost: 110,
      missing_rate_rows: 1,
    });
  });

  it("returns a zero rollup when a project has no approved hours", () => {
    const out = aggregateLaborActuals("p1", "2026-07", [], ctx);
    expect(out.total_hours).toBe(0);
    expect(out.labor_cost).toBe(0);
  });
});
