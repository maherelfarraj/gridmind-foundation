// P-170 — EA study revision chain: draft → submit → approve → immutable → new revision.
//
// DB-backed (service-role client, per P-132 harness) and self-skipping when the
// Supabase test env is unreachable. Proves the interplay of the approval lock,
// the ea_study_immutable guard and the append-only snapshot table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { isSupabaseUp, serviceClient } from "./helpers/rls";
import { purgeFixtureTenants } from "../helpers/fixture-teardown";

const up = await isSupabaseUp();

async function makeCompany(svc: SupabaseClient<Database>) {
  const slug = `p170rev-${crypto.randomUUID().slice(0, 8)}`;
  const { data: co, error } = await svc
    .from("companies")
    .insert({ name: "P170 revision chain", slug, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (error || !co) throw error ?? new Error("company insert failed");
  const { data: proj, error: projErr } = await svc
    .from("projects")
    .insert({
      company_id: co.id,
      name: "P170 revision project",
      code: `P170R-${crypto.randomUUID().slice(0, 6)}`,
      archetype: "utility_pv",
      phase: "development",
      status: "active",
    })
    .select("id")
    .single();
  if (projErr || !proj) throw projErr ?? new Error("project insert failed");
  return { companyId: co.id, projectId: proj.id };
}

describe.skipIf(!up)("P-170 EA study revision chain", () => {
  const svc = up ? serviceClient() : (null as never);
  const state: { companyId?: string; projectId?: string; studyId?: string } = {};

  beforeAll(async () => {
    const co = await makeCompany(svc);
    state.companyId = co.companyId;
    state.projectId = co.projectId;
  }, 90_000);

  afterAll(async () => {
    if (!up) return;
    await purgeFixtureTenants(svc, [state.companyId]);
  }, 90_000);

  it("creates a draft at revision 0", async () => {
    const { data, error } = await svc
      .from("ea_studies")
      .insert({
        company_id: state.companyId!,
        project_id: state.projectId!,
        study_number: `EA-REV-${crypto.randomUUID().slice(0, 6)}`,
        title: "Revision chain study",
        study_type: "load_flow",
        input_sheet: { baseMva: 100 },
        results: { converged: true },
        method: "radial backward/forward sweep",
      })
      .select("id, revision, status")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data!.revision).toBe(0);
    expect(data!.status).toBe("draft");
    state.studyId = data!.id;
  });

  it("submits into review", async () => {
    const { data, error } = await svc
      .from("ea_studies")
      .update({ status: "under_review", submitted_at: new Date().toISOString() })
      .eq("id", state.studyId!)
      .select("status, submitted_at")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data!.status).toBe("under_review");
    expect(data!.submitted_at).not.toBeNull();
  });

  it("approves and snapshots the approved payload", async () => {
    const { data, error } = await svc
      .from("ea_studies")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", state.studyId!)
      .select("status, approved_at, revision, input_sheet, results, method")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data!.status).toBe("approved");
    expect(data!.approved_at).not.toBeNull();

    const { error: snapErr } = await svc.from("ea_study_revisions").insert({
      company_id: state.companyId!,
      study_id: state.studyId!,
      revision: data!.revision,
      status: "approved",
      input_sheet: data!.input_sheet,
      results: data!.results,
      method: data!.method,
    });
    expect(snapErr, snapErr?.message).toBeNull();
  });

  it("rejects mutating the approved payload (ea_study_immutable)", async () => {
    const { error } = await svc
      .from("ea_studies")
      .update({ input_sheet: { baseMva: 250 } })
      .eq("id", state.studyId!);
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/ea_study_immutable/);
  });

  it("enforces unique (study_id, revision) on snapshots", async () => {
    const { error } = await svc.from("ea_study_revisions").insert({
      company_id: state.companyId!,
      study_id: state.studyId!,
      revision: 0,
      status: "approved",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/duplicate key|unique/i);
  });

  it("opens revision 1 as a draft and leaves the prior snapshot intact", async () => {
    const { data, error } = await svc
      .from("ea_studies")
      .update({
        revision: 1,
        status: "draft",
        input_sheet: { baseMva: 250 },
        approved_at: null,
        submitted_at: null,
      })
      .eq("id", state.studyId!)
      .select("revision, status, input_sheet")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data!.revision).toBe(1);
    expect(data!.status).toBe("draft");

    const { data: snaps, error: snapErr } = await svc
      .from("ea_study_revisions")
      .select("revision, status, input_sheet")
      .eq("study_id", state.studyId!)
      .order("revision", { ascending: true });
    expect(snapErr, snapErr?.message).toBeNull();
    expect(snaps).toHaveLength(1);
    expect(snaps![0].revision).toBe(0);
    expect(snaps![0].status).toBe("approved");
    expect((snaps![0].input_sheet as Record<string, unknown>).baseMva).toBe(100);
  });
});
