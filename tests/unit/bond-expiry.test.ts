// P-203/P-206 — Bond expiry engine pure helpers.
import { describe, expect, it } from "vitest";

import {
  BOND_THRESHOLDS,
  bondDaysToExpiry,
  bondFingerprint,
  bondNoticeMessage,
  crossedThresholds,
  materializedStatus,
  rolesForThreshold,
  summarizeExpiringBonds,
} from "@/lib/finance/bond-expiry";

const TODAY = "2026-07-27";

describe("bondDaysToExpiry", () => {
  it("returns whole day differences", () => {
    expect(bondDaysToExpiry("2026-07-27", TODAY)).toBe(0);
    expect(bondDaysToExpiry("2026-07-28", TODAY)).toBe(1);
    expect(bondDaysToExpiry("2026-07-26", TODAY)).toBe(-1);
    expect(bondDaysToExpiry("2026-10-25", TODAY)).toBe(90);
  });
  it("returns null for missing/invalid dates", () => {
    expect(bondDaysToExpiry(null, TODAY)).toBeNull();
    expect(bondDaysToExpiry("not-a-date", TODAY)).toBeNull();
  });
});

describe("materializedStatus", () => {
  it("maps the exact boundaries", () => {
    expect(materializedStatus(91)).toBe("active");
    expect(materializedStatus(90)).toBe("expiring_soon");
    expect(materializedStatus(0)).toBe("expiring_soon");
    expect(materializedStatus(-1)).toBe("expired");
    expect(materializedStatus(null)).toBeNull();
  });
});

describe("thresholds", () => {
  it("crosses widest-first and never for expired instruments", () => {
    expect(crossedThresholds(120)).toEqual([]);
    expect(crossedThresholds(90)).toEqual([90]);
    expect(crossedThresholds(61)).toEqual([90]);
    expect(crossedThresholds(30)).toEqual([90, 60, 30]);
    expect(crossedThresholds(7)).toEqual([...BOND_THRESHOLDS]);
    expect(crossedThresholds(-2)).toEqual([]);
    expect(crossedThresholds(null)).toEqual([]);
  });
  it("escalates to three roles at 7 days only", () => {
    expect(rolesForThreshold(90)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(60)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(30)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(7)).toEqual(["finance_admin", "legal_admin", "company_admin"]);
  });
  it("fingerprints per instrument and threshold", () => {
    expect(bondFingerprint("abc", 30)).toBe("abc:30");
    expect(bondFingerprint("abc", 7)).not.toBe(bondFingerprint("abc", 30));
  });
});

describe("bondNoticeMessage", () => {
  const row = {
    instrument_number: "BG-0012",
    instrument_type: "performance_bond",
    beneficiary_name: "NEPCO",
    expiry_date: "2026-08-26",
    amount: 1000,
    currency_code: "JOD",
  };
  it("reads as plain English with an Intl amount", () => {
    const msg = bondNoticeMessage(row, 30);
    expect(msg).toContain("Performance bond BG-0012 for NEPCO");
    expect(msg).toContain("expires in 30 days on 2026-08-26");
    expect(msg).toContain("1,000.00");
  });
  it("handles today and singular day", () => {
    expect(bondNoticeMessage(row, 0)).toContain("expires today");
    expect(bondNoticeMessage(row, 1)).toContain("in 1 day ");
  });
});

describe("summarizeExpiringBonds", () => {
  it("counts and sums per currency without conversion", () => {
    const out = summarizeExpiringBonds(
      [
        { expiry_date: "2026-08-10", amount: 100, currency_code: "JOD" },
        { expiry_date: "2026-08-20", amount: 400, currency_code: "USD" },
        { expiry_date: "2026-08-01", amount: 50, currency_code: "JOD" },
        { expiry_date: "2026-12-01", amount: 900, currency_code: "JOD" }, // beyond 30d
        { expiry_date: "2026-07-01", amount: 900, currency_code: "JOD" }, // expired
        { expiry_date: null, amount: 900, currency_code: "JOD" },
      ],
      TODAY,
      30,
    );
    expect(out.count).toBe(3);
    expect(out.per_currency).toEqual([
      { currency_code: "USD", amount: 400 },
      { currency_code: "JOD", amount: 150 },
    ]);
  });
});
