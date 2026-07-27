// P-206 — Renewal must move the expiry forward and never revive a closed bond.
import { describe, expect, it } from "vitest";

import { guardRenew } from "@/lib/bonds.guards";
import { renewBondSchemaFor } from "@/lib/bonds.rules";
import { makeInstrument } from "./fixtures";

const instrument = makeInstrument({ expiry_date: "2027-01-01" });

describe("forward-expiry validation", () => {
  it("rejects an equal expiry with a typed 422", () => {
    expect(guardRenew(instrument, "2027-01-01")).toMatchObject({
      status: 422,
      code: "expiry_not_forward",
      message: "New expiry must be after the current expiry",
      meta: { current_expiry: "2027-01-01" },
    });
  });

  it("rejects an earlier expiry with a typed 422", () => {
    expect(guardRenew(instrument, "2026-12-31")).toMatchObject({
      status: 422,
      code: "expiry_not_forward",
    });
  });

  it("accepts an expiry one day later", () => {
    expect(guardRenew(instrument, "2027-01-02")).toBeNull();
  });

  it("mirrors the rule in the client-side zod refinement", () => {
    const schema = renewBondSchemaFor("2027-01-01");
    const id = "11111111-1111-4111-8111-111111111111";
    const bad = schema.safeParse({ instrument_id: id, new_expiry: "2026-12-01" });
    expect(bad.success).toBe(false);
    const good = schema.safeParse({
      instrument_id: id,
      new_expiry: "2028-01-01",
      premium_amount: 1200,
    });
    expect(good.success).toBe(true);
  });
});

describe("renewable statuses", () => {
  it("refuses terminal instruments", () => {
    for (const status of ["released", "returned", "cancelled"] as const) {
      expect(
        guardRenew(makeInstrument({ status, effective_status: status }), "2030-01-01"),
      ).toMatchObject({ status: 409, code: "terminal_status" });
    }
  });

  it("refuses a draft instrument — activate first", () => {
    expect(
      guardRenew(makeInstrument({ status: "draft", effective_status: "draft" }), "2030-01-01"),
    ).toMatchObject({ status: 409, code: "invalid_transition" });
  });

  it("allows active, expiring_soon and expired instruments", () => {
    for (const status of ["active", "expiring_soon", "expired"] as const) {
      expect(
        guardRenew(makeInstrument({ status, effective_status: status }), "2030-01-01"),
      ).toBeNull();
    }
  });
});

describe("renewal effect", () => {
  /** Mirrors renewBondInstrument: one append-only row + instrument patch. */
  function renew(row: ReturnType<typeof makeInstrument>, newExpiry: string) {
    const renewals: Array<{ previous_expiry: string | null; new_expiry: string }> = [];
    if (guardRenew(row, newExpiry)) throw new Error("guard should pass");
    renewals.push({ previous_expiry: row.expiry_date, new_expiry: newExpiry });
    row.expiry_date = newExpiry;
    row.status = "active";
    return renewals;
  }

  it("inserts exactly one renewal row with the correct previous_expiry", () => {
    const row = makeInstrument({ expiry_date: "2026-08-01", status: "expiring_soon" });
    const renewals = renew(row, "2027-08-01");
    expect(renewals).toEqual([{ previous_expiry: "2026-08-01", new_expiry: "2027-08-01" }]);
  });

  it("resets an expired instrument to active so the cron re-arms", () => {
    const row = makeInstrument({
      expiry_date: "2026-07-01",
      status: "expired",
      effective_status: "expired",
    });
    renew(row, "2027-07-01");
    expect(row.status).toBe("active");
    expect(row.expiry_date).toBe("2027-07-01");
  });
});
