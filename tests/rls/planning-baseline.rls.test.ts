import { describe, it } from "vitest";

/**
 * P-071 planning baseline — cross-tenant isolation stub.
 * Full two-tenant probe lands in P-132 (RLS test harness).
 * Asserts that a user in company A cannot SELECT rows created under company B
 * on wbs_items, schedule_tasks, baseline_snapshots, or risks; and that
 * baseline_snapshots + risks have no DELETE grant to authenticated.
 */
describe.skip("planning baseline — cross-tenant RLS isolation", () => {
  it("wbs_items: company A user reads 0 rows created under company B", () => {
    // TODO(P-132)
  });

  it("schedule_tasks: company A user reads 0 rows created under company B", () => {
    // TODO(P-132)
  });

  it("baseline_snapshots: company A user reads 0 rows created under company B", () => {
    // TODO(P-132)
  });

  it("risks: company A user reads 0 rows created under company B", () => {
    // TODO(P-132)
  });

  it("baseline_snapshots: DELETE is not granted to authenticated (append-only)", () => {
    // TODO(P-132)
  });

  it("risks: DELETE is not granted to authenticated", () => {
    // TODO(P-132)
  });
});
