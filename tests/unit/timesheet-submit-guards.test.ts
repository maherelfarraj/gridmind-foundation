// P-229 — submission guards, approval routing choice and inbox summary math.
import { describe, expect, it } from "vitest";

import { TIMESHEET_POLICY } from "@/lib/timesheets/policy";
import {
  chooseApprovalRoute,
  collectNotes,
  hoursByProject,
  isOvertimeFlagged,
  submissionTotals,
  validateSubmission,
} from "@/lib/timesheets/submit-guards";

const WEEK = "2026-07-20"; // Monday

describe("validateSubmission", () => {
  it("refuses a zero-entry week", () => {
    expect(validateSubmission([], WEEK)?.code).toBe("empty_timesheet");
  });

  it("refuses a week whose entries are all zero hours", () => {
    const v = validateSubmission([{ work_date: WEEK, activity: "regular", hours: 0 }], WEEK);
    expect(v?.code).toBe("empty_timesheet");
  });

  it("refuses hours outside 0–24", () => {
    expect(
      validateSubmission([{ work_date: WEEK, activity: "regular", hours: 25 }], WEEK)?.code,
    ).toBe("invalid_hours");
    expect(
      validateSubmission([{ work_date: WEEK, activity: "regular", hours: -1 }], WEEK)?.code,
    ).toBe("invalid_hours");
  });

  it("refuses a work_date outside the submitted week", () => {
    const v = validateSubmission(
      [{ work_date: "2026-07-27", activity: "regular", hours: 8 }],
      WEEK,
    );
    expect(v?.code).toBe("date_outside_week");
  });

  it("refuses an unknown activity", () => {
    const v = validateSubmission([{ work_date: WEEK, activity: "napping", hours: 8 }], WEEK);
    expect(v?.code).toBe("invalid_activity");
  });

  it("accepts a valid Monday–Sunday week", () => {
    expect(
      validateSubmission(
        [
          { work_date: WEEK, activity: "regular", hours: 8 },
          { work_date: "2026-07-26", activity: "overtime", hours: 4 },
        ],
        WEEK,
      ),
    ).toBeNull();
  });
});

describe("chooseApprovalRoute", () => {
  it("uses the seeded foreman step when foremen exist", () => {
    expect(chooseApprovalRoute({ foreman: 2, construction_admin: 5 })).toBe("foreman");
  });
  it("re-points step 1 for construction_admin-only companies", () => {
    expect(chooseApprovalRoute({ foreman: 0, construction_admin: 1 })).toBe("construction_admin");
  });
  it("falls back inline to step 2 when neither role has a holder", () => {
    expect(chooseApprovalRoute({ foreman: 0, construction_admin: 0 })).toBe("inline_step2");
  });
});

describe("summary math", () => {
  const entries = [
    { work_date: WEEK, activity: "regular", hours: 10, project_id: "p1", notes: "Grid tie-in" },
    { work_date: WEEK, activity: "regular", hours: 2, project_id: "p2" },
    { work_date: "2026-07-21", activity: "regular", hours: 4, project_id: "p1", notes: null },
    { work_date: "2026-07-22", activity: "travel", hours: 3, project_id: null, notes: "Site run" },
  ];

  it("breaks hours down per project, largest first", () => {
    expect(hoursByProject(entries)).toEqual([
      { project_id: "p1", hours: 14 },
      { project_id: null, hours: 3 },
      { project_id: "p2", hours: 2 },
    ]);
  });

  it("splits totals per day, not per row", () => {
    const t = submissionTotals(entries);
    expect(t.regular).toBe(15); // 8 + 4 + 3
    expect(t.overtime).toBe(4); // 12h Monday → 4h OT
  });

  it("flags overtime only above the weekly policy threshold", () => {
    const threshold = TIMESHEET_POLICY.overtimeWeeklyFlagThreshold;
    expect(isOvertimeFlagged(threshold)).toBe(false);
    expect(isOvertimeFlagged(threshold + 0.5)).toBe(true);
  });

  it("collects deduped, trimmed notes", () => {
    expect(collectNotes([...entries, { ...entries[0], notes: " Grid tie-in " }])).toEqual([
      "Grid tie-in",
      "Site run",
    ]);
  });
});
