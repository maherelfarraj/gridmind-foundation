import { describe, expect, it } from "vitest";

import {
  escalationRouteSchema,
  evaluateCondition,
  hasCleared,
} from "@/lib/alarms.rules";

describe("evaluateCondition", () => {
  it("covers all six operators", () => {
    expect(evaluateCondition("gt", 10, 5)).toBe(true);
    expect(evaluateCondition("gt", 5, 5)).toBe(false);
    expect(evaluateCondition("gte", 5, 5)).toBe(true);
    expect(evaluateCondition("lt", 4, 5)).toBe(true);
    expect(evaluateCondition("lte", 5, 5)).toBe(true);
    expect(evaluateCondition("eq", 5, 5)).toBe(true);
    expect(evaluateCondition("ne", 5, 6)).toBe(true);
  });
});

describe("hasCleared hysteresis", () => {
  it("lt rule with dead_band only clears past threshold + dead_band", () => {
    // rule: value lt 100, dead_band 20 → clear when value >= 120
    expect(hasCleared("lt", 90, 100, 20)).toBe(false);
    expect(hasCleared("lt", 105, 100, 20)).toBe(false);
    expect(hasCleared("lt", 120, 100, 20)).toBe(true);
    expect(hasCleared("lt", 125, 100, 20)).toBe(true);
  });

  it("gt rule with dead_band only clears past threshold - dead_band", () => {
    // rule: value gt 100, dead_band 10 → clear when value <= 90
    expect(hasCleared("gt", 105, 100, 10)).toBe(false);
    expect(hasCleared("gt", 95, 100, 10)).toBe(false);
    expect(hasCleared("gt", 90, 100, 10)).toBe(true);
  });
});

describe("escalationRouteSchema", () => {
  it("accepts a valid route", () => {
    expect(
      escalationRouteSchema.parse([
        { after_minutes: 30, notify_role: "om_admin" },
      ]),
    ).toHaveLength(1);
  });
  it("rejects negative minutes", () => {
    expect(
      escalationRouteSchema.safeParse([
        { after_minutes: -1, notify_role: "om_admin" },
      ]).success,
    ).toBe(false);
  });
  it("rejects unknown role", () => {
    expect(
      escalationRouteSchema.safeParse([
        { after_minutes: 5, notify_role: "ceo" },
      ]).success,
    ).toBe(false);
  });
});
