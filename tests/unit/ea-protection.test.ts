// P-168 — Unit coverage for the protection/harmonics/grounding/arc-flash worksheets.
import { describe, expect, it } from "vitest";

import { arcFlashDataPrep, arcFlashInputSchema, ARC_FLASH_DISCLAIMER } from "@/lib/electrical/arc-flash";
import { groundingInputSchema, groundingWorksheet } from "@/lib/electrical/grounding";
import { harmonicsInputSchema, harmonicsWorksheet } from "@/lib/electrical/harmonics";
import { CALCULATORS, isCalculatorStudyType } from "@/lib/electrical";
import {
  mapSldObjectsToDevices,
  nextSettingRevision,
  ANSI_FUNCTION_CODES,
  isAnsiFunctionCode,
} from "@/lib/ea/protection";

describe("protection schedule mapping", () => {
  const objects = [
    {
      id: "o1",
      symbol_type: "circuit_breaker",
      tag: "52-01",
      label: "Incomer breaker",
      properties: { voltage_kv: 33, rated_current_a: "630", ansi_codes: "50, 51, 51N" },
    },
    { id: "o2", symbol_type: "inverter", tag: "INV-01", label: null, properties: {} },
    { id: "o3", symbol_type: "fuse", tag: null, label: "untagged", properties: {} },
    { id: "o4", symbol_type: "protection_relay", tag: "52-01", label: "dup", properties: {} },
    { id: "o5", symbol_type: "disconnector", tag: "DS-01", label: null, properties: {} },
  ];

  it("keeps only tagged protection-class objects and drops duplicate tags", () => {
    const rows = mapSldObjectsToDevices(objects);
    expect(rows.map((r) => r.tag)).toEqual(["52-01", "DS-01"]);
  });

  it("normalises properties into typed columns", () => {
    const [breaker] = mapSldObjectsToDevices(objects);
    expect(breaker.device_type).toBe("circuit_breaker");
    expect(breaker.voltage_kv).toBe(33);
    expect(breaker.rated_current_a).toBe(630);
    expect(breaker.ansi_codes).toEqual(["50", "51", "51N"]);
    expect(breaker.notes).toBe("Incomer breaker");
  });

  it("is idempotent — mapping the same graph twice yields identical rows", () => {
    expect(mapSldObjectsToDevices(objects)).toEqual(mapSldObjectsToDevices(objects));
  });

  it("revisions relay settings instead of mutating", () => {
    expect(nextSettingRevision([])).toBe(0);
    expect(nextSettingRevision([0])).toBe(1);
    expect(nextSettingRevision([0, 1, 4])).toBe(5);
  });

  it("exposes the ANSI picklist", () => {
    expect(ANSI_FUNCTION_CODES).toContain("51N");
    expect(ANSI_FUNCTION_CODES).toHaveLength(11);
    expect(isAnsiFunctionCode("51")).toBe(true);
    expect(isAnsiFunctionCode("87T")).toBe(false);
  });
});

describe("harmonics worksheet", () => {
  const base = {
    sources: [
      { order: 5, magnitudePctOfFundamental: 3, label: "inverters" },
      { order: 7, magnitudePctOfFundamental: 2, label: "inverters" },
    ],
    backgroundThdPct: 0,
    sccMvaAtPoi: 500,
    loadCurrentA: 1000,
  };

  it("computes THD as the RMS sum over the fundamental", () => {
    const { results } = harmonicsWorksheet(harmonicsInputSchema.parse(base));
    expect(results.thdPct).toBeCloseTo(Math.hypot(3, 2), 4);
    expect(results.tddPct).toBeCloseTo(results.thdPct, 6);
  });

  it("flags exceedances as warnings only, never as a compliance verdict", () => {
    const hot = harmonicsWorksheet(
      harmonicsInputSchema.parse({
        ...base,
        sources: [{ order: 5, magnitudePctOfFundamental: 6, label: "" }],
      }),
    );
    expect(hot.results.exceedingOrders).toEqual([5]);
    const codes = hot.warnings.map((w) => w.code);
    expect(codes).toContain("harmonic_order_exceeds_limit");
    expect(hot.warnings.every((w) => w.severity !== "critical")).toBe(true);
    expect(hot.warnings.some((w) => /no compliance determination/i.test(w.message))).toBe(true);
  });

  it("honours a project-specific limit table", () => {
    const strict = harmonicsWorksheet(
      harmonicsInputSchema.parse({
        ...base,
        limits: [{ orderMin: 2, orderMax: 40, limitPct: 1 }],
        tddLimitPct: 1,
      }),
    );
    expect(strict.results.exceedingOrders).toEqual([5, 7]);
    expect(strict.results.tddExceeds).toBe(true);
  });

  it("adds same-order contributions arithmetically", () => {
    const merged = harmonicsWorksheet(
      harmonicsInputSchema.parse({
        ...base,
        sources: [
          { order: 5, magnitudePctOfFundamental: 1, label: "a" },
          { order: 5, magnitudePctOfFundamental: 2, label: "b" },
        ],
      }),
    );
    expect(merged.results.orders).toHaveLength(1);
    expect(merged.results.orders[0].distortionPct).toBe(3);
  });
});

