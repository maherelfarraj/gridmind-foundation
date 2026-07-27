// P-226 — vendor_portal_propose_delivery: upsert semantics, date guards and
// the invariant that vendors can never confirm an ETA.
import { describe, expect, it } from "vitest";

import { isVendorProposedNote, validateProposedDate } from "@/lib/vendor-portal.rules";
import {
  COMPANY_A,
  createPortalHarness,
  makeExpediting,
  makeMembership,
  makePo,
  NOW,
  PO_A,
  PO_B,
  USER_VENDOR_B,
  VENDOR_B,
} from "./fixtures";

const DATE = "2026-08-15";

describe("expediting upsert", () => {
  it("creates a row when none exists for that PO line", () => {
    const h = createPortalHarness({ pos: [makePo()], expediting: [] });
    expect(h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: DATE }])).toBe(1);

    expect(h.db.expediting_logs).toHaveLength(1);
    expect(h.db.expediting_logs[0]).toMatchObject({
      company_id: COMPANY_A,
      po_id: PO_A,
      po_line_no: 1,
      current_eta: DATE,
      eta_confirmed: false,
      last_vendor_contact_at: NOW,
      item_description: "PV modules 580 Wp",
    });
    expect(isVendorProposedNote(h.db.expediting_logs[0].notes)).toBe(true);
  });

  it("UPDATES the same row on re-proposal — no duplicates, eta_confirmed reset", () => {
    const h = createPortalHarness({
      pos: [makePo()],
      expediting: [makeExpediting({ current_eta: "2026-08-01", eta_confirmed: true })],
    });
    h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: DATE, note: "vessel delayed" }]);

    expect(h.db.expediting_logs).toHaveLength(1);
    expect(h.db.expediting_logs[0]).toMatchObject({
      id: "exp-1",
      current_eta: DATE,
      eta_confirmed: false,
      notes: "Vendor-proposed — vessel delayed",
    });

    h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: "2026-08-20" }]);
    expect(h.db.expediting_logs).toHaveLength(1);
    expect(h.db.expediting_logs[0].current_eta).toBe("2026-08-20");
  });

  it("writes one event, notifies procurement roles and audits the proposal", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    h.rpc.proposeDelivery(PO_A, [
      { line_no: 1, proposed_date: DATE },
      { line_no: 2, proposed_date: DATE },
    ]);
    expect(h.db.expediting_logs).toHaveLength(2);
    expect(h.db.vendor_portal_events).toHaveLength(1);
    expect(h.db.vendor_portal_events[0]).toMatchObject({
      event: "vendor_portal.delivery_proposed",
      actor_type: "vendor",
      metadata: { line_count: 2 },
    });
    expect(h.db.notifications.map((n) => n.user_id).sort()).toEqual([
      "user-proc-admin",
      "user-proc-officer",
    ]);
    expect(h.db.audit_logs[0]).toMatchObject({
      action: "vendor_portal.delivery_proposed",
      metadata: { line_count: 2 },
    });
  });
});

describe("validation", () => {
  it("a proposed date before the PO issue date → proposed_date_before_issue", () => {
    const h = createPortalHarness({ pos: [makePo({ issued_at: "2026-07-10T00:00:00.000Z" })] });
    expect(() =>
      h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: "2026-07-09" }]),
    ).toThrow("proposed_date_before_issue");
    expect(h.db.expediting_logs).toHaveLength(0);
    // The client-side mirror agrees with the RPC.
    expect(validateProposedDate("2026-07-09", "2026-07-10T00:00:00.000Z")).toBe(
      "proposed_date_before_issue",
    );
    expect(validateProposedDate("2026-07-10", "2026-07-10T00:00:00.000Z")).toBeNull();
  });

  it("an unknown line_no → line_not_on_po", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    expect(() => h.rpc.proposeDelivery(PO_A, [{ line_no: 99, proposed_date: DATE }])).toThrow(
      "line_not_on_po",
    );
    expect(() => h.rpc.proposeDelivery(PO_A, [{ proposed_date: DATE }])).toThrow("line_not_on_po");
  });

  it("missing date or empty payload are refused", () => {
    const h = createPortalHarness({ pos: [makePo()] });
    expect(() => h.rpc.proposeDelivery(PO_A, [{ line_no: 1 }])).toThrow("proposed_date_required");
    expect(() => h.rpc.proposeDelivery(PO_A, [])).toThrow("lines_required");
  });

  it("a cross-vendor PO is denied", () => {
    const h = createPortalHarness({
      authUid: USER_VENDOR_B,
      memberships: [
        makeMembership(),
        makeMembership({ id: "mem-b", vendor_id: VENDOR_B, user_id: USER_VENDOR_B }),
      ],
      pos: [makePo(), makePo({ id: PO_B, vendor_id: VENDOR_B })],
    });
    expect(() => h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: DATE }])).toThrow(
      "vendor_portal_access_denied",
    );
    expect(h.db.expediting_logs).toHaveLength(0);
  });

  it("exposure.deliveries=false → deliveries_not_exposed", () => {
    const h = createPortalHarness({
      memberships: [
        makeMembership({
          exposure: {
            pos: true,
            deliveries: false,
            invoices: true,
            documents: true,
            scorecard: false,
          },
        }),
      ],
      pos: [makePo()],
    });
    expect(() => h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: DATE }])).toThrow(
      "deliveries_not_exposed",
    );
  });
});

describe("eta_confirmed is procurement-only", () => {
  it("the vendor RPC never sets eta_confirmed true", () => {
    const h = createPortalHarness({
      pos: [makePo()],
      expediting: [makeExpediting({ eta_confirmed: true })],
    });
    h.rpc.proposeDelivery(PO_A, [{ line_no: 1, proposed_date: DATE }]);
    expect(h.db.expediting_logs.every((l) => l.eta_confirmed === false)).toBe(true);
  });

  it("confirm/counter-propose is role gated and cross-tenant safe", () => {
    const h = createPortalHarness({
      pos: [makePo()],
      expediting: [makeExpediting()],
    });
    expect(() =>
      h.serverFn.confirmEta(
        "exp-1",
        { roles: ["vendor_viewer"], companyId: COMPANY_A },
        {
          eta_confirmed: true,
        },
      ),
    ).toThrow("forbidden_role");
    expect(() =>
      h.serverFn.confirmEta(
        "exp-1",
        { roles: ["procurement_admin"], companyId: "other" },
        {
          eta_confirmed: true,
        },
      ),
    ).toThrow("forbidden_role");
    expect(h.db.expediting_logs[0].eta_confirmed).toBe(false);

    h.serverFn.confirmEta(
      "exp-1",
      { roles: ["procurement_officer"], companyId: COMPANY_A },
      {
        eta_confirmed: true,
      },
    );
    expect(h.db.expediting_logs[0].eta_confirmed).toBe(true);
  });
});
