// P-179 — Construction controls RLS isolation stub. Full harness in P-132.
import { describe, it } from "vitest";

/**
 * Tables introduced by migration 0074_cwp_controls.sql:
 *   construction_work_packages, look_ahead_plans, progress_weighting_rules,
 *   delay_analysis, recovery_plans.
 *
 * Invariants asserted by this stub:
 *   1. SELECT is gated on is_company_member(company_id) — cross-tenant = 0 rows.
 *   2. Writes on cwp / look_ahead / delay require
 *      construction_admin | foreman | company_admin.
 *   3. Writes on progress_weighting_rules and recovery_plans require
 *      construction_admin | company_admin only (foreman is denied).
 *   4. unique(company_id, cwp_number) and
 *      unique(company_id, project_id, week_start) hold.
 *   5. cwp_number / plan_number are minted server-side with unique-conflict
 *      retry; client-supplied values are ignored.
 *   6. schedule_tasks.is_critical is a server-recomputed cache (P-180).
 */
const TENANT_TABLES = [
  "construction_work_packages",
  "look_ahead_plans",
  "progress_weighting_rules",
  "delay_analysis",
  "recovery_plans",
] as const;

describe.skip("construction controls (0074) — RLS + write scoping", () => {
  for (const table of TENANT_TABLES) {
    it(`company A user reads 0 rows from ${table} created under company B`, () => {
      // TODO(P-132): seed two tenants, sign in as A, select, assert empty.
    });
  }

  it("foreman in company A can INSERT a construction work package", () => {
    // TODO(P-132): happy path via createWorkPackage.
  });

  it("foreman in company A is DENIED INSERT on progress_weighting_rules", () => {
    // TODO(P-132): expect RLS / forbidden_role rejection.
  });

  it("foreman in company A is DENIED INSERT on recovery_plans", () => {
    // TODO(P-132): expect RLS / forbidden_role rejection.
  });

  it("duplicate cwp_number within a company is rejected", () => {
    // TODO(P-132): direct insert of an existing CWP-0001 → 23505.
  });

  it("duplicate (project, week_start) look-ahead plan is rejected", () => {
    // TODO(P-132): second insert for the same Monday → 23505.
  });

  it("progress_weighting_rules rejects target_qty <= 0 and weight_pct > 100", () => {
    // TODO(P-132): assert check-constraint violations.
  });
});
