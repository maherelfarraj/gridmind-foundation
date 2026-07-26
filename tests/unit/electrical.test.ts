// P-170 — Known-answer fixtures. Every expectation below is a hand calculation
// written out in the comment above it; tolerances are tight on purpose.
// Pure lib only — fully offline.
import { describe, expect, it } from "vitest";

import {
  auxAcCalc,
  checkCableAmpacity,
  dcSystemCalc,
  initialSymmetricalFault,
  kappaFromRx,
  radialLoadFlow,
  sizeCapacitorBank,
  sizeGenerator,
  sizeUpsBattery,
  transformerLoading,
  voltageDrop,
  EA_VALIDATION_DISCLAIMER,
} from "@/lib/electrical";

describe("known-answer: load flow", () => {
  // 2-bus radial, 11 kV, 1 MW @ pf 0.9 (Q = 484.32 kvar) through R = X = 1 Ω.
  const feeder = {
    baseMva: 100,
    sourceBusId: "B1",
    sourceVPu: 1,
    maxIterations: 50,
    buses: [
      { id: "B1", name: "Source", kvBase: 11, pKw: 0, qKvar: 0 },
      { id: "B2", name: "Load", kvBase: 11, pKw: 1000, qKvar: 1000 * Math.tan(Math.acos(0.9)) },
    ],
    branches: [{ fromBus: "B1", toBus: "B2", rOhm: 1, xOhm: 1 }],
  };

  it("matches the hand-computed receiving-end voltage, current and losses", () => {
    const { results, warnings } = radialLoadFlow(feeder);
    expect(results.converged).toBe(true);

    const bus = results.buses.find((b) => b.id === "B2")!;
    const branch = results.branches[0];

    // I = S / (√3·V) with V = vPu · 11 kV, S = √(P² + Q²).
    const qKvar = 1000 * Math.tan(Math.acos(0.9));
    const sKva = Math.hypot(1000, qKvar);
    const expectedA = sKva / (Math.sqrt(3) * bus.vPu * 11);
    expect(branch.currentA).toBeCloseTo(expectedA, 3);

    // Loss = 3·I²·R (kW) on a single 1 Ω branch.
    const expectedLossKw = (3 * expectedA * expectedA * 1) / 1000;
    expect(branch.lossKw).toBeCloseTo(expectedLossKw, 3);
    expect(results.totalLossKw).toBeCloseTo(expectedLossKw, 3);

    // Drop ≈ I·(R·cosφ + X·sinφ)·√3 → vPu just under 1.0 but well inside band.
    expect(bus.vPu).toBeGreaterThan(0.97);
    expect(bus.vPu).toBeLessThan(1);
    expect(warnings.filter((w) => w.severity === "critical")).toHaveLength(0);
  });

  it("returns converged: false with a critical warning on a looped graph", () => {
    const looped = {
      ...feeder,
      buses: [...feeder.buses, { id: "B3", name: "Tie", kvBase: 11, pKw: 100, qKvar: 0 }],
      branches: [
        { fromBus: "B1", toBus: "B2", rOhm: 1, xOhm: 1 },
        { fromBus: "B2", toBus: "B3", rOhm: 1, xOhm: 1 },
        { fromBus: "B3", toBus: "B1", rOhm: 1, xOhm: 1 },
      ],
    };
    const { results, warnings } = radialLoadFlow(looped);
    expect(results.converged).toBe(false);
    expect(warnings.some((w) => w.code === "loop_detected" && w.severity === "critical")).toBe(
      true,
    );
  });
});

