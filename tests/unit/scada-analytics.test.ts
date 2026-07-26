// P-175 — pure performance-analytics engine tests.
import { describe, expect, it } from "vitest";

import {
  availabilityPct,
  classifyDowntime,
  compareToGuarantee,
  dataQuality,
  expectedDailyKwhFromMonthlyProfile,
  lostEnergyKwh,
  performanceRatio,
  rankAssetPerformance,
  DOWNTIME_CLASSES,
} from "@/lib/scada/analytics";

const DAY_START = Date.parse("2026-05-10T00:00:00.000Z");
const WINDOW = { start: DAY_START, end: DAY_START + 24 * 60 * 60_000 };

function iso(minutesFromStart: number): string {
  return new Date(DAY_START + minutesFromStart * 60_000).toISOString();
}

describe("classifyDowntime", () => {
  it("assigns each downtime minute to exactly one class using the documented precedence", () => {
    const result = classifyDowntime(
      [
        { event_type: "trip", occurred_at: iso(60), ended_at: iso(120) },
        // fully overlapping maintenance wins over the equipment fault
        { event_type: "maintenance", occurred_at: iso(60), ended_at: iso(90) },
        { event_type: "comm_failure", occurred_at: iso(300), ended_at: iso(330) },
      ],
      [],
      [],
      WINDOW,
    );

    expect(result.byClass.maintenance).toBe(30);
    expect(result.byClass.equipment_fault).toBe(30);
    expect(result.byClass.comms_loss).toBe(30);
    const sum = DOWNTIME_CLASSES.reduce((s, c) => s + result.byClass[c], 0);
    expect(sum).toBeCloseTo(result.totalMinutes, 6);
    expect(result.totalMinutes).toBe(90);
  });

  it("counts curtailment above equipment fault and grid outage", () => {
    const result = classifyDowntime(
      [
        { event_type: "setpoint_change", occurred_at: iso(0), ended_at: iso(60) },
        { event_type: "protection", occurred_at: iso(30), ended_at: iso(90) },
        { event_type: "status_change", occurred_at: iso(0), ended_at: iso(120) },
      ],
      [],
      [],
      WINDOW,
    );
    expect(result.byClass.curtailment).toBe(60);
    expect(result.byClass.equipment_fault).toBe(30);
    expect(result.byClass.grid_outage).toBe(30);
    expect(result.totalMinutes).toBe(120);
  });

  it("folds preventive work orders into maintenance and corrective into equipment fault", () => {
    const result = classifyDowntime(
      [],
      [],
      [
        { type: "preventive", scheduled_date: iso(600), completed_at: iso(660) },
        { type: "corrective", scheduled_date: iso(700), completed_at: iso(730) },
      ],
      WINDOW,
    );
    expect(result.byClass.maintenance).toBe(60);
    expect(result.byClass.equipment_fault).toBe(30);
  });
});

describe("lostEnergyKwh", () => {
  it("sums expected power over down intervals only", () => {
    const curve = Array.from({ length: 8 }, (_, i) => ({
      ts: iso(i * 15),
      expected_power_kw: 1000,
    }));
    // downtime covers the first hour = 4 samples × 1000 kW × 0.25 h = 1000 kWh
    const lost = lostEnergyKwh([{ start: DAY_START, end: DAY_START + 60 * 60_000 }], curve, 15);
    expect(lost).toBeCloseTo(1000, 3);
  });

  it("returns zero with no downtime or no curve", () => {
    expect(lostEnergyKwh([], [{ ts: iso(0), expected_power_kw: 500 }], 15)).toBe(0);
    expect(lostEnergyKwh([{ start: DAY_START, end: DAY_START + 3600_000 }], [], 15)).toBe(0);
  });
});

describe("availabilityPct", () => {
  it("computes raw availability", () => {
    expect(availabilityPct(1440, 144)).toBeCloseTo(90, 6);
  });

  it("excludes grid outage from numerator and denominator when configured", () => {
    // 1440 min period, 240 downtime of which 120 is grid
    expect(
      availabilityPct(1440, 240, { excludeGrid: true, gridOutageMinutes: 120 }),
    ).toBeCloseTo(100 * (1 - 120 / 1320), 3);
  });

  it("is null-safe for a zero period", () => {
    expect(availabilityPct(0, 10)).toBeNull();
  });
});

