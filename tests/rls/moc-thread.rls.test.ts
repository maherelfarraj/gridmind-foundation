// P-192 — RLS stub for the digital-thread + MOC tables.
//
// Extends the P-132 matrix: company B rows must be invisible to company A on
// entity_links, impact_assessments, change_requests and moc_implementation_tasks,
// and an external portal viewer sees zero rows on all four.
//
// Runs only under vitest.config.all.ts (the unit config excludes tests/rls/**).
// Self-skips when Supabase env is unreachable.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSupabaseUp, serviceClient, setupFixtures, type Fixtures } from "./helpers/rls";

const up = await isSupabaseUp();

const MOC_TABLES = [
  "entity_links",
  "impact_assessments",
  "change_requests",
  "moc_implementation_tasks",
] as const;

describe.skipIf(!up)("P-192 MOC + digital-thread RLS isolation", () => {
  let f: Fixtures;
  const planted: Record<string, string> = {};

  beforeAll(async () => {
    f = await setupFixtures();
    const svc = serviceClient();

    const plant = async (table: string, payload: Record<string, unknown>) => {
      const { data, error } = await svc
        .from(table as never)
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw new Error(`${table}: ${error.message}`);
      planted[table] = (data as { id: string }).id;
      return planted[table];
    };

    const crId = await plant("change_requests", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      cr_number: `CR-P192-${crypto.randomUUID().slice(0, 6)}`,
      change_type: "design",
      title: "P192 fixture CR (company B)",
      description: "fixture",
      reason: "fixture",
      status: "assessment",
      affected_systems: [{ entity_type: "purchase_order", entity_id: crypto.randomUUID() }],
    });

    await plant("impact_assessments", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      event_type: "module_changed",
      source_type: "project",
      source_id: f.B.projectId,
      title: "P192 fixture impact (company B)",
      severity: "medium",
      impacts: [],
    });

    await plant("entity_links", {
      company_id: f.B.companyId,
      source_type: "change_request",
      source_id: crId,
      link_type: "impacts",
      target_type: "project",
      target_id: f.B.projectId,
    });

    await plant("moc_implementation_tasks", {
      company_id: f.B.companyId,
      change_request_id: crId,
      owner_role: "project_admin",
      title: "P192 fixture task (company B)",
      status: "pending",
    });
  });

  afterAll(async () => {
    await f?.cleanup?.();
  });

  for (const table of MOC_TABLES) {
    it(`company A reads zero company B rows from ${table}`, async () => {
      const { data, error } = await f.A.client
        .from(table as never)
        .select("id")
        .eq("id", planted[table]);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it(`external viewer reads zero rows from ${table}`, async () => {
      const { data } = await f.viewer.client
        .from(table as never)
        .select("id")
        .limit(50);
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("company B owner still sees its own change request", async () => {
    const { data, error } = await f.B.client
      .from("change_requests")
      .select("id")
      .eq("id", planted.change_requests);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });

  it("company A cannot update company B's implementation task", async () => {
    const { data } = await f.A.client
      .from("moc_implementation_tasks")
      .update({ status: "done" } as never)
      .eq("id", planted.moc_implementation_tasks)
      .select("id");
    expect(data ?? []).toHaveLength(0);
  });
});