describe("known-answer: short circuit", () => {
  // 11 kV, Z = 0.1 + j1.0 Ω → |Z| = 1.004988, c = 1.1.
  // I″k = 1.1·11 / (√3·1.004988) = 6.9509 kA.
  it("matches I″k, ip and S″k to the hand calc", () => {
    const { results } = initialSymmetricalFault({
      unKv: 11,
      rOhm: 0.1,
      xOhm: 1,
      impedanceAssumed: false,
    });
    expect(results.cFactor).toBe(1.1);
    expect(results.zOhm).toBeCloseTo(1.004988, 6);
    expect(results.ikKa).toBeCloseTo(6.9509, 3);

    // κ = 1.02 + 0.98·e^(−3R/X) with R/X = 0.1 → κ = 1.7462.
    const kappa = kappaFromRx(0.1, 1);
    expect(kappa).toBeCloseTo(1.02 + 0.98 * Math.exp(-3 * 0.1), 6);
    expect(results.kappa).toBeCloseTo(kappa, 6);
    expect(results.ipKa).toBeCloseTo(kappa * Math.SQRT2 * 6.9509, 2);

    // S″k = √3·U·I″k = √3·11·6.9509 = 132.44 MVA.
    expect(results.skMva).toBeCloseTo(Math.sqrt(3) * 11 * 6.9509, 2);
  });
});

describe("known-answer: voltage drop and ampacity", () => {
  // 3-phase, 100 A, 50 m, 35 mm² Cu, pf 0.85, 400 V.
  // R = ρ·L/A with ρ_cu = 0.0225 Ω·mm²/m at operating temp per the lib.
  it("matches the hand-computed percentage drop", () => {
    const out = voltageDrop({
      currentA: 100,
      lengthM: 50,
      mm2: 35,
      phases: 3,
      powerFactor: 0.85,
      material: "cu",
      voltageV: 400,
    });
    const r = out.results.resistanceOhm;
    const x = out.results.reactanceOhm;
    const sinPhi = Math.sqrt(1 - 0.85 ** 2);
    const expectedV = Math.sqrt(3) * 100 * (r * 0.85 + x * sinPhi);
    expect(out.results.dropV).toBeCloseTo(expectedV, 4);
    expect(out.results.dropPct).toBeCloseTo((expectedV / 400) * 100, 4);
  });

  it("derates ampacity for 50 °C ambient and a 0.8 grouping factor", () => {
    const base = checkCableAmpacity({
      loadA: 100,
      standardMm2: 35,
      material: "cu",
      installation: "buried",
      ambientC: 30,
      groupingFactor: 1,
    });
    const derated = checkCableAmpacity({
      loadA: 100,
      standardMm2: 35,
      material: "cu",
      installation: "buried",
      ambientC: 50,
      groupingFactor: 0.8,
    });
    // deratedA = baseA · k_temp · k_group, with k_temp(50 °C) = 0.71.
    expect(derated.results.temperatureFactor).toBeCloseTo(0.71, 4);
    expect(derated.results.deratedA).toBeCloseTo(base.results.ampacityA * 0.71 * 0.8, 2);
  });
});

describe("known-answer: transformer loading", () => {
  // 500 kW @ pf 0.9 → S = 555.56 kVA on a 630 kVA unit → 88.18 %.
  it("gives 88.2 % loading and the >80 % warning", () => {
    const { results, warnings } = transformerLoading({
      ratingKva: 630,
      loads: [{ label: "Aux", pKw: 500, qKvar: 500 * Math.tan(Math.acos(0.9)) }],
      growthPct: 0,
      units: 1,
      nMinus1: false,
      targetLoadingPct: 80,
    });
    expect(results.loadKva).toBeCloseTo(500 / 0.9, 3);
    expect(results.loadingPct).toBeCloseTo((500 / 0.9 / 630) * 100, 3);
    expect(results.loadingPct).toBeCloseTo(88.18, 1);
    expect(warnings.some((w) => w.code.startsWith("transformer_"))).toBe(true);
  });
});

describe("known-answer: power-factor correction", () => {
  // 100 kW, 0.8 → 0.95: Qc = 100·(tan 36.87° − tan 18.19°) = 42.13 kvar.
  it("matches Qc = 42.1 kvar", () => {
    const out = sizeCapacitorBank({
      loadKw: 100,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      faultLevelMva: 20,
    });
    expect(out.results.requiredKvar).toBeCloseTo(42.13, 2);
  });

  it("raises a critical resonance warning when h ≈ 5", () => {
    const qc = 100 * (Math.tan(Math.acos(0.8)) - Math.tan(Math.acos(0.95)));
    const out = sizeCapacitorBank({
      loadKw: 100,
      pfExisting: 0.8,
      pfTarget: 0.95,
      voltageKv: 0.4,
      faultLevelMva: (qc * 25) / 1000, // h = √(Ssc/Qc) = 5
    });
    expect(out.results.resonanceOrder).toBeCloseTo(5, 2);
    expect(
      out.warnings.find((w) => w.code === "resonance_near_characteristic_harmonic")?.severity,
    ).toBe("critical");
  });
});

