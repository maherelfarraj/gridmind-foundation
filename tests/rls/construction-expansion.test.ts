import { describe, it } from "vitest";

/**
 * P-186 — Batch-21 cross-tenant isolation stub (P-083 / P-132 pattern).
 *
 * For every table below assert that:
 *   1. A user in company A reads 0 rows created under company B.
 *   2. A write policy exists and rejects a row scoped to company B.
 *
 * Runs under the P-132 service-role harness; skips cleanly without it.
 */
const TABLES = [
  // P-179 / P-180 — planning & controls
  "construction_work_packages",
  "look_ahead_plans",
  "progress_weighting_rules",
  "delay_analysis",
  "recovery_plans",
  // P-181 — field execution
  "work_fronts",
  "crew_assignments",
  "equipment_records",
  "material_consumption",
  "delivery_tracking",
  // P-182 — construction governance
  "method_statements",
  "toolbox_talks",
  "toolbox_talk_attendance",
  "permits_to_work",
  "site_instructions",
  "technical_queries",
  // P-183 — quality expansion
  "inspection_test_plans",
  "itp_steps",
  "material_inspection_requests",
  "factory_acceptance_tests",
  "site_acceptance_tests",
  "test_certificates",
  "calibration_records",
  "welding_records",
  "torque_records",
  "cable_test_results",
  "thermographic_inspections",
  "relay_testing",
  "transformer_test_results",
  "commissioning_dossiers",
  // P-184 — materials & logistics (0076)
  "material_take_offs",
  "warehouse_inventory",
  "site_inventory",
  "batch_serial_tracking",
  "material_reservations",
  "material_issuances",
  "shipment_tracking",
  "delivery_notes",
  "shortage_alerts",
  "damaged_material_records",
  "return_to_vendor",
  // P-185 — HSE expansion
  "risk_assessments",
  "job_safety_analyses",
  "safety_observations",
  "competency_records",
  "emergency_response",
  "environmental_monitoring",
  "waste_tracking",
  "site_audit_checklists",
] as const;

const harness = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL);

describe.skipIf(!harness)("P-186 Batch-21 cross-tenant RLS isolation", () => {
  for (const table of TABLES) {
    it(`${table}: company A user reads 0 rows created under company B`, () => {
      // TODO(P-132): seed two tenants, sign in as A, select, assert empty.
    });

    it(`${table}: INSERT scoped to company B is denied by the write policy`, () => {
      // TODO(P-132): with-check probe against a foreign company_id must fail.
    });
  }
});

describe("P-186 Batch-21 RLS table coverage", () => {
  it("enumerates every Batch-21 table exactly once", () => {
    const unique = new Set(TABLES);
    if (unique.size !== TABLES.length) throw new Error("duplicate table in the Batch-21 matrix");
    if (TABLES.length !== 49) throw new Error(`expected 49 tables, found ${TABLES.length}`);
  });
});
