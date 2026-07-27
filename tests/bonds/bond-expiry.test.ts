// P-206 — Expiry boundary computation, idempotency and threshold escalation.
import { describe, expect, it } from "vitest";

import {
  BOND_THRESHOLDS,
  bondDaysToExpiry,
  bondFingerprint,
  bondStatusForDays,
  rolesForThreshold,
} from "@/lib/finance/bond-expiry";
import { TODAY, makeInstrument, runExpiryPass } from "./fixtures";

describe("bondDaysToExpiry", () => {
  it("computes whole UTC days and returns null for a missing expiry", () => {
    expect(bondDaysToExpiry("2026-07-27", TODAY)).toBe(0);
    expect(bondDaysToExpiry("2026-10-25", TODAY)).toBe(90);
    expect(bondDaysToExpiry("2026-07-26", TODAY)).toBe(-1);
    expect(bondDaysToExpiry(null, TODAY)).toBeNull();
    expect(bondDaysToExpiry(undefined, TODAY)).toBeNull();
  });
});

describe("bondStatusForDays boundaries", () => {
  it("treats exactly 90 days as expiring_soon", () => {
    expect(bondStatusForDays(90)).toBe("expiring_soon");
  });
  it("treats 89 days as expiring_soon", () => {
    expect(bondStatusForDays(89)).toBe("expiring_soon");
  });
  it("keeps 91 days active", () => {
    expect(bondStatusForDays(91)).toBe("active");
  });
  it("treats the expiry day itself (0) as expiring_soon", () => {
    expect(bondStatusForDays(0)).toBe("expiring_soon");
  });
  it("treats −1 day as expired", () => {
    expect(bondStatusForDays(-1)).toBe("expired");
  });
  it("returns null (no transition) for a null expiry", () => {
    expect(bondStatusForDays(null)).toBeNull();
  });
});

describe("expiry pass idempotency", () => {
  it("never transitions an instrument with no expiry date", () => {
    const rows = [makeInstrument({ id: "b-null", expiry_date: null, status: "active" })];
    expect(runExpiryPass(rows, TODAY).updates).toEqual([]);
  });

  it("materializes once, then produces an empty update set on re-run", () => {
    const rows = [makeInstrument({ id: "b1", expiry_date: "2026-09-01", status: "active" })];
    const first = runExpiryPass(rows, TODAY);
    expect(first.updates).toEqual([{ id: "b1", status: "expiring_soon" }]);
    expect(runExpiryPass(rows, TODAY).updates).toEqual([]);
  });

  it("does not re-audit an already-expired row", () => {
    const rows = [makeInstrument({ id: "b2", expiry_date: "2026-07-01", status: "expired" })];
    expect(runExpiryPass(rows, TODAY).updates).toEqual([]);
  });

  it("leaves released, returned, cancelled and claimed rows untouched", () => {
    for (const status of ["released", "returned", "cancelled", "claimed"] as const) {
      const rows = [makeInstrument({ id: `b-${status}`, expiry_date: "2026-07-01", status })];
      const run = runExpiryPass(rows, TODAY);
      expect(run.updates).toEqual([]);
      expect(rows[0].status).toBe(status);
    }
  });
});

describe("threshold selector", () => {
  it("fires each of 90/60/30/7 exactly once per instrument across runs", () => {
    const sent = new Set<string>();
    const fired: number[] = [];
    // The bond walks in from 95 days out to 5 days out over successive runs.
    for (const expiry of ["2026-10-30", "2026-10-25", "2026-09-20", "2026-08-20", "2026-08-01"]) {
      const rows = [makeInstrument({ id: "b1", expiry_date: expiry })];
      fired.push(...runExpiryPass(rows, TODAY, sent).notices.map((n) => n.threshold));
    }
    expect(fired).toEqual([90, 60, 30, 7]);
    expect([...sent].sort()).toEqual(BOND_THRESHOLDS.map((t) => bondFingerprint("b1", t)).sort());
  });

  it("dedupes by fingerprint so a same-day re-run sends nothing", () => {
    const sent = new Set<string>();
    const rows = [makeInstrument({ id: "b1", expiry_date: "2026-08-20" })];
    expect(runExpiryPass(rows, TODAY, sent).notices).toHaveLength(3); // 90, 60, 30
    expect(runExpiryPass(rows, TODAY, sent).notices).toHaveLength(0);
  });

  it("escalates the 7-day notice to finance, legal and company admins", () => {
    expect(rolesForThreshold(90)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(60)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(30)).toEqual(["finance_admin"]);
    expect(rolesForThreshold(7)).toEqual(["finance_admin", "legal_admin", "company_admin"]);
  });

  it("stops notifying once the bond has expired", () => {
    const rows = [makeInstrument({ id: "b1", expiry_date: "2026-07-20" })];
    expect(runExpiryPass(rows, TODAY).notices).toEqual([]);
  });
});
