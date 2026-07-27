// P-226 — vendor_portal_assert_access + vendor_portal_write_event semantics.
import { describe, expect, it } from "vitest";

import {
  COMPANY_A,
  COMPANY_B,
  createPortalHarness,
  EXPIRED_AT,
  FUTURE_AT,
  makeMembership,
  NOW,
  USER_INTERNAL,
  USER_VENDOR_A,
  USER_VENDOR_B,
  VENDOR_A,
  VENDOR_B,
} from "./fixtures";

describe("vendor_portal_assert_access", () => {
  it("returns the membership and stamps last_seen_at for an active, unexpired seat", () => {
    const h = createPortalHarness({
      memberships: [makeMembership({ expires_at: FUTURE_AT })],
    });
    const seat = h.rpc.assertAccess(VENDOR_A);
    expect(seat.id).toBe("mem-a");
    expect(seat.company_id).toBe(COMPANY_A);
    expect(h.db.memberships[0].last_seen_at).toBe(NOW);
  });

  it("accepts a null expiry (no time-boxed seat)", () => {
    const h = createPortalHarness({ memberships: [makeMembership({ expires_at: null })] });
    expect(() => h.rpc.assertAccess(VENDOR_A)).not.toThrow();
  });

  for (const status of ["invited", "suspended", "revoked"] as const) {
    it(`denies a ${status} membership`, () => {
      const h = createPortalHarness({ memberships: [makeMembership({ status })] });
      expect(() => h.rpc.assertAccess(VENDOR_A)).toThrow("vendor_portal_access_denied");
      expect(h.db.memberships[0].last_seen_at).toBeNull();
    });
  }

  it("denies an expired seat", () => {
    const h = createPortalHarness({ memberships: [makeMembership({ expires_at: EXPIRED_AT })] });
    expect(() => h.rpc.assertAccess(VENDOR_A)).toThrow("vendor_portal_access_denied");
  });

  it("denies the wrong vendor and a caller with no membership at all", () => {
    const h = createPortalHarness({ memberships: [makeMembership()] });
    expect(() => h.rpc.assertAccess(VENDOR_B)).toThrow("vendor_portal_access_denied");

    const stranger = createPortalHarness({ authUid: "someone-else" });
    expect(() => stranger.rpc.assertAccess(VENDOR_A)).toThrow("vendor_portal_access_denied");

    const anon = createPortalHarness({ authUid: null });
    expect(() => anon.rpc.assertAccess(VENDOR_A)).toThrow("vendor_portal_access_denied");
  });

  it("never returns another vendor's seat to vendor B", () => {
    const h = createPortalHarness({
      authUid: USER_VENDOR_B,
      memberships: [
        makeMembership(),
        makeMembership({ id: "mem-b", vendor_id: VENDOR_B, user_id: USER_VENDOR_B }),
      ],
    });
    expect(h.rpc.assertAccess(VENDOR_B).id).toBe("mem-b");
    expect(() => h.rpc.assertAccess(VENDOR_A)).toThrow("vendor_portal_access_denied");
  });
});

describe("vendor_portal_write_event — vendor path", () => {
  it("stamps actor_type='vendor' and the membership id", () => {
    const h = createPortalHarness();
    h.rpc.writeEvent(VENDOR_A, "vendor_portal.pos_viewed", { n: 2 });
    expect(h.db.vendor_portal_events).toHaveLength(1);
    expect(h.db.vendor_portal_events[0]).toMatchObject({
      actor_type: "vendor",
      membership_id: "mem-a",
      actor_id: USER_VENDOR_A,
      company_id: COMPANY_A,
      vendor_id: VENDOR_A,
      event: "vendor_portal.pos_viewed",
      metadata: { n: 2 },
    });
  });
});

describe("vendor_portal_write_event — internal path", () => {
  it("writes actor_type='internal' with no membership for a company member", () => {
    const h = createPortalHarness({
      authUid: USER_INTERNAL,
      memberOf: [COMPANY_A],
    });
    h.rpc.writeEvent(VENDOR_A, "vendor_portal.invited", {}, COMPANY_A);
    expect(h.db.vendor_portal_events[0]).toMatchObject({
      actor_type: "internal",
      membership_id: null,
      actor_id: USER_INTERNAL,
      company_id: COMPANY_A,
    });
  });

  it("denies an internal caller writing to a vendor outside their company", () => {
    const h = createPortalHarness({ authUid: USER_INTERNAL, memberOf: [COMPANY_B] });
    expect(() => h.rpc.writeEvent(VENDOR_A, "vendor_portal.invited", {}, COMPANY_A)).toThrow(
      "vendor_portal_access_denied",
    );
    expect(h.db.vendor_portal_events).toHaveLength(0);
  });

  it("denies when no company can be resolved for the vendor", () => {
    const h = createPortalHarness({
      authUid: USER_INTERNAL,
      memberships: [],
      memberOf: [COMPANY_A],
    });
    expect(() => h.rpc.writeEvent(VENDOR_B, "x")).toThrow("vendor_portal_access_denied");
  });

  it("denies external viewers without an active seat (client_viewer / vendor_viewer)", () => {
    for (const memberOf of [[COMPANY_A], []]) {
      const h = createPortalHarness({
        authUid: USER_INTERNAL,
        external: true,
        memberOf,
      });
      expect(() => h.rpc.writeEvent(VENDOR_A, "vendor_portal.snoop", {}, COMPANY_A)).toThrow(
        "vendor_portal_access_denied",
      );
      expect(h.db.vendor_portal_events).toHaveLength(0);
    }
  });

  it("still takes the vendor path for an external vendor_viewer WITH an active seat", () => {
    const h = createPortalHarness({ external: true, memberOf: [] });
    h.rpc.writeEvent(VENDOR_A, "vendor_portal.pos_viewed");
    expect(h.db.vendor_portal_events[0].actor_type).toBe("vendor");
  });
});
