// P-204 — claims + release/return/cancel pure rules.
import { describe, expect, it } from "vitest";

import {
  BondReasonSchema,
  CreateClaimSchema,
  OPEN_CLAIM_STATUSES,
  RELEASABLE_STATUSES,
  ResolveClaimSchema,
  TERMINAL_CLAIM_STATUSES,
  isTerminalBondStatus,
  paidTotal,
} from "@/lib/bonds.rules";

describe("bond claim rules", () => {
  it("treats draft/submitted/contested as open", () => {
    expect([...OPEN_CLAIM_STATUSES]).toEqual(["draft", "submitted", "contested"]);
    expect(TERMINAL_CLAIM_STATUSES).toContain("paid");
  });

  it("sums only paid claims", () => {
    expect(
      paidTotal([
        { status: "paid", amount: 100 },
        { status: "rejected", amount: 500 },
        { status: "paid", amount: 50.5 },
      ]),
    ).toBe(150.5);
  });

  it("requires notes on paid or rejected outcomes", () => {
    expect(
      ResolveClaimSchema.safeParse({
        claim_id: "11111111-1111-1111-1111-111111111111",
        outcome: "paid",
      }).success,
    ).toBe(false);
    expect(
      ResolveClaimSchema.safeParse({
        claim_id: "11111111-1111-1111-1111-111111111111",
        outcome: "paid",
        resolution_notes: "Bank debited the guarantee in full.",
      }).success,
    ).toBe(true);
    expect(
      ResolveClaimSchema.safeParse({
        claim_id: "11111111-1111-1111-1111-111111111111",
        outcome: "withdrawn",
      }).success,
    ).toBe(true);
  });

  it("validates claim payloads", () => {
    const base = {
      instrument_id: "11111111-1111-1111-1111-111111111111",
      amount: 1000,
      currency_code: "JOD",
      reason: "Client called the bond after the delay notice.",
      claim_date: "2026-07-27",
    };
    expect(CreateClaimSchema.safeParse(base).success).toBe(true);
    expect(CreateClaimSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
    expect(CreateClaimSchema.safeParse({ ...base, claim_date: "27-07-2026" }).success).toBe(false);
  });
});

describe("bond lifecycle rules", () => {
  it("marks released/returned/cancelled as terminal", () => {
    for (const s of ["released", "returned", "cancelled"] as const) {
      expect(isTerminalBondStatus(s)).toBe(true);
    }
    for (const s of ["draft", "active", "expiring_soon", "expired", "claimed"] as const) {
      expect(isTerminalBondStatus(s)).toBe(false);
    }
  });

  it("allows release only from live or lapsed statuses", () => {
    expect([...RELEASABLE_STATUSES]).toEqual(["active", "expiring_soon", "expired"]);
  });

  it("requires a reason on release/return/cancel", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(BondReasonSchema.safeParse({ instrument_id: id, reason: "" }).success).toBe(false);
    expect(
      BondReasonSchema.safeParse({ instrument_id: id, reason: "Works taken over." }).success,
    ).toBe(true);
  });
});