describe("grounding screening worksheet", () => {
  const base = {
    gridLengthM: 100,
    gridWidthM: 80,
    burialDepthM: 0.6,
    conductorMm2: 120,
    soilResistivityOhmM: 100,
    faultCurrentKa: 10,
    clearingTimeS: 0.5,
    bodyWeightKg: 70,
  };

  it("computes a plausible Sverak resistance and GPR", () => {
    const { results } = groundingWorksheet(groundingInputSchema.parse(base));
    expect(results.gridResistanceOhm).toBeGreaterThan(0.1);
    expect(results.gridResistanceOhm).toBeLessThan(2);
    expect(results.gprVolts).toBeCloseTo(results.gridResistanceOhm * 10000, 0);
  });

  it("uses the 70 kg body constant and scales with clearing time", () => {
    const { results } = groundingWorksheet(groundingInputSchema.parse(base));
    expect(results.bodyFactor).toBe(0.157);
    expect(results.tolerableTouchV).toBeCloseTo((1150 * 0.157) / Math.sqrt(0.5), 2);
    expect(results.tolerableStepV).toBeGreaterThan(results.tolerableTouchV);
  });

  it("demands a detailed analysis when the screen fails", () => {
    const bad = groundingWorksheet(
      groundingInputSchema.parse({ ...base, soilResistivityOhmM: 1000, faultCurrentKa: 25 }),
    );
    expect(bad.results.touchScreenPass).toBe(false);
    const failure = bad.warnings.find((w) => w.code === "touch_screen_failed");
    expect(failure?.message).toMatch(/detailed IEEE 80 analysis required/i);
  });

  it("screens the conductor thermal minimum", () => {
    const thin = groundingWorksheet(groundingInputSchema.parse({ ...base, conductorMm2: 25 }));
    expect(thin.results.minConductorMm2).toBeCloseTo(10 * 7 * Math.sqrt(0.5), 2);
    expect(thin.results.conductorScreenPass).toBe(false);
    expect(thin.warnings.map((w) => w.code)).toContain("conductor_undersized");
  });
});

describe("arc-flash data preparation", () => {
  const complete = {
    tag: "SWGR-01",
    equipmentType: "switchgear",
    voltageV: 400,
    boltedFaultKa: 25,
    boltedFaultSource: "short_circuit_study" as const,
    workingDistanceMm: 455,
    gapMm: 32,
    enclosure: "vcb" as const,
    clearingTimeS: 0.2,
    clearingTimeSource: "relay_setting_approved" as const,
  };

  it("never returns an incident energy and always labels itself", () => {
    const out = arcFlashDataPrep(arcFlashInputSchema.parse({ equipment: [complete] }));
    expect(out.results.disclaimer).toBe(ARC_FLASH_DISCLAIMER);
    expect(out.results.disclaimer).toMatch(/Data preparation only/);
    expect(JSON.stringify(out.results)).not.toMatch(/incidentEnergy|cal\/cm/i);
    expect(out.warnings.map((w) => w.code)).toContain("data_preparation_only");
  });

  it("reports full readiness when every field is present and traceable", () => {
    const out = arcFlashDataPrep(arcFlashInputSchema.parse({ equipment: [complete] }));
    expect(out.results.readyForStudy).toBe(true);
    expect(out.results.readinessPct).toBe(100);
    expect(out.results.gaps).toHaveLength(0);
  });

  it("lists every missing field as a gap", () => {
    const out = arcFlashDataPrep(
      arcFlashInputSchema.parse({
        equipment: [{ ...complete, tag: "MCC-01", gapMm: null, clearingTimeSource: "assumed" }],
      }),
    );
    expect(out.results.readyForStudy).toBe(false);
    expect(out.results.gaps.map((g) => g.field)).toEqual(
      expect.arrayContaining(["gapMm", "clearingTimeSource"]),
    );
    expect(out.warnings.map((w) => w.code)).toContain("untraceable_clearing_time");
  });
});

describe("calculator registry", () => {
  it("wires the three P-168 worksheets", () => {
    for (const type of ["harmonics", "grounding", "arc_flash"]) {
      expect(isCalculatorStudyType(type)).toBe(true);
      expect(CALCULATORS[type as keyof typeof CALCULATORS].method.length).toBeGreaterThan(50);
    }
  });
});
