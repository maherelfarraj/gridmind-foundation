// P-206 — Claim caps, the single-open-claim rule and paid-total enforcement.
import { describe, expect, it } from "vitest";

import { guardCreateClaim, guardResolveClaim } from "@/lib/bonds.guards";
import { makeClaim, makeInstrument } from "./fixtures";

const instrument = makeInstrument({ amount: 100_000 });

describe("claim amount validation", () => {
  it("rejects a claim larger than the instrument with a typed 422", () => {
    const err = guardCreateClaim(instrument, [], 100_000.01);
    expect(err).toMatchObject({
      status: 422,
      code: "claim_exceeds_instrument",
      meta: { instrument_amount: 100_000 },
    });
  });

  it("accepts a claim equal to or below the instrument amount", () => {
    expect(guardCreateClaim(instrument, [], 100_000)).toBeNull();
    expect(guardCreateClaim(instrument, [], 1)).toBeNull();
  });
});

describe("single open claim rule", () => {
  for (const status of ["draft", "submitted", "contested"] as const) {
    it(`rejects a second claim while a ${status} claim is open (409)`, () => {
      const err = guardCreateClaim(instrument, [makeClaim({ status })], 5_000);
      expect(err).toMatchObject({ status: 409, code: "claim_already_open" });
    });
  }

  for (const status of ["paid", "rejected", "withdrawn"] as const) {
    it(`allows a new claim once the previous one is ${status}`, () => {
      expect(guardCreateClaim(instrument, [makeClaim({ status, amount: 10 })], 5_000)).toBeNull();
    });
  }
});

describe("resolution guards", () => {
  it("refuses to resolve an already-resolved claim", () => {
    const err = guardResolveClaim(instrument, makeClaim({ status: "paid" }), [], "rejected");
    expect(err).toMatchObject({ status: 409, code: "invalid_transition" });
  });

  it("rejects a payout that would push Σ paid past the instrument amount", () => {
    const err = guardResolveClaim(
      instrument,
      makeClaim({ id: "claim-2", amount: 40_000, status: "submitted" }),
      [
        makeClaim({ id: "claim-0", amount: 70_000, status: "paid" }),
        makeClaim({ id: "claim-x", amount: 50_000, status: "rejected" }),
      ],
      "paid",
    );
    expect(err).toMatchObject({
      status: 422,
      code: "paid_exceeds_instrument",
      meta: { instrument_amount: 100_000, paid_total: 70_000 },
    });
  });

  it("allows a payout that exactly exhausts the instrument", () => {
    expect(
      guardResolveClaim(
        instrument,
        makeClaim({ id: "claim-2", amount: 30_000, status: "submitted" }),
        [makeClaim({ id: "claim-0", amount: 70_000, status: "paid" })],
        "paid",
      ),
    ).toBeNull();
  });

  it("never caps non-paid outcomes", () => {
    for (const outcome of ["rejected", "withdrawn", "contested"] as const) {
      expect(
        guardResolveClaim(
          instrument,
          makeClaim({ id: "claim-2", amount: 90_000, status: "submitted" }),
          [makeClaim({ id: "claim-0", amount: 90_000, status: "paid" })],
          outcome,
        ),
      ).toBeNull();
    }
  });
});
