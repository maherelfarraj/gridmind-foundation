// P-167 — Smoke tests for the wave-2 electrical calculators.
// Known-answer fixtures land in P-170; these prove envelope, math shape and warnings.
import { describe, expect, it } from "vitest";

import {
  auxAcCalc,
  dcSystemCalc,
  getCalculator,
  isCalculatorStudyType,
  pfCorrectionCheck,
  reactivePowerRequirement,
  sizeCapacitorBank,
  sizeGenerator,
  sizeUpsBattery,
  CALCULATOR_STUDY_TYPES,
  WAVE2_STUDY_TYPES,
} from "@/lib/electrical";

const codes = (warnings: { code: string }[]) => warnings.map((w) => w.code);

describe("sizeUpsBattery", () => {
  const base = {
    loadKw: 100,
    powerFactor: 0.9,
    backupMinutes: 30,
    inverterEff: 0.95,
    dcBusVdc: 480,
    agingFactor: 0.8,
    designMarginPct: 10,
    endVoltagePerCell: 1.75,
    cellType: "vrla" as const,
  };

  it("computes DC energy, Ah and a standard UPS rating", () => {
    const out = sizeUpsBattery(base);
    // 100 kW / 0.95 = 105.263 kW dc -> 52.63 kWh over 30 min -> 109.65 Ah raw.
    expect(out.results.dcPowerKw).toBeCloseTo(105.263, 2);
    expect(out.results.requiredEnergyKwh).toBeCloseTo(52.632, 2);
    expect(out.results.rawAh).toBeCloseTo(109.65, 1);
    expect(out.results.requiredAh).toBeCloseTo((109.65 / 0.8) * 1.1, 0);
    expect(out.results.cellsInSeries).toBe(Math.ceil(480 / 1.75));
    expect(out.results.suggestedUpsKva).toBe(120);
    expect(out.assumptionsEcho.length).toBeGreaterThan(0);
    expect(out.results.inputSheet.loadKw).toBe(100);
  });

  it("flags autonomy below target once ageing and margin are applied", () => {
    const out = sizeUpsBattery({ ...base, installedAh: 40 });
    expect(out.results.autonomyOk).toBe(false);
    expect(codes(out.warnings)).toContain("autonomy_below_target");
    expect(out.warnings.find((w) => w.code === "autonomy_below_target")?.severity).toBe("critical");
  });

  it("suggests parallel strings above the single-string limit", () => {
    const out = sizeUpsBattery({ ...base, backupMinutes: 480 });
    expect(out.results.parallelStringsSuggested).toBeGreaterThan(1);
    expect(codes(out.warnings)).toContain("parallel_strings_required");
  });
});

describe("sizeGenerator", () => {
  const loads = [
    { label: "process", kw: 200, pf: 0.85, startingMethod: "none" as const },
    { label: "pump", kw: 90, pf: 0.85, startingMethod: "dol" as const },
  ];

  it("reports running and starting kVA", () => {
    const out = sizeGenerator({ loads, largestMotorKw: 90, voltageDipLimitPct: 15, growthPct: 10 });
    expect(out.results.runningPKw).toBe(290);
    expect(out.results.runningKva).toBeGreaterThan(290);
    expect(out.results.startingKva).toBe(540); // 90 kW × 6 (DOL)
    expect(out.results.surgeKva).toBeGreaterThan(out.results.designKva);
    expect(out.results.selectedKva).toBeGreaterThanOrEqual(out.results.designKva);
  });

  it("warns when DOL starting dips the bus past the limit", () => {
    const out = sizeGenerator({
      loads: [{ label: "big pump", kw: 200, pf: 0.85, startingMethod: "dol" }],
      largestMotorKw: 200,
      voltageDipLimitPct: 5,
      growthPct: 0,
    });
    expect(codes(out.warnings)).toContain("voltage_dip_exceeded");
  });

  it("soft-start reduces the dip relative to DOL", () => {
    const dol = sizeGenerator({
      loads: [{ kw: 100, pf: 0.85, startingMethod: "dol" }],
      largestMotorKw: 100,
    });
    const soft = sizeGenerator({
      loads: [{ kw: 100, pf: 0.85, startingMethod: "soft_start" }],
      largestMotorKw: 100,
    });
    expect(soft.results.startingKva).toBeLessThan(dol.results.startingKva);
    expect(soft.results.voltageDipPct).toBeLessThan(dol.results.voltageDipPct);
  });

  it("flags wet-stacking risk when the set is barely loaded", () => {
    const out = sizeGenerator({
      loads: [{ kw: 20, pf: 0.85, startingMethod: "dol" }],
      largestMotorKw: 20,
      voltageDipLimitPct: 5,
    });
    expect(codes(out.warnings)).toContain("low_loading_wet_stacking");
  });
});

