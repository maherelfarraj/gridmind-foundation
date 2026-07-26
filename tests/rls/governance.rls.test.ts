import { describe, it } from "vitest";

/**
 * P-182 Construction governance — cross-tenant isolation stub.
 * Full two-tenant probe runs under the P-132 RLS harness.
 *
 * For all six governance tables assert that:
 *   1. A user in company A reads 0 rows created under company B.
 *   2. Write roles match the register: method_statements / site_instructions /
 *      technical_queries → construction_admin, engineering_admin, company_admin;
 *      toolbox_talks(+attendance) → construction_admin, foreman, hse_admin,
 *      company_admin; permits_to_work → hse_admin, construction_admin,
 *      company_admin.
 *   3. field_technician is denied INSERT/UPDATE on permits_to_work.
 *   4. foreman may write toolbox talks and attendance but NOT method statements.
 *   5. check (valid_to > valid_from) rejects inverted permit windows.
 *   6. Per-company numbering uniqueness holds (MS/TBT/PTW/SI/TQ).
 *   7. Attendance rows cascade-delete with their parent toolbox talk.
 */
describe.skip("construction governance — cross-tenant RLS isolation", () => {
  it("method_statements: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): seed two tenants, sign in as A, select, assert empty.
  });

  it("toolbox_talks: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for toolbox_talks.
  });

  it("toolbox_talk_attendance: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for toolbox_talk_attendance.
  });

  it("permits_to_work: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for permits_to_work.
  });

  it("site_instructions: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for site_instructions.
  });

  it("technical_queries: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for technical_queries.
  });

  it("field_technician: INSERT and UPDATE denied on permits_to_work", () => {
    // TODO(P-132): assert 42501 / 0 rows affected for the field_technician role.
  });

  it("foreman: writes toolbox talks + attendance, denied on method_statements", () => {
    // TODO(P-132): two probes with the same signed-in foreman session.
  });

  it("engineering_admin: writes method statements, denied on permits_to_work", () => {
    // TODO(P-132): register-specific role split.
  });

  it("permits_to_work: inverted validity window violates the check constraint", () => {
    // TODO(P-132): assert 23514 check_violation when valid_to <= valid_from.
  });

  it("numbering: duplicate (company_id, ptw_number) violates the unique index", () => {
    // TODO(P-132): assert 23505 unique_violation; server fn retries and wins.
  });

  it("method_statements: same ms_number with a new revision inserts cleanly", () => {
    // TODO(P-132): unique (company, project, ms_number, revision) allows R0+R1.
  });

  it("toolbox_talk_attendance: cascade-deletes when the parent talk is deleted", () => {
    // TODO(P-132): delete talk → attendance rows gone.
  });
});
