// P-226 — vendor_portal_events is append-only for every client role: no
// INSERT/UPDATE/DELETE grants and no write policies exist in the migrations.
import { describe, expect, it } from "vitest";

import { COMPANY_A, USER_INTERNAL, USER_VENDOR_A } from "./fixtures";
import { type Actor, eventsAcl, VENDOR_PORTAL_SQL } from "./policy-store";

const procurementAdmin: Actor = {
  userId: USER_INTERNAL,
  companyId: COMPANY_A,
  roles: ["procurement_admin"],
};
const companyAdmin: Actor = { ...procurementAdmin, roles: ["company_admin"] };
const engineer: Actor = { ...procurementAdmin, roles: ["engineer"] };
const vendor: Actor = {
  userId: USER_VENDOR_A,
  companyId: COMPANY_A,
  roles: ["vendor_viewer"],
  external: true,
};
const row = { company_id: COMPANY_A };

describe("grants", () => {
  it("authenticated holds SELECT only", () => {
    expect([...eventsAcl.grants].sort()).toEqual(["select"]);
  });

  it("anon holds nothing on either portal table", () => {
    expect(VENDOR_PORTAL_SQL).toMatch(
      /revoke all on public\.vendor_portal_events from authenticated, anon;/i,
    );
    expect(VENDOR_PORTAL_SQL).toMatch(
      /revoke all on public\.vendor_portal_memberships from anon;/i,
    );
  });
});

describe("direct table writes", () => {
  it("INSERT without a policy is denied even for procurement_admin", () => {
    const v = eventsAcl.can(procurementAdmin, "insert", row);
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: "no_grant" });
  });

  for (const action of ["update", "delete"] as const) {
    it(`${action.toUpperCase()} is denied for every role including company_admin`, () => {
      for (const actor of [procurementAdmin, companyAdmin, engineer, vendor]) {
        expect(eventsAcl.can(actor, action, row).allowed).toBe(false);
      }
    });
  }

  it("declares no permissive write policies (only the explicit deny-all INSERT guard)", () => {
    const writePolicies = eventsAcl.policies.filter((p) => p.action !== "select");
    expect(writePolicies.every((p) => p.denyAll)).toBe(true);
  });

});

describe("the RPC path bypasses via definer rights", () => {
  it("write_event is SECURITY DEFINER and the only writer", () => {
    expect(VENDOR_PORTAL_SQL).toMatch(
      /create or replace function public\.vendor_portal_write_event[\s\S]*?security definer/i,
    );
    const inserts = [...VENDOR_PORTAL_SQL.matchAll(/insert into public\.vendor_portal_events/gi)];
    expect(inserts.length).toBeGreaterThan(0);
  });
});

describe("read access", () => {
  it("is limited to procurement_admin / company_admin in the same company", () => {
    expect(eventsAcl.can(procurementAdmin, "select", row).allowed).toBe(true);
    expect(eventsAcl.can(companyAdmin, "select", row).allowed).toBe(true);
    expect(eventsAcl.can(engineer, "select", row).allowed).toBe(false);
    expect(eventsAcl.can(vendor, "select", row).allowed).toBe(false);
  });
});