describe("performanceRatio", () => {
  it("computes PR from actual, irradiance and nameplate", () => {
    // 6 kWh/m² × 1000 kW / 1000 = 6000 kWh reference; 4800 actual = 80%
    expect(performanceRatio(4800, 6, 1000)).toBeCloseTo(80, 3);
  });

  it("returns null when irradiance or nameplate is missing or zero", () => {
    expect(performanceRatio(4800, null, 1000)).toBeNull();
    expect(performanceRatio(4800, 0, 1000)).toBeNull();
    expect(performanceRatio(4800, 6, 0)).toBeNull();
  });
});

describe("dataQuality", () => {
  it("reports missing samples and quality percentage", () => {
    const flags = [...Array(200).fill("good"), ...Array(10).fill("suspect"), ...Array(5).fill("bad")];
    const dq = dataQuality(1440, 5, flags);
    expect(dq.expectedSamples).toBe(288);
    expect(dq.receivedSamples).toBe(215);
    expect(dq.missingSamples).toBe(73);
    expect(dq.suspectSamples).toBe(10);
    expect(dq.badSamples).toBe(5);
    expect(dq.qualityPct).toBeCloseTo((100 * 200) / 288, 3);
  });

  it("flags redundant sensors that diverge more than 2% for over 24 hours", () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      ts: new Date(DAY_START + i * 60 * 60_000).toISOString(),
      a: 100,
      b: 95,
    }));
    const dq = dataQuality(1440, 5, [], [{ label: "POA-1 vs POA-2", samples }]);
    expect(dq.driftFlags).toHaveLength(1);
    expect(dq.driftFlags[0].maxDivergencePct).toBeCloseTo(5, 1);
  });

  it("does not flag short divergences", () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      ts: new Date(DAY_START + i * 60 * 60_000).toISOString(),
      a: 100,
      b: 90,
    }));
    expect(dataQuality(1440, 5, [], [{ label: "pair", samples }]).driftFlags).toHaveLength(0);
  });
});

describe("compareToGuarantee", () => {
  it("returns no_guarantee when terms are absent", () => {
    expect(
      compareToGuarantee(
        { availabilityPct: 99, performanceRatioPct: 80, energyKwh: 1000 },
        null,
      ).status,
    ).toBe("no_guarantee");
  });

  it("flags a breach when actual falls below the guarantee", () => {
    const res = compareToGuarantee(
      { availabilityPct: 95, performanceRatioPct: 78, energyKwh: 1000 },
      { availability_target_pct: 98, guaranteed_pr_pct: 80 },
    );
    expect(res.status).toBe("ok");
    expect(res.checks.every((c) => c.breach)).toBe(true);
    expect(res.checks[0].margin_pct).toBeCloseTo(-3, 3);
  });

  it("pro-rates annual energy guarantees by the period fraction", () => {
    const res = compareToGuarantee(
      { availabilityPct: null, performanceRatioPct: null, energyKwh: 300_000, energyPeriodFraction: 1 / 365 },
      { annual_energy_mwh: 109_500 },
    );
    const energy = res.checks.find((c) => c.metric === "energy")!;
    expect(energy.guaranteed).toBeCloseTo(300, 1);
    expect(energy.breach).toBe(false);
  });
});

describe("expectedDailyKwhFromMonthlyProfile", () => {
  it("pro-rates a monthly MWh profile to a day", () => {
    const monthly = Array(12).fill(310); // 310 MWh per month
    const value = expectedDailyKwhFromMonthlyProfile(monthly, new Date("2026-05-10T00:00:00Z"));
    expect(value).toBeCloseTo((310 * 1000) / 31, 3);
  });

  it("returns null with no baseline", () => {
    expect(expectedDailyKwhFromMonthlyProfile(null, new Date())).toBeNull();
  });
});

describe("rankAssetPerformance", () => {
  it("ranks by actual vs expected and is null-safe without a baseline", () => {
    const { rows, top, bottom } = rankAssetPerformance([
      { assetId: "a", name: "Inv 1", actualKwh: 900, expectedKwh: 1000 },
      { assetId: "b", name: "Inv 2", actualKwh: 1100, expectedKwh: 1000 },
      { assetId: "c", name: "Inv 3", actualKwh: 500, expectedKwh: null },
    ]);
    expect(rows.find((r) => r.assetId === "c")!.ratioPct).toBeNull();
    expect(top[0].assetId).toBe("b");
    expect(bottom[0].assetId).toBe("a");
  });
});