describe("sizeCapacitorBank", () => {
  it("matches Qc = P·(tan φ₁ − tan φ₂) and splits into steps", () => {
    const out = sizeCapacitorBank({
      loadKw: 1000,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      steps: 4,
      faultLevelMva: 50,
    });
    const expected = 1000 * (Math.tan(Math.acos(0.8)) - Math.tan(Math.acos(0.95)));
    expect(out.results.requiredKvar).toBeCloseTo(expected, 2);
    expect(out.results.stepKvar).toBeCloseTo(expected / 4, 2);
    expect(out.results.totalCurrentA).toBeCloseTo(expected / (Math.sqrt(3) * 0.4), 0);
  });

  it("flags a critical resonance warning near the 5th harmonic", () => {
    // h = sqrt(Ssc/Qc) ≈ 5 → Qc ≈ Ssc(kvar)/25.
    const qc = 1000 * (Math.tan(Math.acos(0.8)) - Math.tan(Math.acos(0.95)));
    const out = sizeCapacitorBank({
      loadKw: 1000,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      faultLevelMva: (qc * 25) / 1000,
    });
    expect(out.results.resonanceOrder).toBeCloseTo(5, 2);
    expect(out.results.detunedReactorRequired).toBe(true);
    expect(
      out.warnings.find((w) => w.code === "resonance_near_characteristic_harmonic")?.severity,
    ).toBe("critical");
  });

  it("flags the 7th harmonic too, and stays quiet away from both", () => {
    const qc = 1000 * (Math.tan(Math.acos(0.8)) - Math.tan(Math.acos(0.95)));
    const seventh = sizeCapacitorBank({
      loadKw: 1000,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      faultLevelMva: (qc * 49) / 1000,
    });
    expect(seventh.results.detunedReactorRequired).toBe(true);

    const clear = sizeCapacitorBank({
      loadKw: 1000,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      faultLevelMva: (qc * 81) / 1000,
    });
    expect(clear.results.detunedReactorRequired).toBe(false);
  });

  it("treats a missing fault level as a critical gap", () => {
    const out = sizeCapacitorBank({ loadKw: 500, pfExisting: 0.85, voltageKv: 11 });
    expect(out.warnings.find((w) => w.code === "fault_level_missing")?.severity).toBe("critical");
    expect(out.results.resonanceOrder).toBeNull();
  });
});

describe("reactive power and pf correction", () => {
  it("returns S, Q and φ for the reactive_power study", () => {
    const out = reactivePowerRequirement({ loadKw: 800, pf: 0.8 });
    expect(out.results.apparentKva).toBe(1000);
    expect(out.results.reactiveKvar).toBeCloseTo(600, 1);
    expect(out.results.phiDeg).toBeCloseTo(36.87, 1);
    expect(codes(out.warnings)).toContain("poor_power_factor");
  });

  it("checks the installed bank back against the target", () => {
    const out = pfCorrectionCheck({
      loadKw: 1000,
      pfBefore: 0.8,
      qInstalledKvar: 422,
      pfAfter: 0.95,
    });
    expect(out.results.achievedPf).toBeGreaterThanOrEqual(0.95);
    expect(out.results.targetMet).toBe(true);
    expect(out.results.leading).toBe(false);
  });

  it("flags over-compensation as critical", () => {
    const out = pfCorrectionCheck({ loadKw: 1000, pfBefore: 0.9, qInstalledKvar: 900 });
    expect(out.results.leading).toBe(true);
    expect(out.warnings.find((w) => w.code === "leading_power_factor")?.severity).toBe("critical");
  });
});

