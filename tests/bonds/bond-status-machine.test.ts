// P-206 — The full legal/illegal transition matrix for a bond instrument.
import { describe, expect, it } from "vitest";

import {
  guardActivate,
  guardCancel,
  guardRenew,
  guardRequestRelease,
  guardReturn,
} from "@/lib/bonds.guards";
import { bondStatusForDays } from "@/lib/finance/bond-expiry";
import { makeInstrument } from "./fixtures";

const draft = (over = {}) =>
  makeInstrument({ status: "draft", effective_status: "draft", ...over });

describe("legal transitions", () => {
  it("draft → active with document + issue/effective/expiry dates on file", () => {
    expect(guardActivate(draft())).toBeNull();
  });

  it("active → expiring_soon / expired purely from the date", () => {
    expect(bondStatusForDays(30)).toBe("expiring_soon");
    expect(bondStatusForDays(-5)).toBe("expired");
  });

  it("active → released only via the approval chain request", () => {
    expect(guardRequestRelease(makeInstrument(), false)).toBeNull();
  });

  it("bid_bond → returned", () => {
    expect(guardReturn(makeInstrument({ instrument_type: "bid_bond" }))).toBeNull();
    expect(
      guardReturn(
        makeInstrument({
          instrument_type: "bid_bond",
          status: "expiring_soon",
          effective_status: "expiring_soon",
        }),
      ),
    ).toBeNull();
  });

  it("any non-terminal → cancelled", () => {
    for (const status of ["draft", "active", "expiring_soon", "expired", "claimed"] as const) {
      expect(guardCancel(makeInstrument({ status, effective_status: status }))).toBeNull();
    }
  });
});

describe("illegal transitions", () => {
  it("released → active (renew) is rejected", () => {
    expect(
      guardRenew(
        makeInstrument({ status: "released", effective_status: "released" }),
        "2030-01-01",
      ),
    ).toMatchObject({ status: 409, code: "terminal_status" });
  });

  it("draft → released without approval is rejected", () => {
    expect(guardRequestRelease(draft(), false)).toMatchObject({
      status: 409,
      code: "invalid_transition",
    });
  });

  it("cancelled → anything is rejected", () => {
    const cancelled = makeInstrument({ status: "cancelled", effective_status: "cancelled" });
    expect(guardActivate(cancelled)).toMatchObject({ code: "terminal_status" });
    expect(guardRequestRelease(cancelled, false)).toMatchObject({ code: "terminal_status" });
    expect(guardRenew(cancelled, "2030-01-01")).toMatchObject({ code: "terminal_status" });
    expect(guardCancel(cancelled)).toMatchObject({ code: "terminal_status" });
    expect(guardReturn({ ...cancelled, instrument_type: "bid_bond" })).toMatchObject({
      code: "terminal_status",
    });
  });

  it("re-activating a live instrument is rejected", () => {
    expect(guardActivate(makeInstrument())).toMatchObject({
      status: 409,
      code: "invalid_transition",
    });
  });

  it("only bid bonds can be returned", () => {
    expect(guardReturn(makeInstrument({ instrument_type: "performance_bond" }))).toMatchObject({
      status: 409,
      code: "not_a_bid_bond",
    });
  });
});

describe("activation evidence", () => {
  it("refuses activation without a document (409 with blockers)", () => {
    const err = guardActivate(draft({ document_path: null }));
    expect(err?.status).toBe(409);
    expect(err?.code).toBe("activation_blocked");
    expect((err?.meta?.blockers as string[]).length).toBeGreaterThan(0);
  });

  it("refuses activation without issue, effective or expiry dates", () => {
    for (const field of ["issue_date", "effective_date", "expiry_date"] as const) {
      const err = guardActivate(draft({ [field]: null }));
      expect(err).toMatchObject({ status: 409, code: "activation_blocked" });
    }
  });
});
