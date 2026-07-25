// P-132 — Cross-tenant RLS matrix.
//
// For every domain table group, this suite proves:
//   1. A user in company A reads zero rows created under company B.
//   2. A user in company A cannot INSERT a row scoped to company B.
//
// Plus a viewer-curation check: a portal-only client_viewer (no company
// profile) reads their curated portal feed but zero rows from internal
// tables via direct SELECT.
//
// Self-skips when Supabase env is unreachable so `bun run test:all` still
// passes on isolated CI shards.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isSupabaseUp, setupFixtures, MATRIX, type Fixtures } from "./helpers/rls";

const up = await isSupabaseUp();

describe.skipIf(!up)("P-132 cross-tenant RLS matrix", () => {
  let f: Fixtures;

  beforeAll(async () => {
    f = await setupFixtures();
  }, 60_000);

  afterAll(async () => {
    await f?.cleanup();
  }, 60_000);

  describe("domain matrix — SELECT isolation + INSERT denial", () => {
    for (const spec of MATRIX) {
      describe(`${spec.group} · ${spec.table}`, () => {
        it("service-role plants row(s) under company B", async () => {
          const payload = spec.seedForB(f);
          if (Object.keys(payload).length === 0) {
            // Row already planted during setup (profiles, user_roles,
            // portal_memberships).
            return;
          }
          const { error } = await f.svc.from(spec.table as never).insert(payload as never);
          expect(error, `svc seed ${spec.table}: ${error?.message ?? ""}`).toBeNull();
        });

        it("user A reads 0 rows scoped to company B", async () => {
          const { data, error } = await f.A.client
            .from(spec.table as never)
            .select("*")
            .eq("company_id" as never, f.B.companyId);
          expect(error, `select ${spec.table}: ${error?.message ?? ""}`).toBeNull();
          expect(data ?? []).toHaveLength(0);
        });

        if (!spec.skipInsertDenial) {
          it("user A INSERT into company B is denied", async () => {
            const payload = spec.insertAsA(f);
            const { data, error } = await f.A.client
              .from(spec.table as never)
              .insert(payload as never)
              .select();
            const denied = !!error || !data || (Array.isArray(data) && data.length === 0);
            expect(
              denied,
              `${spec.table} accepted a cross-tenant insert (data=${JSON.stringify(data)})`,
            ).toBe(true);
          });
        }
      });
    }
  });

  describe("viewer curation — portal-only client_viewer", () => {
    it("viewer sees curated portal feed via portal_get_feed", async () => {
      const { data, error } = await f.viewer.client.rpc("portal_get_feed", {
        p_project_id: f.viewer.projectBId,
      });
      expect(error, `portal_get_feed: ${error?.message ?? ""}`).toBeNull();
      expect(data).toBeTruthy();
      // Curated shape includes the project we asked for.
      const proj = (data as { project?: { id?: string } })?.project;
      expect(proj?.id).toBe(f.viewer.projectBId);
    });

    it("viewer reads their own portal_memberships row", async () => {
      const { data, error } = await f.viewer.client
        .from("portal_memberships")
        .select("id")
        .eq("user_id", f.viewer.userId);
      expect(error, `viewer portal_memberships: ${error?.message ?? ""}`).toBeNull();
      expect((data ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("viewer reads 0 rows from non-curated internal tables", async () => {
      // Plant an internal (non-curated) budget row in company B first.
      await f.svc.from("budgets").insert({
        company_id: f.B.companyId,
        project_id: f.B.projectId,
        cost_code_id: f.B.costCodeId,
        currency_code: "USD",
      });
      for (const table of ["budgets", "invoices", "purchase_orders", "change_orders"] as const) {
        const { data, error } = await f.viewer.client
          .from(table)
          .select("*")
          .eq("company_id", f.B.companyId);
        // Either RLS denies outright (error) or returns zero rows — both
        // count as "viewer cannot read internal data".
        const empty = !!error || (data ?? []).length === 0;
        expect(empty, `${table} leaked ${data?.length ?? 0} rows to viewer`).toBe(true);
      }
    });

    it("viewer INSERT into any internal table is denied", async () => {
      const { data, error } = await f.viewer.client
        .from("budgets")
        .insert({
          company_id: f.B.companyId,
          project_id: f.B.projectId,
          cost_code_id: f.B.costCodeId,
          currency_code: "USD",
        })
        .select();
      const denied = !!error || !data || data.length === 0;
      expect(denied, "viewer wrote to budgets").toBe(true);
    });
  });
});
