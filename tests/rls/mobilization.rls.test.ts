import { describe, it } from "vitest";

/**
 * P-084 Mobilization checklists — RLS stub.
 * Full two-tenant probe lands in P-132 (RLS test harness).
 *
 * Assertions:
 *  1. Cross-tenant SELECT returns 0 rows (company A cannot read company B's checklists).
 *  2. field_technician can SELECT but INSERT/UPDATE is denied by the write policy.
 *  3. construction_admin / foreman / company_admin can INSERT and UPDATE.
 *  4. sales / engineer roles: SELECT allowed as company members, writes denied.
 *  5. Unique constraint on (company_id, project_id, name) blocks duplicate names.
 *  6. DELETE grant is absent — attempted delete fails with permission_denied.
 *  7. completeMobilizationChecklist server fn rejects when any required item is incomplete.
 */
describe.skip("mobilization checklists — cross-tenant RLS isolation", () => {
  it("cross-tenant SELECT returns 0 rows", () => {
    // TODO(P-132)
  });
  it("field_technician: SELECT ok, INSERT denied", () => {
    // TODO(P-132)
  });
  it("construction_admin: INSERT + UPDATE allowed", () => {
    // TODO(P-132)
  });
  it("foreman: INSERT + UPDATE allowed", () => {
    // TODO(P-132)
  });
  it("company_admin: INSERT + UPDATE allowed", () => {
    // TODO(P-132)
  });
  it("duplicate (company_id, project_id, name) violates unique", () => {
    // TODO(P-132)
  });
  it("DELETE denied — no grant to authenticated", () => {
    // TODO(P-132)
  });
  it("completeMobilizationChecklist throws when required items incomplete", () => {
    // TODO(P-132)
  });
});
