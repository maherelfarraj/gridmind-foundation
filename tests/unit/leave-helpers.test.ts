// P-230 — Pure leave helpers: working-day math, overlap, storage paths.
import { describe, expect, it } from "vitest";

import {
  balanceColumnFor,
  countWorkingDays,
  describeWorkingDays,
  isInsideLeavePrefix,
  LEAVE_ACTIVITY,
  leaveAttachmentPath,
  rangesOverlap,
  summariseBalance,
  validateLeaveFile,
  workingDaysInRange,
} from "@/lib/timesheets/leave";

// 2026-07-27 is a Monday.
const MON = "2026-07-27";

describe("countWorkingDays", () => {
  it("excludes Friday and Saturday by default (Jordan weekend)", () => {
    // Mon 27 Jul → Sun 2 Aug: Fri 31 + Sat 1 excluded → 5 workdays.
    expect(countWorkingDays(MON, "2026-08-02")).toBe(5);
  });

  it("counts a single weekday as one day and a weekend day as zero", () => {
    expect(countWorkingDays(MON, MON)).toBe(1);
    expect(countWorkingDays("2026-07-31", "2026-08-01")).toBe(0);
  });

  it("honours a configurable weekend (Sat/Sun)", () => {
    expect(countWorkingDays(MON, "2026-08-02", [6, 7])).toBe(5);
  });

  it("returns 0 for inverted or malformed ranges", () => {
    expect(countWorkingDays("2026-08-02", MON)).toBe(0);
    expect(countWorkingDays("nope", MON)).toBe(0);
  });
});

describe("workingDaysInRange", () => {
  it("returns the actual covered workday dates", () => {
    expect(workingDaysInRange(MON, "2026-08-02")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-08-02",
    ]);
  });

  it("spans week boundaries", () => {
    expect(workingDaysInRange(MON, "2026-08-04")).toHaveLength(7);
  });
});

describe("rangesOverlap", () => {
  it("treats bounds as inclusive", () => {
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-10", "2026-07-20")).toBe(true);
    expect(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-11", "2026-07-20")).toBe(false);
  });

  it("detects containment either way round", () => {
    expect(rangesOverlap("2026-07-01", "2026-07-31", "2026-07-10", "2026-07-12")).toBe(true);
    expect(rangesOverlap("2026-07-10", "2026-07-12", "2026-07-01", "2026-07-31")).toBe(true);
  });
});

describe("activity + balance mapping", () => {
  it("maps each leave type to its timesheet activity", () => {
    expect(LEAVE_ACTIVITY).toEqual({
      annual: "leave_annual",
      sick: "leave_sick",
      unpaid: "leave_unpaid",
      travel: "travel",
    });
  });

  it("only annual and sick consume a balance", () => {
    expect(balanceColumnFor("annual")).toBe("annual_used_days");
    expect(balanceColumnFor("sick")).toBe("sick_used_days");
    expect(balanceColumnFor("unpaid")).toBeNull();
    expect(balanceColumnFor("travel")).toBeNull();
  });
});

describe("summariseBalance", () => {
  it("defaults to the 21-day policy entitlement", () => {
    expect(summariseBalance(null)).toEqual({
      entitlement: 21,
      annualUsed: 0,
      remaining: 21,
      sickUsed: 0,
    });
  });

  it("computes entitlement − used = remaining", () => {
    const s = summariseBalance({
      annual_entitlement_days: 21,
      annual_used_days: 5.5,
      sick_used_days: 2,
    });
    expect(s.remaining).toBe(15.5);
    expect(s.sickUsed).toBe(2);
  });
});

describe("storage paths", () => {
  const company = "11111111-1111-1111-1111-111111111111";
  const user = "22222222-2222-2222-2222-222222222222";
  const leave = "33333333-3333-3333-3333-333333333333";

  it("is company-UUID-first and sanitises the filename", () => {
    expect(leaveAttachmentPath(company, user, leave, "../../etc/passwd")).toBe(
      `${company}/leave/${user}/${leave}/passwd`,
    );
  });

  it("rejects paths outside the company prefix", () => {
    expect(isInsideLeavePrefix(`${company}/leave/${user}/x/a.pdf`, company)).toBe(true);
    expect(isInsideLeavePrefix(`other/leave/${user}/a.pdf`, company)).toBe(false);
    expect(isInsideLeavePrefix(`${company}/leave/../secret.pdf`, company)).toBe(false);
  });
});

describe("validateLeaveFile", () => {
  it("caps size and restricts MIME", () => {
    expect(validateLeaveFile({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(validateLeaveFile({ size: 0, type: "application/pdf" })).toBe("file_required");
    expect(validateLeaveFile({ size: 30 * 1024 * 1024, type: "application/pdf" })).toBe(
      "file_too_large",
    );
    expect(validateLeaveFile({ size: 10, type: "application/x-msdownload" })).toBe("invalid_mime");
  });
});

describe("describeWorkingDays", () => {
  it("pluralises correctly", () => {
    expect(describeWorkingDays(1)).toBe("1 working day, weekends excluded");
    expect(describeWorkingDays(5)).toBe("5 working days, weekends excluded");
  });
});
