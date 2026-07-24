import { describe, expect, it } from "vitest";
import {
  canAnswer,
  canClose,
  computeKpis,
  isOverdue,
  nextRfiNumber,
} from "@/lib/rfi-rules";

describe("nextRfiNumber", () => {
  it("returns RFI-0001 when list is empty", () => {
    expect(nextRfiNumber([])).toBe("RFI-0001");
  });
  it("increments past highest existing number, ignoring gaps and junk", () => {
    expect(nextRfiNumber(["RFI-0001", "RFI-0003", "junk", "RFI-9"])).toBe(
      "RFI-0004",
    );
  });
  it("pads to 4 digits", () => {
    expect(nextRfiNumber(["RFI-0099"])).toBe("RFI-0100");
  });
});

describe("isOverdue", () => {
  const today = new Date("2026-07-24T10:00:00Z");
  it("false when no due date", () => {
    expect(isOverdue({ status: "open", due_date: null }, today)).toBe(false);
  });
  it("false when answered", () => {
    expect(
      isOverdue({ status: "answered", due_date: "2026-07-01" }, today),
    ).toBe(false);
  });
  it("true when open and past due", () => {
    expect(
      isOverdue({ status: "open", due_date: "2026-07-23" }, today),
    ).toBe(true);
  });
  it("false when due today", () => {
    expect(
      isOverdue({ status: "open", due_date: "2026-07-24" }, today),
    ).toBe(false);
  });
});

describe("canAnswer / canClose", () => {
  it("routed user can answer open RFI", () => {
    expect(
      canAnswer({
        userId: "u1",
        isAdmin: false,
        routed_to: "u1",
        status: "open",
      }),
    ).toBe(true);
  });
  it("non-routed non-admin cannot answer", () => {
    expect(
      canAnswer({
        userId: "u2",
        isAdmin: false,
        routed_to: "u1",
        status: "open",
      }),
    ).toBe(false);
  });
  it("admin can answer regardless of routing", () => {
    expect(
      canAnswer({
        userId: "u2",
        isAdmin: true,
        routed_to: "u1",
        status: "in_review",
      }),
    ).toBe(true);
  });
  it("cannot answer closed RFI", () => {
    expect(
      canAnswer({
        userId: "u1",
        isAdmin: true,
        routed_to: "u1",
        status: "closed",
      }),
    ).toBe(false);
  });
  it("raiser can close only when answered", () => {
    expect(
      canClose({
        userId: "u1",
        isAdmin: false,
        raised_by: "u1",
        status: "answered",
      }),
    ).toBe(true);
    expect(
      canClose({
        userId: "u1",
        isAdmin: false,
        raised_by: "u1",
        status: "open",
      }),
    ).toBe(false);
  });
});

describe("computeKpis", () => {
  const today = new Date("2026-07-24T00:00:00Z");
  it("empty list", () => {
    const k = computeKpis([], today);
    expect(k.total_count).toBe(0);
    expect(k.turnaround_days_avg).toBeNull();
    expect(k.pct_on_time).toBeNull();
  });
  it("matches manual math", () => {
    const k = computeKpis(
      [
        {
          status: "answered",
          due_date: "2026-07-20",
          created_at: "2026-07-10T00:00:00Z",
          answered_at: "2026-07-14T00:00:00Z", // 4 days, on time
          raised_by: "a",
          routed_to: "b",
        },
        {
          status: "answered",
          due_date: "2026-07-15",
          created_at: "2026-07-10T00:00:00Z",
          answered_at: "2026-07-20T00:00:00Z", // 10 days, late
          raised_by: "a",
          routed_to: "b",
        },
        {
          status: "open",
          due_date: "2026-07-23",
          created_at: "2026-07-15T00:00:00Z",
          answered_at: null,
          raised_by: "a",
          routed_to: "b",
        },
        {
          status: "open",
          due_date: "2026-07-30",
          created_at: "2026-07-20T00:00:00Z",
          answered_at: null,
          raised_by: "a",
          routed_to: "b",
        },
      ],
      today,
    );
    expect(k.total_count).toBe(4);
    expect(k.answered_count).toBe(2);
    expect(k.open_count).toBe(2);
    expect(k.overdue_count).toBe(1); // due 2026-07-23, still open
    expect(k.turnaround_days_avg).toBe(7); // (4 + 10) / 2
    expect(k.pct_on_time).toBe(50); // 1 of 2
  });
});
