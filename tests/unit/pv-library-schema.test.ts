// P-150 — PV equipment library schema guards.
import { describe, expect, it } from "vitest";

import {
  isCertificationExpired,
  pvEquipmentSchema,
} from "@/lib/pv-library.schemas";

const base = {
  category: "inverter" as const,
  manufacturer: "Sungrow",
  model: "SG350HX",
  is_active: true,
};

describe("pvEquipmentSchema", () => {
  it("rejects MPPT min >= max", () => {
    const res = pvEquipmentSchema.safeParse({
      ...base,
      electrical: { mppt_v_min: 900, mppt_v_max: 800 },
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid MPPT window", () => {
    const res = pvEquipmentSchema.safeParse({
      ...base,
      electrical: { mppt_v_min: 500, mppt_v_max: 1500, euro_efficiency_pct: 98.9 },
    });
    expect(res.success).toBe(true);
  });

  it("rejects efficiency outside 80–99.5%", () => {
    expect(
      pvEquipmentSchema.safeParse({ ...base, electrical: { efficiency_pct: 79.9 } }).success,
    ).toBe(false);
    expect(
      pvEquipmentSchema.safeParse({ ...base, electrical: { efficiency_pct: 99.6 } }).success,
    ).toBe(false);
  });

  it("rejects Voc at or above the max system voltage", () => {
    const res = pvEquipmentSchema.safeParse({
      ...base,
      category: "module",
      electrical: { voc_v: 1500 },
      limits: { max_system_voltage_v: 1500 },
    });
    expect(res.success).toBe(false);
  });

  it("rejects non-positive dimensions", () => {
    const res = pvEquipmentSchema.safeParse({ ...base, dimensions: { length_mm: 0 } });
    expect(res.success).toBe(false);
  });

  it("flags expired certifications only", () => {
    expect(isCertificationExpired("2020-01-01", new Date("2026-01-01"))).toBe(true);
    expect(isCertificationExpired("2030-01-01", new Date("2026-01-01"))).toBe(false);
    expect(isCertificationExpired(null)).toBe(false);
  });
});
