import { describe, expect, it } from "vitest";

import {
  CreateBondSchema,
  INSTRUMENT_TYPES,
  activationBlockers,
  bondDocumentPath,
  computeKpis,
  countdownLabel,
  countdownTone,
  coverageByCurrency,
  daysToExpiry,
  effectiveStatus,
  expiringWithin,
  type BondRow,
} from "@/lib/bonds.rules";

const TODAY = "2026-07-27";

function row(p: Partial<BondRow>): BondRow {
  const base: BondRow = {
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
    expiry_date: null,
    status: "active",
    effective_status: "active",
    days_to_expiry: null,
    auto_renew: false,
    document_path: "c/bonds/1/x.pdf",
    notes: null,
    created_at: TODAY,
  };
  const merged = { ...base, ...p };
  const days = daysToExpiry(merged.expiry_date, TODAY);
  return { ...merged, days_to_expiry: days, effective_status: effectiveStatus(merged.status, days) };
}

describe("bond countdown", () => {
  it("computes days_to_expiry as expiry − today", () => {
    expect(daysToExpiry("2026-08-26", TODAY)).toBe(30);
    expect(daysToExpiry("2026-07-26", TODAY)).toBe(-1);
    expect(daysToExpiry(null, TODAY)).toBeNull();
  });

  it("honours the 91/90/30/expired boundaries", () => {
    expect(countdownTone(91)).toBe("good");
    expect(countdownTone(90)).toBe("warning");
    expect(countdownTone(31)).toBe("warning");
    expect(countdownTone(30)).toBe("bad");
    expect(countdownTone(-1)).toBe("bad");
    expect(countdownLabel(-3)).toBe("Expired 3d ago");
  });

  it("derives effective status without writing it", () => {
    expect(effectiveStatus("active", 120)).toBe("active");
    expect(effectiveStatus("active", 90)).toBe("expiring_soon");
    expect(effectiveStatus("active", -1)).toBe("expired");
    expect(effectiveStatus("released", -1)).toBe("released");
  });
});

describe("bond KPIs", () => {
  const rows = [
    row({ id: "a", amount: 1000, currency_code: "USD", expiry_date: "2026-12-31" }),
    row({ id: "b", amount: 500, currency_code: "USD", expiry_date: "2026-08-10" }),
    row({ id: "c", amount: 700, currency_code: "JOD", expiry_date: "2026-10-01" }),
    row({ id: "d", amount: 900, currency_code: "USD", status: "released" }),
    row({ id: "e", amount: 100, currency_code: "USD", expiry_date: "2026-01-01" }),
  ];

  it("sums coverage per currency and never converts", () => {
    expect(coverageByCurrency(rows)).toEqual([
      { currency_code: "USD", amount: 1500 },
      { currency_code: "JOD", amount: 700 },
    ]);
  });

  it("counts expiring windows", () => {
    expect(expiringWithin(rows, 30)).toBe(1);
    expect(expiringWithin(rows, 90)).toBe(2);
    expect(computeKpis(rows, 3).claims_outstanding).toBe(3);
  });
});

describe("bond creation + activation", () => {
  it("has 11 instrument types", () => {
    expect(INSTRUMENT_TYPES).toHaveLength(11);
  });

  it("rejects expiry before issue and effective after expiry", () => {
    const base = {
      instrument_type: "performance_bond" as const,
      beneficiary_name: "NEPCO",
      beneficiary_type: "client" as const,
      issuer_name: "Arab Bank",
      issuer_type: "bank" as const,
      amount: 100,
      currency_code: "USD",
      issue_date: "2026-02-01",
      auto_renew: false,
    };
    expect(CreateBondSchema.safeParse({ ...base, expiry_date: "2026-01-01" }).success).toBe(false);
    expect(
      CreateBondSchema.safeParse({
        ...base,
        effective_date: "2026-06-01",
        expiry_date: "2026-03-01",
      }).success,
    ).toBe(false);
    expect(CreateBondSchema.safeParse({ ...base, expiry_date: "2027-02-01" }).success).toBe(true);
  });

  it("blocks activation until document and dates exist", () => {
    expect(
      activationBlockers({
        status: "draft",
        document_path: null,
        issue_date: null,
        effective_date: null,
        expiry_date: null,
      }),
    ).toHaveLength(4);
    expect(
      activationBlockers({
        status: "draft",
        document_path: "c/bonds/1/x.pdf",
        issue_date: "2026-01-01",
        effective_date: "2026-01-01",
        expiry_date: "2027-01-01",
      }),
    ).toEqual([]);
  });

  it("stores documents company-UUID first", () => {
    expect(bondDocumentPath("comp", "inst", "../evil path.pdf")).toBe(
      "comp/bonds/inst/.._evil_path.pdf",
    );
  });
});
