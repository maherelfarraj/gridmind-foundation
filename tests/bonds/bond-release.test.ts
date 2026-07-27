// P-206 — Release runs the seeded finance_admin → legal_admin approval chain.
import { describe, expect, it } from "vitest";

import { guardReleaseRule, guardRequestRelease } from "@/lib/bonds.guards";
import {
  applyRelease,
  decideRelease,
  makeInstrument,
  makeReleaseWorld,
  startRelease,
} from "./fixtures";

describe("requesting release", () => {
  it("refuses a terminal instrument", () => {
    for (const status of ["released", "returned", "cancelled"] as const) {
      const err = guardRequestRelease(makeInstrument({ status, effective_status: status }), false);
      expect(err).toMatchObject({ status: 409, code: "terminal_status" });
    }
  });

  it("refuses a draft instrument and a duplicate pending request", () => {
    expect(
      guardRequestRelease(makeInstrument({ status: "draft", effective_status: "draft" }), false),
    ).toMatchObject({ status: 409, code: "invalid_transition" });
    expect(guardRequestRelease(makeInstrument(), true)).toMatchObject({
      status: 409,
      code: "release_pending",
    });
  });

  it("allows live and lapsed instruments", () => {
    expect(guardRequestRelease(makeInstrument(), false)).toBeNull();
    expect(
      guardRequestRelease(
        makeInstrument({
          expiry_date: "2026-07-01",
          status: "expired",
          effective_status: "expired",
        }),
        false,
      ),
    ).toBeNull();
  });

  it("refuses when the bond_release rule is not seeded (409, never self-approved)", () => {
    expect(guardReleaseRule(null)).toMatchObject({ status: 409, code: "no_release_rule" });
    expect(guardReleaseRule("appr-1")).toBeNull();
  });
});

describe("approval chain ordering", () => {
  it("creates step-1 rows for finance_admin holders only", () => {
    const world = makeReleaseWorld();
    const instance = startRelease(world, "user-admin");
    expect(instance?.current_step).toBe(1);
    expect(instance?.approvals.map((a) => a.role)).toEqual(["finance_admin"]);
  });

  it("advances to fresh legal_admin rows after step 1 approves", () => {
    const world = makeReleaseWorld();
    startRelease(world, "user-admin");
    expect(decideRelease(world, "user-legal", "approved")).toMatchObject({ error: "wrong_role" });
    expect(decideRelease(world, "user-fin", "approved").ok).toBe(true);
    expect(world.instance?.current_step).toBe(2);
    const step2 = world.instance!.approvals.filter((a) => a.step_order === 2);
    expect(step2).toHaveLength(1);
    expect(step2[0]).toMatchObject({ role: "legal_admin", decision: "pending", decided_by: null });
    // Not released until the second approval lands.
    expect(applyRelease(world)).toBe("pending");
    expect(world.instrument.status).toBe("active");
  });

  it("releases with released_at + bond.released audit only after both steps", () => {
    const world = makeReleaseWorld();
    startRelease(world, "user-admin");
    decideRelease(world, "user-fin", "approved");
    decideRelease(world, "user-legal", "approved");
    expect(world.instance?.status).toBe("approved");
    expect(applyRelease(world)).toBe("released");
    expect(world.instrument.status).toBe("released");
    expect(world.audits.map((a) => a.action)).toContain("bond.released");
  });

  it("blocks the requester from approving their own release", () => {
    const world = makeReleaseWorld();
    startRelease(world, "user-fin");
    expect(decideRelease(world, "user-fin", "approved")).toMatchObject({ error: "self_approval" });
    expect(world.instrument.status).toBe("active");
  });

  for (const actor of ["user-fin", "user-legal"]) {
    it(`leaves the instrument untouched when ${actor} rejects`, () => {
      const world = makeReleaseWorld();
      startRelease(world, "user-admin");
      if (actor === "user-legal") decideRelease(world, "user-fin", "approved");
      expect(decideRelease(world, actor, "rejected").ok).toBe(true);
      expect(applyRelease(world)).toBe("rejected");
      expect(world.instrument.status).toBe("active");
      expect(world.audits.map((a) => a.action)).toContain("bond.release_rejected");
      expect(world.audits.map((a) => a.action)).not.toContain("bond.released");
    });
  }
});
