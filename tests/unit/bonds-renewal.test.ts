// P-205 — renewal validation, insurance summaries, coverage-by-type.
import { describe, expect, it } from "vitest";

import {
  RENEWABLE_STATUSES,
  coverageByType,
  insuranceSummaries,
  isInsuranceType,
  renewBondSchemaFor,
  type BondRow,
} from "@/lib/bonds.rules";

function row(p: Partial<BondRow>): BondRow {
  return {
    id: "1",
    instrument_number: "BG-0001",
    instrument_type: "performance_bond",
    beneficiary_name: "NEPCO",
    beneficiary_type: "client",
    issuer_name: "Arab Bank",
    issuer_type: "bank",
    principal_name: "GSI",
    project_id: null,
    project_name: null,
    contract_id: null,
    amount: 1000,
    currency_code: "USD",
    premium_pct: null,
    issue_date: "2026-01-01",
    effective_date: "2026-01-01",
    expiry_date: "2026-12-01",
    status: "active",
    effective_status: "active",
    days_to_expiry: 120,
    auto_renew: false,
    document_path: null,
    notes: null,
    created_at: "2026-01-01",
    ...p,
  } as BondRow;
}

const ID = "11111111-1111-4111-8111-111111111111";

describe("renewal validation", () => {
  it("rejects a new expiry that is not after the current expiry", () => {
    const schema = renewBondSchemaFor("2026-12-01");
    expect(schema.safeParse({ instrument_id: ID, new_expiry: "2026-12-01" }).success).toBe(false);
    expect(schema.safeParse({ instrument_id: ID, new_expiry: "2026-11-01" }).success).toBe(false);
  });

  it("accepts a forward expiry with optional premium and notes", () => {
    const parsed = renewBondSchemaFor("2026-12-01").safeParse({
      instrument_id: ID,
      new_expiry: "2027-06-01",
      premium_amount: 2500,
      notes: "Renewed with Arab Bank",
    });
    expect(parsed.success).toBe(true);
  });

  it("only allows renewal from live or lapsed statuses", () => {
    expect(RENEWABLE_STATUSES).toEqual(["active", "expiring_soon", "expired"]);
    for (const terminal of ["released", "returned", "cancelled"] as const) {
      expect(RENEWABLE_STATUSES).not.toContain(terminal);
    }
  });
});

describe("insurance view", () => {
  const rows = [
    row({ id: "a", instrument_type: "insurance_car_ear", amount: 5000, days_to_expiry: 40 }),
    row({
      id: "b",
      instrument_type: "insurance_car_ear",
      amount: 1000,
      days_to_expiry: 10,
      effective_status: "expiring_soon",
      issuer_name: "Jordan Insurance",
    }),
    row({ id: "c", instrument_type: "insurance_pi", amount: 800 }),
    row({ id: "d", instrument_type: "insurance_pl", amount: 900, effective_status: "expired" }),
    row({ id: "e", instrument_type: "performance_bond", amount: 7000 }),
  ];

  it("classifies only the four insurance types", () => {
    expect(isInsuranceType("insurance_car_ear")).toBe(true);
    expect(isInsuranceType("workmen_comp")).toBe(true);
    expect(isInsuranceType("performance_bond")).toBe(false);
  });

  it("summarises per type with nearest expiry and issuers", () => {
    const s = insuranceSummaries(rows);
    const car = s.find((x) => x.instrument_type === "insurance_car_ear")!;
    expect(car.active_count).toBe(2);
    expect(car.coverage[0]).toEqual({ currency_code: "USD", amount: 6000 });
    expect(car.nearest_days).toBe(10);
    expect(car.issuers).toEqual(["Arab Bank", "Jordan Insurance"]);
    const pl = s.find((x) => x.instrument_type === "insurance_pl")!;
    expect(pl.active_count).toBe(0);
    const wc = s.find((x) => x.instrument_type === "workmen_comp")!;
    expect(wc.coverage).toEqual([]);
  });

  it("sums coverage per instrument type within one currency", () => {
    const bars = coverageByType(
      [...rows, row({ id: "f", amount: 100, currency_code: "JOD" })],
      "USD",
    );
    expect(bars[0]).toMatchObject({ instrument_type: "performance_bond", amount: 7000 });
    expect(bars.find((b) => b.instrument_type === "insurance_car_ear")?.amount).toBe(6000);
    expect(bars.find((b) => b.instrument_type === "insurance_pl")).toBeUndefined();
    expect(coverageByType(rows, "JOD")).toEqual([]);
  });
});
