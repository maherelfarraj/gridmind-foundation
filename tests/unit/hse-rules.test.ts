// P-088 — HSE unit tests.
import { describe, expect, it } from "vitest";
import {
  computeTrir,
  hoursSinceOccurred,
  incidentTimingBadge,
  isInUnloggedWindow,
  nextIncidentNumber,
  summarizeChecklist,
  trainingExpiryStatus,
  type ChecklistItem,
} from "@/lib/hse.rules";

describe("computeTrir", () => {
  it("returns null when hours are zero or negative", () => {
    expect(computeTrir(2, 0)).toBeNull();
    expect(computeTrir(2, -100)).toBeNull();
  });
  it("computes TRIR = recordables × 200000 / hours", () => {
    expect(computeTrir(1, 200_000)).toBe(1);
    expect(computeTrir(2, 100_000)).toBe(4);
  });
  it("guards against invalid recordables", () => {
    expect(computeTrir(-1, 100)).toBeNull();
    expect(computeTrir(Number.NaN, 100)).toBeNull();
  });
});

describe("24-hour rule", () => {
  const t0 = new Date("2026-01-10T12:00:00Z");
  it("countdown when reported inside window and now < 24h", () => {
    const occurred = new Date(t0.getTime() - 2 * 3_600_000);
    const b = incidentTimingBadge(occurred, t0, t0);
    expect(b.kind).toBe("countdown");
    if (b.kind === "countdown") expect(Math.round(b.hoursRemaining)).toBe(22);
  });
  it("late when reported gap > 24h", () => {
    const occurred = new Date(t0.getTime() - 30 * 3_600_000);
    const reported = new Date(t0.getTime() - 5 * 3_600_000);
    const b = incidentTimingBadge(occurred, reported, t0);
    expect(b.kind).toBe("late");
  });
  it("on_time when logged within 24h and window closed", () => {
    const occurred = new Date(t0.getTime() - 48 * 3_600_000);
    const reported = new Date(occurred.getTime() + 3 * 3_600_000);
    const b = incidentTimingBadge(occurred, reported, t0);
    expect(b.kind).toBe("on_time");
  });
  it("boundary at exactly 24h is not late", () => {
    const occurred = new Date(t0.getTime() - 24 * 3_600_000);
    const reported = new Date(occurred.getTime() + 24 * 3_600_000);
    const b = incidentTimingBadge(occurred, reported, t0);
    expect(b.kind).not.toBe("late");
  });
  it("isInUnloggedWindow tracks 24h window from occurrence", () => {
    const occurred = new Date(t0.getTime() - 5 * 3_600_000);
    expect(isInUnloggedWindow(occurred, t0, t0)).toBe(true);
    const past = new Date(t0.getTime() - 30 * 3_600_000);
    expect(isInUnloggedWindow(past, t0, t0)).toBe(false);
  });
  it("hoursSinceOccurred is positive for past events", () => {
    const occurred = new Date(t0.getTime() - 3 * 3_600_000);
    expect(hoursSinceOccurred(occurred, t0)).toBeCloseTo(3, 5);
  });
});

describe("summarizeChecklist", () => {
  it("counts fails as findings, ignores pass/na", () => {
    const items: ChecklistItem[] = [
      { item: "a", result: "pass" },
      { item: "b", result: "fail" },
      { item: "c", result: "fail", resolved: true },
      { item: "d", result: "na" },
    ];
    const s = summarizeChecklist(items);
    expect(s.findingsCount).toBe(2);
    expect(s.openFindings).toBe(1);
  });
});

describe("trainingExpiryStatus", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  it("expired for past dates", () => {
    expect(trainingExpiryStatus("2026-05-01", now)).toBe("expired");
  });
  it("expiring_30 within a month", () => {
    expect(trainingExpiryStatus("2026-06-20", now)).toBe("expiring_30");
  });
  it("valid beyond 30 days", () => {
    expect(trainingExpiryStatus("2027-01-01", now)).toBe("valid");
  });
  it("no_expiry when null", () => {
    expect(trainingExpiryStatus(null, now)).toBe("no_expiry");
  });
});

describe("nextIncidentNumber", () => {
  it("starts at HSE-0001 when empty", () => {
    expect(nextIncidentNumber([])).toBe("HSE-0001");
  });
  it("increments from max existing", () => {
    expect(nextIncidentNumber(["HSE-0007", "HSE-0002"])).toBe("HSE-0008");
  });
  it("ignores malformed entries", () => {
    expect(nextIncidentNumber(["INC-9999", "HSE-0003"])).toBe("HSE-0004");
  });
});
