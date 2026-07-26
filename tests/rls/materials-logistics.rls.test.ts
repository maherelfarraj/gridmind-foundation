import { describe, it } from "vitest";

/**
 * P-184 Materials & logistics — cross-tenant isolation stub.
 * Full two-tenant probe runs under the P-132 RLS harness.
 *
 * For all eleven tables assert that:
 *   1. A user in company A reads 0 rows created under company B.
 *   2. Writes are limited to procurement_admin, construction_admin, foreman and
 *      company_admin; field_technician is denied INSERT/UPDATE/DELETE.
 *   3. reserve_material refuses a caller who is not a member of p_company_id.
 *   4. Two concurrent reserve_material calls for the last units: exactly one
 *      succeeds, the other raises P0001 insufficient_available.
 *   5. qty_reserved never exceeds qty_on_hand (check constraint backstop).
 *   6. Per-company numbering uniqueness holds (MTO/RES/ISS/SHP/DN/RTV).
 */
describe.skip("materials & logistics — cross-tenant RLS isolation", () => {
  const tables = [
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
  ];

  for (const table of tables) {
    it(`${table}: company A user reads 0 rows created under company B`, () => {
      // TODO(P-132): seed two tenants, sign in as A, select, assert empty.
    });
  }

  it("field_technician: INSERT, UPDATE and DELETE denied on every materials table", () => {
    // TODO(P-132): assert 42501 / 0 rows affected for the field_technician role.
  });

  it("procurement_admin and foreman: writes allowed within their own company only", () => {
    // TODO(P-132): with-check probe against a foreign company_id must fail.
  });

  it("reserve_material: non-member caller is rejected with 42501", () => {
    // TODO(P-132): call the RPC with another tenant's company_id.
  });

  it("reserve_material: concurrent callers for the last 10 units — one succeeds, one 409s", () => {
    // TODO(P-132): two sessions, both reserve 10 of 10 available; expect P0001 on one.
  });

  it("qty_reserved <= qty_on_hand holds after every reservation path", () => {
    // TODO(P-132): assert 23514 check_violation on a direct over-reserve update.
  });

  it("numbering: duplicate reservation_number within a company violates the unique index", () => {
    // TODO(P-132): assert 23505 unique_violation; a second company may reuse it.
  });
});
