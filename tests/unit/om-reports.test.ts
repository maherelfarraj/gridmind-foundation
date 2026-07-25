// P-110 — Pure-math tests for the monthly O&M report aggregator.
import { describe, expect, it } from "vitest";

import {
  computeAlarmDowntimeHours,
  computeAlarmSummary,
  computeAvailability,
  computePerformanceRatio,
  computeSpendByType,
  computeWoSummary,
  formatCurrency,
  omReportFilename,
  sanitizeText,
  sumLaborHours,
} from "@/lib/om-reports.rules";

describe("availability", () => {
  it("clamps downtime to the period", () => {
    // 720 h period, 720 h downtime → 0
    expect(computeAvailability(720, 720)).toBe(0);
    // 720 h period, 1000 h downtime → still clamped to 0
    expect(computeAvailability(720, 1000)).toBe(0);
  });
  it("returns null when period is zero", () => {
    expect(computeAvailability(0, 5)).toBeNull();
    expect(computeAvailability(-10, 5)).toBeNull();
  });
  it("computes 1 − downtime / period", () => {
    const a = computeAvailability(100, 5);
    expect(a).not.toBeNull();
    expect(a!).toBeCloseTo(0.95, 4);
  });
});

describe("performance ratio", () => {
  it("returns insufficient_data when any input missing", () => {
    expect(
      computePerformanceRatio({
        actualKwh: null,
        irradianceKwhPerM2: 100,
        capacityKwp: 1000,
      }).reason,
    ).toBe("insufficient_data");
    expect(
      computePerformanceRatio({
        actualKwh: 1000,
        irradianceKwhPerM2: 0,
        capacityKwp: 1000,
      }).reason,
    ).toBe("insufficient_data");
  });
  it("computes actual / (irr * capacity)", () => {
    const pr = computePerformanceRatio({
      actualKwh: 80_000,
      irradianceKwhPerM2: 100,
      capacityKwp: 1000,
    });
    expect(pr.reason).toBe("ok");
    expect(pr.value).toBeCloseTo(0.8, 4);
  });
});

describe("work-order summary", () => {
  it("computes opened/closed, MTTR, PM:CM ratio", () => {
    const nowIso = "2026-03-15T10:00:00Z";
    const closedIso = "2026-03-15T14:00:00Z"; // 4 h later
    const s = computeWoSummary([
      {
        type: "preventive",
        status: "closed",
        createdAt: nowIso,
        closedAt: closedIso,
        totalCost: 100,
      },
      {
        type: "preventive",
        status: "open",
        createdAt: nowIso,
        closedAt: null,
        totalCost: 50,
      },
      {
        type: "corrective",
        status: "closed",
        createdAt: "2026-03-15T00:00:00Z",
        closedAt: "2026-03-15T02:00:00Z", // 2 h
        totalCost: 500,
      },
    ]);
    expect(s.opened).toBe(3);
    expect(s.closed).toBe(2);
    expect(s.preventive).toBe(2);
    expect(s.corrective).toBe(1);
    expect(s.pmCmRatio).toBeCloseTo(2 / 3, 4);
    // MTTR average of 4h + 2h = 3h
    expect(s.mttrHours).toBeCloseTo(3, 4);
  });
  it("returns null MTTR when nothing closed", () => {
    const s = computeWoSummary([
      {
        type: "corrective",
        status: "open",
        createdAt: "2026-03-15T00:00:00Z",
        closedAt: null,
        totalCost: 10,
      },
    ]);
    expect(s.mttrHours).toBeNull();
    expect(s.pmCmRatio).toBe(0);
  });
});

