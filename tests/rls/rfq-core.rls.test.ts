import { describe, it } from "vitest";

/**
 * P-062 RFQ core — cross-tenant isolation stub.
 * Full two-tenant probe lands in P-132 (RLS test harness).
 * Asserts that a user in company A cannot SELECT rows created under company B
 * on rfqs, rfq_bids, or rfq_line_awards, and that procurement_officer cannot
 * INSERT into rfq_line_awards (procurement_admin / company_admin only).
 */
describe.skip("rfq core — cross-tenant RLS isolation", () => {
  it("rfqs: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): seed two tenants, sign in as A, select rfqs, assert empty.
  });

  it("rfq_bids: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for rfq_bids.
  });

  it("rfq_line_awards: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for rfq_line_awards.
  });

  it("rfq_line_awards: procurement_officer INSERT is denied by RLS", () => {
    // TODO(P-132): awards restricted to procurement_admin / company_admin.
  });
});
