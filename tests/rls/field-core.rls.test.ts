import { describe, it } from "vitest";

/**
 * P-083 Field core — cross-tenant isolation stub.
 * Full two-tenant probe lands in P-132 (RLS test harness).
 *
 * For each of the six field-core tables, assert that:
 *   1. A user in company A reads 0 rows created under company B.
 *   2. Non-field roles (e.g. sales, engineer) can SELECT but not INSERT/UPDATE.
 *   3. field_observations & site_photos additionally accept hse_admin writes.
 *   4. offline_queue rows are scoped to the creating user (user_id = auth.uid()).
 *   5. Duplicate DPR (same project/date/shift) fails the unique constraint.
 *   6. offline_queue upsert by (company_id, user_id, client_idempotency_key)
 *      is idempotent — retries do not create duplicates.
 *   7. Deleting a DPR cascade-deletes its manpower_logs rows.
 */
describe.skip("field core — cross-tenant RLS isolation", () => {
  it("construction_daily_reports: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): seed two tenants, sign in as A, select DPRs, assert empty.
  });

  it("manpower_logs: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for manpower_logs.
  });

  it("field_observations: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for field_observations.
  });

  it("weather_delays: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for weather_delays.
  });

  it("site_photos: company A user reads 0 rows created under company B", () => {
    // TODO(P-132): same pattern for site_photos.
  });

  it("offline_queue: user B cannot SELECT user A's rows in the same company", () => {
    // TODO(P-132): rows scoped to user_id = auth.uid() (admins may read all).
  });

  it("sales / engineer role: SELECT allowed, INSERT denied on DPR/manpower/weather", () => {
    // TODO(P-132): non-field roles read but cannot write.
  });

  it("hse_admin: INSERT allowed on field_observations and site_photos", () => {
    // TODO(P-132): HSE admin can raise observations and attach photos.
  });

  it("construction_daily_reports: duplicate (project, date, shift) violates unique", () => {
    // TODO(P-132): assert 23505 unique_violation on second insert.
  });

  it("offline_queue: retry with same client_idempotency_key does not duplicate", () => {
    // TODO(P-132): assert unique(company_id, user_id, client_idempotency_key).
  });

  it("manpower_logs: cascade-deletes when parent DPR is deleted", () => {
    // TODO(P-132): delete DPR → manpower rows gone.
  });
});
