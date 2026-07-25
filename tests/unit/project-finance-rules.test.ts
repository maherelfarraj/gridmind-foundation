// P-082 — Unit tests for project-finance rules.
import { describe, expect, it } from "vitest";

import {
  assertDrawdownAllowed,
  computeLcoe,
  ddReadinessBucket,
  ddReadinessSummary,
  facilityUtilizationPct,
  isDdOverdue,
  LcoeUpsertSchema,
  PpaUpsertSchema,
  ppaYearOneRevenue,
} from "@/lib/project-finance.rules";

describe("ppaYearOneRevenue", () => {
  it("multiplies tariff by annual energy", () => {
    expect(ppaYearOneRevenue(55, 260_000)).toBe(14_300_000);
  });
  it("returns 0 when energy is missing", () => {
    expect(ppaYearOneRevenue(55, null)).toBe(0);
    expect(ppaYearOneRevenue(55, 0)).toBe(0);
  });
});

describe("computeLcoe", () => {
  it("matches hand calc for the spec scenario ($/MWh)", () => {
    // capex $120M, opex $1.8M, r 7%, 260 GWh/yr, 25y, 0.5% deg
    const v = computeLcoe({
      capex: 120_000_000,
      opex_annual: 1_800_000,
      discount_rate_pct: 7,
      annual_energy_mwh: 260_000,
      degradation_pct: 0.5,
      project_life_years: 25,
    });
    // Result is per-MWh. Expected ≈ 48.56 $/MWh (≈ 0.0486 $/kWh).
    expect(v).toBeGreaterThan(48);
    expect(v).toBeLessThan(49);
    expect(v).toBeCloseTo(48.56, 1);
  });

  it("increases as opex increases", () => {
    const base = computeLcoe({
      capex: 100_000_000,
      opex_annual: 1_000_000,
      discount_rate_pct: 6,
      annual_energy_mwh: 200_000,
      degradation_pct: 0.5,
      project_life_years: 25,
    });
    const higherOpex = computeLcoe({
      capex: 100_000_000,
      opex_annual: 2_000_000,
      discount_rate_pct: 6,
      annual_energy_mwh: 200_000,
      degradation_pct: 0.5,
      project_life_years: 25,
    });
    expect(higherOpex).toBeGreaterThan(base);
  });

  it("throws when energy is 0", () => {
    expect(() =>
      computeLcoe({
        capex: 1,
        opex_annual: 1,
        discount_rate_pct: 5,
        annual_energy_mwh: 0,
        degradation_pct: 0.5,
        project_life_years: 25,
      }),
    ).toThrow();
  });
});

describe("facility utilization + drawdown guard", () => {
  it("computes utilization", () => {
    expect(facilityUtilizationPct(30_000_000, 80_000_000)).toBeCloseTo(37.5);
    expect(facilityUtilizationPct(0, 0)).toBe(0);
  });
  it("permits drawdowns up to commitment", () => {
    expect(() => assertDrawdownAllowed(50, 50, 100)).not.toThrow();
  });
  it("rejects over-commitment drawdowns", () => {
    expect(() => assertDrawdownAllowed(80, 30, 100)).toThrow();
  });
  it("rejects non-positive drawdowns", () => {
    expect(() => assertDrawdownAllowed(0, 0, 100)).toThrow();
    expect(() => assertDrawdownAllowed(0, -1, 100)).toThrow();
  });
});

describe("DD readiness", () => {
  it("counts accepted + waived", () => {
    const s = ddReadinessSummary([
      { status: "accepted" },
      { status: "accepted" },
      { status: "waived" },
      { status: "submitted" },
      { status: "in_progress" },
      { status: "not_started" },
    ]);
    expect(s.total).toBe(6);
    expect(s.readinessPct).toBeCloseTo(50);
  });
  it("returns 0 when empty", () => {
    expect(ddReadinessSummary([]).readinessPct).toBe(0);
  });
  it("bucket flips at 80%", () => {
    expect(ddReadinessBucket(79.9)).toBe("warn");
    expect(ddReadinessBucket(80)).toBe("ok");
  });
  it("overdue only counts open statuses", () => {
    const yesterday = new Date(Date.UTC(2026, 0, 1));
    const now = new Date(Date.UTC(2026, 0, 10));
    expect(
      isDdOverdue(yesterday.toISOString().slice(0, 10), "submitted", now),
    ).toBe(true);
    expect(
      isDdOverdue(yesterday.toISOString().slice(0, 10), "accepted", now),
    ).toBe(false);
    expect(isDdOverdue(null, "submitted", now)).toBe(false);
  });
});

describe("schemas", () => {
  it("rejects PPA with 4-char currency", () => {
    const r = PpaUpsertSchema.safeParse({
      project_id: "00000000-0000-0000-0000-000000000000",
      name: "PPA",
      term_years: 25,
      tariff: 55,
      currency_code: "USDD",
    });
    expect(r.success).toBe(false);
  });
  it("LCOE requires positive energy", () => {
    const r = LcoeUpsertSchema.safeParse({
      project_id: "00000000-0000-0000-0000-000000000000",
      name: "Base",
      capex: 1,
      opex_annual: 1,
      discount_rate_pct: 5,
      annual_energy_mwh: 0,
      currency_code: "USD",
    });
    expect(r.success).toBe(false);
  });
});
