// P-109 — Service tickets SLA math tests.
import { describe, expect, it } from "vitest";

import {
  applySlaCreditSchema,
  classifyCountdown,
  computeCredit,
  computeDueDates,
  CREDIT_CAP_PCT,
  evaluateBreach,
  formatDuration,
  serviceTicketCreateSchema,
  SLA_POLICY,
} from "@/lib/service-tickets.rules";

describe("computeDueDates", () => {
  const created = "2026-07-25T00:00:00Z";
  it("emergency → 1h response / 8h resolution", () => {
    const d = computeDueDates("emergency", created);
    expect(d.response_due_at).toBe("2026-07-25T01:00:00.000Z");
    expect(d.resolution_due_at).toBe("2026-07-25T08:00:00.000Z");
  });
  it("high → 4h / 24h", () => {
    const d = computeDueDates("high", created);
    expect(d.response_due_at).toBe("2026-07-25T04:00:00.000Z");
    expect(d.resolution_due_at).toBe("2026-07-26T00:00:00.000Z");
  });
  it("medium → 8h / 72h", () => {
    const d = computeDueDates("medium", created);
    expect(d.response_due_at).toBe("2026-07-25T08:00:00.000Z");
    expect(d.resolution_due_at).toBe("2026-07-28T00:00:00.000Z");
  });
  it("low → 24h / 168h", () => {
    const d = computeDueDates("low", created);
    expect(d.response_due_at).toBe("2026-07-26T00:00:00.000Z");
    expect(d.resolution_due_at).toBe("2026-08-01T00:00:00.000Z");
  });
  it("SLA_POLICY table matches spec", () => {
    expect(SLA_POLICY.emergency.responseMinutes).toBe(60);
    expect(SLA_POLICY.high.resolutionMinutes).toBe(1440);
  });
});

describe("evaluateBreach", () => {
  it("flags response breach when now past due without responded_at", () => {
    const now = new Date("2026-07-25T09:00:00Z");
    const b = evaluateBreach(
      {
        response_due_at: "2026-07-25T08:00:00Z",
        resolution_due_at: "2026-07-26T00:00:00Z",
        responded_at: null,
        resolved_at: null,
      },
      now,
    );
    expect(b.response_breached).toBe(true);
    expect(b.resolution_breached).toBe(false);
    expect(b.breach_minutes).toBe(60);
  });

  it("flags both breaches and sums minutes", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    const b = evaluateBreach(
      {
        response_due_at: "2026-07-25T08:00:00Z", // 5d + 16h = 6960 min
        resolution_due_at: "2026-07-28T00:00:00Z", // 2d = 2880 min
        responded_at: null,
        resolved_at: null,
      },
      now,
    );
    expect(b.response_breached).toBe(true);
    expect(b.resolution_breached).toBe(true);
    // 4d16h past response deadline (6720 min) + 2d past resolution (2880 min).
    expect(b.breach_minutes).toBe(6720 + 2880);
  });

  it("no breach when responded and resolved before due dates", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    const b = evaluateBreach(
      {
        response_due_at: "2026-07-25T08:00:00Z",
        resolution_due_at: "2026-07-28T00:00:00Z",
        responded_at: "2026-07-25T06:00:00Z",
        resolved_at: "2026-07-27T00:00:00Z",
      },
      now,
    );
    expect(b.response_breached).toBe(false);
    expect(b.resolution_breached).toBe(false);
    expect(b.breach_minutes).toBe(0);
  });

  it("flags breach based on late resolved_at even when now is much later", () => {
    const now = new Date("2027-01-01T00:00:00Z");
    const b = evaluateBreach(
      {
        response_due_at: "2026-07-25T08:00:00Z",
        resolution_due_at: "2026-07-28T00:00:00Z",
        responded_at: "2026-07-25T06:00:00Z",
        resolved_at: "2026-07-29T00:00:00Z", // 1440 min late
      },
      now,
    );
    expect(b.resolution_breached).toBe(true);
    expect(b.breach_minutes).toBe(1440);
  });
});

describe("computeCredit", () => {
  it("response only → 5%", () => {
    const c = computeCredit({
      response_breached: true,
      resolution_breached: false,
      monthlyFee: 10000,
    });
    expect(c.credit_pct).toBe(5);
    expect(c.credit_amount).toBe(500);
  });
  it("resolution only → 10%", () => {
    const c = computeCredit({
      response_breached: false,
      resolution_breached: true,
      monthlyFee: 10000,
    });
    expect(c.credit_pct).toBe(10);
    expect(c.credit_amount).toBe(1000);
  });
  it("both → 15% (under cap)", () => {
    const c = computeCredit({
      response_breached: true,
      resolution_breached: true,
      monthlyFee: 10000,
    });
    expect(c.credit_pct).toBe(15);
    expect(c.credit_amount).toBe(1500);
  });
  it("cap enforced at 20%", () => {
    expect(CREDIT_CAP_PCT).toBe(20);
    // Even though 5+10=15 today, cap ensures no runaway change if constants shift.
    const c = computeCredit({
      response_breached: true,
      resolution_breached: true,
      monthlyFee: 1000,
    });
    expect(c.credit_pct).toBeLessThanOrEqual(20);
  });
  it("no fee → null amount", () => {
    const c = computeCredit({
      response_breached: true,
      resolution_breached: true,
      monthlyFee: null,
    });
    expect(c.credit_amount).toBeNull();
  });
});

describe("classifyCountdown", () => {
  const createdAtISO = "2026-07-25T00:00:00Z";
  const dueAtISO = "2026-07-25T10:00:00Z"; // 10h window
  it("on_track when >25% remaining", () => {
    const c = classifyCountdown({
      createdAtISO,
      dueAtISO,
      now: new Date("2026-07-25T05:00:00Z"),
    });
    expect(c.status).toBe("on_track");
  });
  it("warning under 25% remaining", () => {
    const c = classifyCountdown({
      createdAtISO,
      dueAtISO,
      now: new Date("2026-07-25T08:00:00Z"),
    });
    expect(c.status).toBe("warning");
  });
  it("breached when past due", () => {
    const c = classifyCountdown({
      createdAtISO,
      dueAtISO,
      now: new Date("2026-07-25T11:00:00Z"),
    });
    expect(c.status).toBe("breached");
  });
});

describe("formatDuration", () => {
  it("formats days/hours", () => {
    expect(formatDuration(2 * 86_400_000 + 3 * 3_600_000)).toBe("2d 3h");
  });
  it("negative sign for past-due", () => {
    expect(formatDuration(-3_600_000)).toBe("-1h 0m");
  });
});

describe("schemas", () => {
  it("create schema requires project, title, defaults priority", () => {
    const parsed = serviceTicketCreateSchema.parse({
      project_id: "11111111-1111-1111-1111-111111111111",
      title: "Inverter offline",
    });
    expect(parsed.priority).toBe("medium");
    expect(parsed.category).toBe("corrective");
  });
  it("create schema rejects missing title", () => {
    expect(() =>
      serviceTicketCreateSchema.parse({
        project_id: "11111111-1111-1111-1111-111111111111",
      }),
    ).toThrow();
  });
  it("credit schema requires non-negative fee", () => {
    expect(() =>
      applySlaCreditSchema.parse({
        ticket_id: "11111111-1111-1111-1111-111111111111",
        monthly_fee: -1,
      }),
    ).toThrow();
  });
});
