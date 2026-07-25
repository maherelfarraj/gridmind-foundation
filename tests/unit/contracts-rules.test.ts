import { describe, expect, it } from "vitest";
import {
  ExtractedObligationSchema,
  SovMismatchError,
  assertSovMatchesValue,
  computeRetentionUntil,
  isObligationOverdue,
  sovTotal,
} from "@/lib/contracts.rules";

describe("sovTotal", () => {
  it("sums decimals without float drift", () => {
    expect(
      sovTotal([
        { line_no: 1, description: "a", scheduled_amount: 0.1 },
        { line_no: 2, description: "b", scheduled_amount: 0.2 },
      ]),
    ).toBe(0.3);
  });
});

describe("assertSovMatchesValue", () => {
  it("passes when sum equals value", () => {
    expect(() =>
      assertSovMatchesValue(20_000_000, [
        { line_no: 1, description: "Design", scheduled_amount: 5_000_000 },
        { line_no: 2, description: "Procure", scheduled_amount: 10_000_000 },
        { line_no: 3, description: "Commission", scheduled_amount: 5_000_000 },
      ]),
    ).not.toThrow();
  });

  it("throws SovMismatchError when totals diverge", () => {
    expect(() =>
      assertSovMatchesValue(20_000_000, [
        { line_no: 1, description: "Design", scheduled_amount: 5_000_000 },
        { line_no: 2, description: "Procure", scheduled_amount: 10_000_000 },
      ]),
    ).toThrow(SovMismatchError);
  });

  it("no-ops when value is null", () => {
    expect(() =>
      assertSovMatchesValue(null, [
        { line_no: 1, description: "a", scheduled_amount: 100 },
      ]),
    ).not.toThrow();
  });
});

describe("computeRetentionUntil", () => {
  it("adds exactly 7 years, preserving month/day", () => {
    expect(computeRetentionUntil("2026-03-14")).toBe("2033-03-14");
  });
  it("rejects malformed dates", () => {
    expect(() => computeRetentionUntil("bad")).toThrow();
  });
});

describe("isObligationOverdue", () => {
  const today = new Date("2026-07-25T00:00:00Z");
  it("flags past-due open items", () => {
    expect(isObligationOverdue("2026-07-01", "open", today)).toBe(true);
  });
  it("ignores fulfilled items", () => {
    expect(isObligationOverdue("2026-07-01", "fulfilled", today)).toBe(false);
  });
  it("ignores future items", () => {
    expect(isObligationOverdue("2027-01-01", "open", today)).toBe(false);
  });
  it("ignores missing dates", () => {
    expect(isObligationOverdue(null, "open", today)).toBe(false);
  });
});

describe("ExtractedObligationSchema", () => {
  it("accepts minimum shape", () => {
    expect(
      ExtractedObligationSchema.safeParse({ title: "Bond" }).success,
    ).toBe(true);
  });
  it("rejects empty title", () => {
    expect(
      ExtractedObligationSchema.safeParse({ title: "" }).success,
    ).toBe(false);
  });
  it("rejects malformed due_date", () => {
    expect(
      ExtractedObligationSchema.safeParse({ title: "x", due_date: "next month" })
        .success,
    ).toBe(false);
  });
});
