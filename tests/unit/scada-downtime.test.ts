// P-178 — Downtime classification: precedence, exclusivity, and the
// "class minutes sum == total downtime minutes" invariant.
import { describe, expect, it } from "vitest";

import {
  DOWNTIME_CLASSES,
  DOWNTIME_PRECEDENCE,
  classifyDowntime,
  type AnalyticsEvent,
  type Interval,
} from "@/lib/scada/analytics";

const DAY_START = Date.parse("2026-03-01T00:00:00.000Z");
const window: Interval = { start: DAY_START, end: DAY_START + 24 * 60 * 60_000 };

function iso(hour: number, minute = 0): string {
  return new Date(DAY_START + hour * 3_600_000 + minute * 60_000).toISOString();
}

function ev(
  event_type: string,
  startHour: number,
  endHour: number,
  severity = "major",
): AnalyticsEvent {
  return {
    event_type,
    severity,
    occurred_at: iso(startHour),
    ended_at: iso(endHour),
  };
}

describe("P-178 downtime classification precedence", () => {
  it("maintenance wins over an overlapping trip", () => {
    const out = classifyDowntime([ev("maintenance", 2, 6), ev("trip", 3, 5)], [], [], window);
    expect(out.byClass.maintenance).toBe(240);
    expect(out.byClass.equipment_fault).toBe(0);
    expect(out.totalMinutes).toBe(240);
  });

  it("curtailment setpoint wins over an overlapping comm failure", () => {
    const out = classifyDowntime(
      [ev("setpoint_change", 8, 10), ev("comm_failure", 8, 10)],
      [],
      [],
      window,
    );
    expect(out.byClass.curtailment).toBe(120);
    expect(out.byClass.comms_loss).toBe(0);
  });

  it("classifies a pure grid event as grid_outage", () => {
    const out = classifyDowntime([ev("status_change", 12, 13)], [], [], window);
    expect(out.byClass.grid_outage).toBe(60);
    expect(out.totalMinutes).toBe(60);
  });

  it("ignores unclassifiable event types entirely", () => {
    const out = classifyDowntime(
      [ev("telemetry_gap", 1, 4), ev("unknown_thing", 5, 6)],
      [],
      [],
      window,
    );
    expect(out.totalMinutes).toBe(0);
    for (const cls of DOWNTIME_CLASSES) expect(out.byClass[cls]).toBe(0);
  });

  it("respects the documented precedence order", () => {
    expect([...DOWNTIME_PRECEDENCE]).toEqual([
      "maintenance",
      "curtailment",
      "equipment_fault",
      "grid_outage",
      "comms_loss",
    ]);
  });
});

describe("P-178 downtime invariant on randomized fixtures", () => {
  // Deterministic LCG so failures are reproducible.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
  }

  const TYPES = [
    "maintenance",
    "setpoint_change",
    "trip",
    "protection",
    "comm_failure",
    "status_change",
  ];

  it("sum of class minutes always equals total downtime minutes", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rand = rng(seed);
      const events: AnalyticsEvent[] = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => {
        const start = rand() * 22;
        const len = 0.25 + rand() * 3;
        return ev(TYPES[Math.floor(rand() * TYPES.length)], start, Math.min(start + len, 24));
      });
      const out = classifyDowntime(events, [], [], window);
      const summed = DOWNTIME_CLASSES.reduce((n, cls) => n + out.byClass[cls], 0);
      expect(Number(summed.toFixed(2))).toBeCloseTo(out.totalMinutes, 1);
      // Never exceeds the window itself.
      expect(out.totalMinutes).toBeLessThanOrEqual(24 * 60 + 0.01);
    }
  });
});
