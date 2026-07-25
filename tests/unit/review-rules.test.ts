import { describe, expect, it } from "vitest";

import { decisionLabel, hasPendingSignoff, isOverdue, roundIsComplete } from "@/lib/review-rules";

describe("roundIsComplete", () => {
  it("false when empty", () => {
    expect(roundIsComplete([])).toBe(false);
  });
  it("false when any decision null", () => {
    expect(roundIsComplete([{ decision: "approved" }, { decision: null }])).toBe(false);
  });
  it("true when every signoff has a decision", () => {
    expect(
      roundIsComplete([
        { decision: "approved" },
        { decision: "waived" },
        { decision: "approved_with_comments" },
      ]),
    ).toBe(true);
  });
});

describe("hasPendingSignoff", () => {
  it("matches roundIsComplete inversely for non-empty", () => {
    expect(hasPendingSignoff([{ decision: null }])).toBe(true);
    expect(hasPendingSignoff([{ decision: "approved" }])).toBe(false);
  });
});

describe("decisionLabel", () => {
  it("humanises each decision", () => {
    expect(decisionLabel(null)).toBe("Pending");
    expect(decisionLabel("approved")).toBe("Approved");
    expect(decisionLabel("approved_with_comments")).toBe("Approved w/ comments");
    expect(decisionLabel("rejected")).toBe("Rejected");
    expect(decisionLabel("waived")).toBe("Waived");
  });
});

describe("isOverdue", () => {
  const today = new Date("2026-07-24T12:00:00Z");
  it("false when status is not open", () => {
    expect(isOverdue("2020-01-01", "closed", today)).toBe(false);
  });
  it("false when no due date", () => {
    expect(isOverdue(null, "open", today)).toBe(false);
  });
  it("true when due_date < today and open", () => {
    expect(isOverdue("2026-07-23", "open", today)).toBe(true);
  });
  it("false when due_date >= today", () => {
    expect(isOverdue("2026-07-24", "open", today)).toBe(false);
    expect(isOverdue("2026-07-25", "open", today)).toBe(false);
  });
});
