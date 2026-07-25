// P-106 — Work orders RLS isolation stub. Full harness in P-132.
import { describe, it } from "vitest";

/**
 * work_orders RLS:
 *   1. is_company_member(company_id) — SELECT for members only.
 *   2. Writes: has_company_role('om_admin' | 'company_admin').
 *   3. wo_technician_update: assigned_to = auth.uid() may UPDATE own row only.
 *   4. wo_number uniqueness enforced per (company_id, wo_number).
 *   5. total_cost recomputed server-side; clients cannot supply it directly.
 */
describe.skip("work_orders — RLS + write scoping", () => {
  it("company A user reads 0 work orders created under company B", () => {
    // TODO(P-132): seed two tenants, sign in as A, select work_orders, assert empty.
  });
  it("sales role in company A cannot INSERT a work order", () => {
    // TODO(P-132): assert 403 / RLS reject.
  });
  it("om_admin in company A can INSERT + close a work order", () => {
    // TODO(P-132): happy-path create + capture + close.
  });
  it("field_technician can only UPDATE work orders where assigned_to = auth.uid()", () => {
    // TODO(P-132): assert RLS on wo_technician_update policy.
  });
  it("wo_number is unique per company (retry path exercised)", () => {
    // TODO(P-132): concurrent create → second attempt receives WO-YYYY-(N+1).
  });
});
