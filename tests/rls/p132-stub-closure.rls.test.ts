// GC-18 — P-132 stub closure suite.
//
// Replaces eight `describe.skip` placeholder files (field core, construction
// governance, construction controls, materials & logistics, mobilization,
// planning baseline, rfq core, work orders) that contributed 75 never-executed
// tests. Every table below now gets a real, non-vacuous two-tenant probe:
// a service-role seed under company B, a scoped SELECT from company A that
// must return zero rows, and an INSERT from company A carrying company B's
// id that must be rejected by RLS.
//
// A single fixture set is created for the whole file (one GoTrue sign-in pair
// instead of eight) which keeps the suite deterministic under the concurrent
// database load the full-repository run produces.
//
// Self-skips when Supabase env is unreachable so isolated CI shards still pass.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSupabaseUp, setupFixtures, type Fixtures } from "./helpers/rls";
import { seedStubParents, STUB_MATRIX, type StubParents } from "./helpers/p132-stub-matrix";

const up = await isSupabaseUp();

describe.skipIf(!up)("P-132 stub closure — cross-tenant RLS", () => {
  let f: Fixtures;
  let parents: StubParents;

  beforeAll(async () => {
    f = await setupFixtures();
    parents = await seedStubParents(f);
  }, 90_000);

  afterAll(async () => {
    await f?.cleanup();
  }, 60_000);

  const origins = [...new Set(STUB_MATRIX.map((s) => s.origin))];

  for (const origin of origins) {
    describe(origin, () => {
      for (const spec of STUB_MATRIX.filter((s) => s.origin === origin)) {
        describe(spec.table, () => {
          it("service-role plants a row under company B", async () => {
            const { error } = await f.svc
              .from(spec.table as never)
              .insert(spec.seedForB(f, parents) as never);
            expect(error, `svc seed ${spec.table}: ${error?.message ?? ""}`).toBeNull();
          });

          it("company B holds the planted row (probe is non-vacuous)", async () => {
            const { count, error } = await f.svc
              .from(spec.table as never)
              .select("*", { count: "exact", head: true })
              .eq("company_id" as never, f.B.companyId);
            expect(error, `svc count ${spec.table}: ${error?.message ?? ""}`).toBeNull();
            expect(count ?? 0).toBeGreaterThan(0);
          });

          it("user A reads 0 rows scoped to company B", async () => {
            const { data, error } = await f.A.client
              .from(spec.table as never)
              .select("*")
              .eq("company_id" as never, f.B.companyId);
            expect(error, `select ${spec.table}: ${error?.message ?? ""}`).toBeNull();
            expect(data ?? []).toHaveLength(0);
          });

          it("user A INSERT into company B is denied", async () => {
            const { data, error } = await f.A.client
              .from(spec.table as never)
              .insert(spec.insertAsA(f, parents) as never)
              .select();
            const denied = !!error || !data || (Array.isArray(data) && data.length === 0);
            expect(denied, `insert ${spec.table} unexpectedly succeeded`).toBe(true);
          });
        });
      }
    });
  }

  // --- Constraint / integrity probes the stubs described -------------------

  describe("constraints", () => {
    it("mobilization_checklists: duplicate (company, project, name) violates unique", async () => {
      const name = `Dup ${crypto.randomUUID().slice(0, 6)}`;
      const row = {
        company_id: f.B.companyId,
        project_id: f.B.projectId,
        name,
      };
      const first = await f.svc.from("mobilization_checklists").insert(row as never);
      expect(first.error).toBeNull();
      const second = await f.svc.from("mobilization_checklists").insert(row as never);
      expect(second.error?.code).toBe("23505");
    });

    it("progress_weighting_rules: non-positive target_qty violates the check", async () => {
      const { error } = await f.svc.from("progress_weighting_rules").insert({
        company_id: f.B.companyId,
        discipline: "civil",
        name: `Bad ${crypto.randomUUID().slice(0, 6)}`,
        uom: "item",
        target_qty: 0,
        weight_pct: 10,
      } as never);
      expect(error?.code).toBe("23514");
    });

    it("progress_weighting_rules: weight_pct above 100 violates the check", async () => {
      const { error } = await f.svc.from("progress_weighting_rules").insert({
        company_id: f.B.companyId,
        discipline: "civil",
        name: `Bad ${crypto.randomUUID().slice(0, 6)}`,
        uom: "item",
        target_qty: 5,
        weight_pct: 150,
      } as never);
      expect(error?.code).toBe("23514");
    });

    it("risks: probability outside 1..5 violates the check", async () => {
      const { error } = await f.svc.from("risks").insert({
        company_id: f.B.companyId,
        project_id: f.B.projectId,
        title: "Out of range",
        probability: 9,
        impact: 3,
      } as never);
      expect(error?.code).toBe("23514");
    });

    it("manpower_logs cascade with their parent daily report", async () => {
      const { data: dpr, error: dprErr } = await f.svc
        .from("construction_daily_reports")
        .insert({
          company_id: f.B.companyId,
          project_id: f.B.projectId,
          report_date: "2028-05-01",
          shift: "day",
        } as never)
        .select("id")
        .single();
      expect(dprErr).toBeNull();
      const dprId = (dpr as unknown as { id: string }).id;

      const { error: logErr } = await f.svc.from("manpower_logs").insert({
        company_id: f.B.companyId,
        dpr_id: dprId,
        trade: "civil",
        headcount: 6,
      } as never);
      expect(logErr).toBeNull();

      await f.svc.from("construction_daily_reports").delete().eq("id", dprId);

      const { count, error } = await f.svc
        .from("manpower_logs")
        .select("*", { count: "exact", head: true })
        .eq("dpr_id", dprId);
      expect(error).toBeNull();
      expect(count ?? 0).toBe(0);
    });

    it("toolbox_talk_attendance cascades with its parent talk", async () => {
      const { data: talk, error: talkErr } = await f.svc
        .from("toolbox_talks")
        .insert({
          company_id: f.B.companyId,
          project_id: f.B.projectId,
          tbt_number: `TBT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          talk_date: "2026-05-02",
          topic: "Cascade probe",
        } as never)
        .select("id")
        .single();
      expect(talkErr).toBeNull();
      const talkId = (talk as unknown as { id: string }).id;

      const { error: attErr } = await f.svc.from("toolbox_talk_attendance").insert({
        company_id: f.B.companyId,
        talk_id: talkId,
        worker_name: "Cascade worker",
      } as never);
      expect(attErr).toBeNull();

      await f.svc.from("toolbox_talks").delete().eq("id", talkId);

      const { count, error } = await f.svc
        .from("toolbox_talk_attendance")
        .select("*", { count: "exact", head: true })
        .eq("talk_id", talkId);
      expect(error).toBeNull();
      expect(count ?? 0).toBe(0);
    });
  });

  // --- Own-tenant writes must still work (policies are not blanket denials) --

  describe("own-tenant writes remain permitted", () => {
    it("user A can insert a work order in company A", async () => {
      const { data, error } = await f.A.client
        .from("work_orders")
        .insert({
          company_id: f.A.companyId,
          project_id: f.A.projectId,
          wo_number: `WO-A-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
          title: "Own tenant work order",
        } as never)
        .select("id");
      expect(error, error?.message ?? "").toBeNull();
      expect(data ?? []).toHaveLength(1);
    });

    it("user A can insert a mobilization checklist in company A", async () => {
      const { data, error } = await f.A.client
        .from("mobilization_checklists")
        .insert({
          company_id: f.A.companyId,
          project_id: f.A.projectId,
          name: `Own ${crypto.randomUUID().slice(0, 6)}`,
        } as never)
        .select("id");
      expect(error, error?.message ?? "").toBeNull();
      expect(data ?? []).toHaveLength(1);
    });
  });
});