describe("spend + currency", () => {
  it("groups spend by type and formats with Intl", () => {
    const rows = [
      {
        type: "preventive" as const,
        status: "closed",
        createdAt: "2026-03-15T00:00:00Z",
        closedAt: null,
        totalCost: 1234.5,
      },
      {
        type: "corrective" as const,
        status: "closed",
        createdAt: "2026-03-15T00:00:00Z",
        closedAt: null,
        totalCost: 500,
      },
      {
        type: "corrective" as const,
        status: "closed",
        createdAt: "2026-03-15T00:00:00Z",
        closedAt: null,
        totalCost: 250,
      },
    ];
    const by = computeSpendByType(rows);
    expect(by.preventive).toBe(1234.5);
    expect(by.corrective).toBe(750);
    // Intl formatter is locale-sensitive; just check currency + numeric digits.
    const usd = formatCurrency(1234.5, "USD");
    expect(usd).toMatch(/1[.,]234[.,]50/);
    expect(usd).toMatch(/\$|USD/);
  });
});

describe("alarms summary", () => {
  it("counts by severity and computes mean acknowledge minutes", () => {
    const s = computeAlarmSummary([
      {
        id: "1",
        severity: "critical",
        raisedAt: "2026-03-15T00:00:00Z",
        acknowledgedAt: "2026-03-15T00:10:00Z",
        clearedAt: null,
        ruleId: "r1",
        ruleName: "Inverter offline",
      },
      {
        id: "2",
        severity: "warning",
        raisedAt: "2026-03-15T00:00:00Z",
        acknowledgedAt: "2026-03-15T00:20:00Z",
        clearedAt: null,
        ruleId: "r1",
        ruleName: "Inverter offline",
      },
      {
        id: "3",
        severity: "critical",
        raisedAt: "2026-03-15T00:00:00Z",
        acknowledgedAt: null,
        clearedAt: null,
        ruleId: "r2",
        ruleName: "String underperformance",
      },
    ]);
    expect(s.total).toBe(3);
    expect(s.bySeverity.critical).toBe(2);
    expect(s.bySeverity.warning).toBe(1);
    expect(s.meanAcknowledgeMinutes).toBeCloseTo(15, 4);
    expect(s.topRecurring[0]?.ruleName).toBe("Inverter offline");
    expect(s.topRecurring[0]?.count).toBe(2);
  });
});

describe("alarm downtime", () => {
  it("clamps critical alarm windows to the period", () => {
    const hours = computeAlarmDowntimeHours(
      [
        {
          id: "a",
          severity: "critical",
          raisedAt: "2026-03-01T00:00:00Z",
          acknowledgedAt: null,
          clearedAt: "2026-03-01T05:00:00Z", // 5h
          ruleId: null,
        },
        {
          id: "b",
          severity: "warning", // ignored
          raisedAt: "2026-03-01T00:00:00Z",
          acknowledgedAt: null,
          clearedAt: "2026-03-01T10:00:00Z",
          ruleId: null,
        },
      ],
      "2026-03-01T00:00:00Z",
      "2026-03-31T23:59:59Z",
    );
    expect(hours).toBeCloseTo(5, 4);
  });
});

describe("labor hours", () => {
  it("sums labor entries", () => {
    expect(
      sumLaborHours([
        { hours: 2 },
        { hours: "3.5" },
        { hours: null },
        { hours: -1 },
      ]),
    ).toBeCloseTo(5.5, 4);
    expect(sumLaborHours(null)).toBe(0);
    expect(sumLaborHours("bad")).toBe(0);
  });
});

describe("filename + text sanitiser", () => {
  it("produces a period-tagged filename", () => {
    expect(omReportFilename("Sunfield Alpha", "2026-03-01")).toBe(
      "GridMind_OM_Report_Sunfield_Alpha_2026-03.pdf",
    );
    expect(omReportFilename("", "2026-03-01")).toBe(
      "GridMind_OM_Report_project_2026-03.pdf",
    );
  });
  it("renders O&M as a plain ampersand — no &; artifact", () => {
    const out = sanitizeText("Monthly O&M Report");
    expect(out).toBe("Monthly O&M Report");
    expect(out).not.toContain("&;");
    expect(out).not.toContain("&amp;");
    // and it should also strip a stray &; sequence if produced upstream
    expect(sanitizeText("O&;M")).toBe("O&M");
  });
});