/* ------------------------------------------------------------------ */
/* P-178 — lost energy, availability, PR, data quality                  */
/* ------------------------------------------------------------------ */

describe("P-178 lost energy", () => {
  const DAY = Date.parse("2026-03-01T00:00:00.000Z");
  // Synthetic 15-min irradiance-expected curve: 06:00→18:00, flat 400 kW.
  const curve = Array.from({ length: 48 }, (_, i) => ({
    ts: new Date(DAY + (6 * 60 + i * 15) * 60_000).toISOString(),
    expected_power_kw: 400,
  }));
  // 2 h equipment fault, 10:00 → 12:00, fully inside the daylight curve.
  const down = [
    { start: DAY + 10 * 3_600_000, end: DAY + 12 * 3_600_000 },
  ];

  it("integrates expected power over the down window (exact kWh)", () => {
    // 400 kW × 2 h = 800 kWh
    expect(lostEnergyKwh(down, curve, 15)).toBeCloseTo(800, 3);
  });

  it("returns 0 with zero downtime", () => {
    expect(lostEnergyKwh([], curve, 15)).toBe(0);
  });

  it("returns 0 when no expected curve is available (never fabricates)", () => {
    expect(lostEnergyKwh(down, [], 15)).toBe(0);
  });
});

describe("P-178 availability", () => {
  const PERIOD = 30 * 24 * 60; // 43 200 min

  it("30-day window with 432 downtime minutes is 99.0%", () => {
    expect(availabilityPct(PERIOD, 432)).toBe(99);
  });

  it("grid-exclusion variant removes grid minutes from both terms", () => {
    // 432 down of which 432 is grid → 100% contractual availability.
    expect(
      availabilityPct(PERIOD, 432, { excludeGrid: true, gridOutageMinutes: 432 }),
    ).toBe(100);
    // Half grid: (432−216)/(43200−216) = 0.502...%
    expect(
      availabilityPct(PERIOD, 432, { excludeGrid: true, gridOutageMinutes: 216 }),
    ).toBeCloseTo(99.497, 2);
  });

  it("returns null for a non-positive period", () => {
    expect(availabilityPct(0, 10)).toBeNull();
    expect(availabilityPct(-5, 0)).toBeNull();
  });
});

describe("P-178 performance ratio", () => {
  it("computes PR from known inputs", () => {
    // 5.5 kWh/m² × 1000 kW = 5500 kWh reference; 4400 actual → 80%
    expect(performanceRatio(4400, 5.5, 1000)).toBe(80);
  });

  it("returns null without irradiance (never 0)", () => {
    expect(performanceRatio(4400, null, 1000)).toBeNull();
    expect(performanceRatio(4400, 0, 1000)).toBeNull();
  });
});

describe("P-178 data quality", () => {
  const PERIOD = 24 * 60; // one day
  const POLL = 5; // 5-minute poll interval → 288 expected samples

  it("reports the correct missing % for a 1 h gap", () => {
    const received = 288 - 12; // one hour of 5-min samples missing
    const q = dataQuality(PERIOD, POLL, Array.from({ length: received }, () => "good"));
    expect(q.expectedSamples).toBe(288);
    expect(q.receivedSamples).toBe(received);
    expect(q.missingSamples).toBe(12);
    expect(q.missingPct).toBeCloseTo((12 / 288) * 100, 3);
  });

  function pair(hours: number, divergencePct: number) {
    return {
      label: "poa_irradiance",
      samples: Array.from({ length: hours }, (_, i) => ({
        ts: new Date(Date.parse("2026-03-01T00:00:00.000Z") + i * 3_600_000).toISOString(),
        a: 1000,
        b: 1000 * (1 - divergencePct / 100),
      })),
    };
  }

  it("flags redundant sensors diverging 3% for 25 h", () => {
    const q = dataQuality(PERIOD, POLL, ["good"], [pair(26, 3)]) // 26 hourly samples = 25 h span;
    expect(q.driftFlags).toHaveLength(1);
    expect(q.driftFlags[0].label).toBe("poa_irradiance");
    expect(q.driftFlags[0].maxDivergencePct).toBeGreaterThan(2);
  });

  it("does not flag a 2 h divergence", () => {
    const q = dataQuality(PERIOD, POLL, ["good"], [pair(2, 3)]);
    expect(q.driftFlags).toHaveLength(0);
  });
});