describe("dcSystemCalc", () => {
  const loads = [
    { label: "relays", watts: 500, duty: "continuous" as const, durationMin: 0 },
    { label: "motorised switch", watts: 2000, duty: "momentary" as const, durationMin: 0 },
    { label: "comms", watts: 300, duty: "intermittent" as const, durationMin: 60 },
  ];

  it("builds the duty-cycle profile and required Ah", () => {
    const out = dcSystemCalc({
      systemVdc: 110,
      loads,
      autonomyMinutes: 480,
      batteryAh: 300,
      agingFactor: 0.8,
      designMarginPct: 10,
      rechargeHours: 12,
    });
    expect(out.results.profile).toHaveLength(3);
    expect(out.results.continuousA).toBeCloseTo(500 / 110, 3);
    expect(out.results.worstCaseDemandA).toBeCloseTo(2800 / 110, 2);
    expect(out.results.dutyCycleAh).toBeGreaterThan(0);
    expect(out.results.autonomyOk).toBe(true);
  });

  it("warns critically when the installed battery misses the autonomy target", () => {
    const out = dcSystemCalc({
      systemVdc: 110,
      loads,
      autonomyMinutes: 480,
      batteryAh: 20,
    });
    expect(out.results.autonomyOk).toBe(false);
    expect(out.results.achievableMinutes).toBeLessThan(480);
    expect(codes(out.warnings)).toContain("autonomy_below_target");
  });

  it("sizes the charger and flags an undersized one", () => {
    const out = dcSystemCalc({
      systemVdc: 110,
      loads,
      batteryAh: 300,
      rechargeHours: 10,
      installedChargerA: 5,
    });
    expect(out.results.chargerFloatA).toBeCloseTo(500 / 110 + 30, 2);
    expect(out.results.chargerBoostA).toBeGreaterThan(out.results.chargerFloatA);
    expect(out.results.chargerOk).toBe(false);
    expect(codes(out.warnings)).toContain("charger_undersized");
  });
});

describe("auxAcCalc", () => {
  it("demand-factors intermittent load and suggests a standard transformer", () => {
    const out = auxAcCalc({
      loads: [
        { label: "lighting", kw: 40, pf: 0.9, duty: "continuous" },
        { label: "washing rig", kw: 60, pf: 0.85, duty: "intermittent" },
      ],
      demandFactor: 0.5,
      growthPct: 10,
    });
    expect(out.results.runningKva).toBeLessThan(out.results.peakKva);
    expect(out.results.designKva).toBeCloseTo(out.results.peakKva * 1.1, 1);
    expect(out.results.suggestedTransformerKva).toBeGreaterThanOrEqual(out.results.designKva);
    expect(out.results.loadingPct).toBeLessThanOrEqual(80);
  });

  it("notes when standby loads dominate the rating", () => {
    const out = auxAcCalc({
      loads: [
        { label: "small aux", kw: 5, pf: 0.9, duty: "continuous" },
        { label: "fire pump", kw: 90, pf: 0.85, duty: "standby" },
      ],
    });
    expect(out.results.standbySharePct).toBeGreaterThan(50);
    expect(codes(out.warnings)).toContain("standby_dominates_rating");
  });
});

describe("registry wiring", () => {
  it("exposes every wave-2 study type with schema, method and compute", () => {
    expect(WAVE2_STUDY_TYPES).toEqual([
      "ups_battery",
      "generator_sizing",
      "capacitor_bank",
      "reactive_power",
      "pf_correction",
      "dc_system",
      "aux_ac",
    ]);
    for (const type of WAVE2_STUDY_TYPES) {
      const calc = getCalculator(type);
      expect(calc.studyType).toBe(type);
      expect(calc.method.length).toBeGreaterThan(40);
      expect(isCalculatorStudyType(type)).toBe(true);
    }
    expect(CALCULATOR_STUDY_TYPES).toHaveLength(15); // + the three P-168 worksheets
  });

  it("rejects an invalid input sheet through the registry schema", () => {
    expect(() => getCalculator("ups_battery").compute({ loadKw: -1 })).toThrow();
    expect(isCalculatorStudyType("motor_starting")).toBe(false);
  });
});
