// P-107 — Unit tests for PM plan rules.
import { describe, expect, it } from "vitest";

import { addDaysISO, FREQUENCY_DEFAULT_DAYS, pmPlanUpsertSchema } from "@/lib/pm-plans.rules";

describe("PM plans rules", () => {
  it("maps frequency to default day intervals", () => {
    expect(FREQUENCY_DEFAULT_DAYS.weekly).toBe(7);
    expect(FREQUENCY_DEFAULT_DAYS.monthly).toBe(30);
    expect(FREQUENCY_DEFAULT_DAYS.quarterly).toBe(90);
    expect(FREQUENCY_DEFAULT_DAYS.semiannual).toBe(180);
    expect(FREQUENCY_DEFAULT_DAYS.annual).toBe(365);
  });

  it("advances due dates in UTC by a whole number of days", () => {
    expect(addDaysISO("2026-01-01", 90)).toBe("2026-04-01");
    expect(addDaysISO("2026-02-27", 3)).toBe("2026-03-02");
  });

  it("validates a well-formed plan input", () => {
    const parsed = pmPlanUpsertSchema.parse({
      project_id: "11111111-1111-1111-1111-111111111111",
      equipment_id: null,
      title: "Inverter quarterly",
      frequency: "quarterly",
      interval_days: 90,
      next_due_date: "2026-07-01",
      checklist: [{ step: "Check fans", required: true }],
      auto_generate: true,
      active: true,
    });
    expect(parsed.checklist).toHaveLength(1);
    expect(parsed.frequency).toBe("quarterly");
  });

  it("rejects intervals below 1 day", () => {
    expect(() =>
      pmPlanUpsertSchema.parse({
        project_id: "11111111-1111-1111-1111-111111111111",
        title: "Bad",
        frequency: "weekly",
        interval_days: 0,
        next_due_date: "2026-01-01",
        checklist: [],
        auto_generate: true,
        active: true,
      }),
    ).toThrow();
  });
});