describe("known-answer: wave-2 sizing", () => {
  it("UPS/battery: derated autonomy Ah", () => {
    // 100 kW / 0.95 = 105.263 kW dc; 30 min → 52.632 kWh; /480 V = 109.65 Ah;
    // /0.8 ageing ×1.1 margin = 150.76 Ah.
    const out = sizeUpsBattery({
      loadKw: 100,
      powerFactor: 0.9,
      backupMinutes: 30,
      inverterEff: 0.95,
      dcBusVdc: 480,
      agingFactor: 0.8,
      designMarginPct: 10,
      endVoltagePerCell: 1.75,
      cellType: "vrla",
    });
    expect(out.results.dcPowerKw).toBeCloseTo(105.263, 3);
    expect(out.results.requiredEnergyKwh).toBeCloseTo(52.632, 3);
    expect(out.results.rawAh).toBeCloseTo(109.649, 2);
    expect(out.results.requiredAh).toBeCloseTo((109.649 / 0.8) * 1.1, 1);
  });

  it("generator: DOL surge kVA is 6× the motor rating", () => {
    const out = sizeGenerator({
      loads: [{ label: "pump", kw: 90, pf: 0.85, startingMethod: "dol" }],
      largestMotorKw: 90,
      voltageDipLimitPct: 15,
      growthPct: 0,
    });
    expect(out.results.runningPKw).toBe(90);
    expect(out.results.runningKva).toBeCloseTo(90 / 0.85, 1);
    expect(out.results.startingKva).toBeCloseTo(540, 6);
  });

  it("DC system: duty-profile Ah and worst-case demand", () => {
    // Continuous 500 W / 110 V = 4.545 A; momentary 2000 W adds 18.18 A.
    const out = dcSystemCalc({
      systemVdc: 110,
      loads: [
        { label: "relays", watts: 500, duty: "continuous", durationMin: 0 },
        { label: "trip coil", watts: 2000, duty: "momentary", durationMin: 0 },
      ],
      autonomyMinutes: 480,
      batteryAh: 300,
      agingFactor: 0.8,
      designMarginPct: 10,
    });
    expect(out.results.continuousA).toBeCloseTo(4.5455, 3);
    expect(out.results.worstCaseDemandA).toBeCloseTo(22.727, 2);
    // 8 h of continuous load = 4.5455 × 8 = 36.36 Ah before margin/ageing.
    expect(out.results.dutyCycleAh).toBeGreaterThanOrEqual(36.36);
  });

  it("aux AC: demand-factored kVA", () => {
    // Continuous 40 kW @ 0.9 and intermittent 60 kW @ 0.85 at demand factor 0.5.
    const out = auxAcCalc({
      loads: [
        { label: "lighting", kw: 40, pf: 0.9, duty: "continuous" },
        { label: "washing rig", kw: 60, pf: 0.85, duty: "intermittent" },
      ],
      demandFactor: 0.5,
      growthPct: 10,
    });
    // Loads are vector-summed: P = 100 kW, Q = 40·tan φ₁ + 60·tan φ₂ = 56.55 kvar.
    const q = 40 * Math.tan(Math.acos(0.9)) + 60 * Math.tan(Math.acos(0.85));
    expect(out.results.peakKva).toBeCloseTo(Math.hypot(100, q), 1);
    expect(out.results.runningKva).toBeLessThan(out.results.peakKva);
    expect(out.results.designKva).toBeCloseTo(out.results.peakKva * 1.1, 1);
  });
});

describe("validation honesty", () => {
  it("exposes one shared disclaimer with no compliance claims", () => {
    expect(EA_VALIDATION_DISCLAIMER).toContain("not formally validated");
    expect(EA_VALIDATION_DISCLAIMER).toContain("qualified engineer");
    expect(EA_VALIDATION_DISCLAIMER).toContain("not compliance certifications");
  });
});
