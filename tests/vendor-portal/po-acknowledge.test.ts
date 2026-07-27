// P-226 — vendor_portal_acknowledge_po: side effects and every denial path.
import { describe, expect, it } from "vitest";

import {
  COMPANY_A,
  COMPANY_B,
  createPortalHarness,
  makeMembership,
  makePo,
  NOW,
  PO_A,
  PO_B,
  USER_VENDOR_B,
  VENDOR_A,
  VENDOR_B,
} from "./fixtures";

function harness() {
  return createPortalHarness({ pos: [makePo()] });
}

describe("valid acknowledgment", () => {
  it("writes PO columns, one event, dual-role notifications and an audit row", () => {
    const h = harness();
    h.rpc.acknowledgePo(PO_A, "accepted");

    const po = h.db.purchase_orders[0];
    expect(po).toMatchObject({
      acknowledged_at: NOW,
      acknowledged_by_email: "seller@vendor-a.test",
      acknowledgment_status: "accepted",
      acknowledgment_note: null,
    });

    expect(h.db.vendor_portal_events).toHaveLength(1);
    expect(h.db.vendor_portal_events[0]).toMatchObject({
      event: "vendor_portal.po_acknowledged",
      actor_type: "vendor",
      membership_id: "mem-a",
      metadata: { po_id: PO_A, po_number: "PO-0001", decision: "accepted" },
    });

    const notified = h.db.notifications.map((n) => n.user_id).sort();
    expect(notified).toEqual(["user-proc-admin", "user-proc-officer"]);
    expect(h.db.notifications.every((n) => n.company_id === COMPANY_A)).toBe(true);
    expect(h.db.notifications[0].link).toBe(`/procurement/pos/${PO_A}`);

    expect(h.db.audit_logs).toEqual([
      {
        action: "vendor_portal.po_acknowledged",
        entity: "purchase_orders",
        entity_id: PO_A,
        metadata: { decision: "accepted", vendor_id: VENDOR_A, by: "seller@vendor-a.test" },
      },
    ]);
  });

  it("stores the comment for accepted_with_comments and rejected", () => {
    const h = harness();
    h.rpc.acknowledgePo(PO_A, "accepted_with_comments", "Lead time is 12 weeks");
    expect(h.db.purchase_orders[0].acknowledgment_status).toBe("accepted_with_comments");
    expect(h.db.purchase_orders[0].acknowledgment_note).toBe("Lead time is 12 weeks");
  });

  it("re-acknowledging appends a new event without deleting history", () => {
    const h = harness();
    h.rpc.acknowledgePo(PO_A, "accepted");
    h.rpc.acknowledgePo(PO_A, "rejected", "Price changed");

    expect(h.db.vendor_portal_events).toHaveLength(2);
    expect(h.db.vendor_portal_events.map((e) => e.metadata.decision)).toEqual([
      "accepted",
      "rejected",
    ]);
    expect(h.db.purchase_orders[0].acknowledgment_status).toBe("rejected");
    expect(h.db.audit_logs).toHaveLength(2);
  });

  it("acknowledges a partially received PO too", () => {
    const h = createPortalHarness({ pos: [makePo({ status: "partially_received" })] });
    expect(() => h.rpc.acknowledgePo(PO_A, "accepted")).not.toThrow();
  });
});

describe("denial paths", () => {
  it("rejects without a comment → comment_required", () => {
    const h = harness();
    expect(() => h.rpc.acknowledgePo(PO_A, "rejected")).toThrow("comment_required");
    expect(() => h.rpc.acknowledgePo(PO_A, "rejected", "   ")).toThrow("comment_required");
    expect(h.db.purchase_orders[0].acknowledgment_status).toBeNull();
    expect(h.db.vendor_portal_events).toHaveLength(0);
  });

  it("accepted_with_comments without a comment → comment_required", () => {
    const h = harness();
    expect(() => h.rpc.acknowledgePo(PO_A, "accepted_with_comments")).toThrow("comment_required");
  });

  it("an invalid decision string → invalid_decision", () => {
    const h = harness();
    for (const bad of ["ACCEPTED", "maybe", "", "accepted; drop table"]) {
      expect(() => h.rpc.acknowledgePo(PO_A, bad)).toThrow("invalid_decision");
    }
  });

  for (const status of ["draft", "pending_approval", "received", "closed", "cancelled"]) {
    it(`a ${status} PO → po_not_acknowledgeable`, () => {
      const h = createPortalHarness({ pos: [makePo({ status })] });
      expect(() => h.rpc.acknowledgePo(PO_A, "accepted")).toThrow("po_not_acknowledgeable");
      expect(h.db.notifications).toHaveLength(0);
    });
  }

  it("vendor B acknowledging vendor A's PO → vendor_portal_access_denied", () => {
    const h = createPortalHarness({
      authUid: USER_VENDOR_B,
      memberships: [
        makeMembership(),
        makeMembership({ id: "mem-b", vendor_id: VENDOR_B, user_id: USER_VENDOR_B }),
      ],
      pos: [makePo(), makePo({ id: PO_B, vendor_id: VENDOR_B, po_number: "PO-0002" })],
    });
    expect(() => h.rpc.acknowledgePo(PO_A, "accepted")).toThrow("vendor_portal_access_denied");
    expect(h.db.purchase_orders[0].acknowledgment_status).toBeNull();
    expect(() => h.rpc.acknowledgePo(PO_B, "accepted")).not.toThrow();
  });

  it("a cross-tenant PO for the same vendor id → vendor_portal_access_denied", () => {
    const h = createPortalHarness({ pos: [makePo({ company_id: COMPANY_B })] });
    expect(() => h.rpc.acknowledgePo(PO_A, "accepted")).toThrow("vendor_portal_access_denied");
  });

  it("an unknown PO → po_not_found and pos exposure off → not exposed", () => {
    const h = harness();
    expect(() => h.rpc.acknowledgePo("no-such-po", "accepted")).toThrow("po_not_found");

    const closed = createPortalHarness({
      memberships: [
        makeMembership({
          exposure: {
            pos: false,
            deliveries: true,
            invoices: true,
            documents: true,
            scorecard: false,
          },
        }),
      ],
      pos: [makePo()],
    });
    expect(() => closed.rpc.acknowledgePo(PO_A, "accepted")).toThrow(
      "vendor_portal_pos_not_exposed",
    );
  });
});
