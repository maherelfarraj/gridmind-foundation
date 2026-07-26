// P-170 — Batch-19 (Electrical Analysis) cross-tenant RLS probe.
//
// Repo pattern (P-132 / tests/rls/helpers/rls.ts): service-role client for
// setup + teardown only, per-user JWT clients for every assertion. Self-skips
// when the Supabase test env is unreachable so shards still pass offline.
//
// Proves, for ea_studies, ea_protection_devices, ea_relay_settings and
// ea_grid_code_responses:
//   1. A tenant-B engineer reads zero tenant-A rows and cannot insert into A.
//   2. External viewers (client_viewer / lender_viewer) inside tenant A read
//      zero rows — studies are never client- or lender-visible.
//   3. The tenant-A engineer does read their own rows (proves the probe works).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { isSupabaseUp, serviceClient } from "./helpers/rls";

const URL_ = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";

type AppRole = Database["public"]["Enums"]["app_role"];
type Actor = { userId: string; email: string; client: SupabaseClient<Database> };

async function makeActor(
  svc: SupabaseClient<Database>,
  prefix: string,
  companyId: string,
  roles: AppRole[],
): Promise<Actor> {
  const email = `${prefix}-${crypto.randomUUID().slice(0, 8)}@gm-rls-test.local`;
  const password = `Pw!${crypto.randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  await svc.from("profiles").upsert({ id: data.user.id, company_id: companyId, email });
  if (roles.length) {
    await svc
      .from("user_roles")
      .insert(roles.map((role) => ({ user_id: data.user!.id, company_id: companyId, role })));
  }
  const anon = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session.session) throw signInErr ?? new Error("sign-in failed");
  const client = createClient<Database>(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  return { userId: data.user.id, email, client };
}

async function makeCompany(svc: SupabaseClient<Database>, label: string) {
  const slug = `p170-${label}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: co, error } = await svc
    .from("companies")
    .insert({ name: `P170 ${label}`, slug, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (error || !co) throw error ?? new Error("company insert failed");
  const { data: proj, error: projErr } = await svc
    .from("projects")
    .insert({
      company_id: co.id,
      name: `P170 project ${label}`,
      code: `P170-${label.toUpperCase()}-${crypto.randomUUID().slice(0, 4)}`,
      archetype: "utility_pv",
      phase: "development",
      status: "active",
    })
    .select("id")
    .single();
  if (projErr || !proj) throw projErr ?? new Error("project insert failed");
  return { companyId: co.id, projectId: proj.id };
}

const up = await isSupabaseUp();

describe.skipIf(!up)("P-170 electrical analysis — cross-tenant RLS", () => {
  const svc = up ? serviceClient() : (null as never);
  const state: {
    a?: { companyId: string; projectId: string };
    b?: { companyId: string; projectId: string };
    engA?: Actor;
    engB?: Actor;
    clientViewerA?: Actor;
    lenderViewerA?: Actor;
    studyId?: string;
    deviceId?: string;
  } = {};

  beforeAll(async () => {
    state.a = await makeCompany(svc, "a");
    state.b = await makeCompany(svc, "b");
    state.engA = await makeActor(svc, "ea-eng-a", state.a.companyId, ["engineer"]);
    state.engB = await makeActor(svc, "ea-eng-b", state.b.companyId, ["engineer"]);
    state.clientViewerA = await makeActor(svc, "ea-cv-a", state.a.companyId, ["client_viewer"]);
    state.lenderViewerA = await makeActor(svc, "ea-lv-a", state.a.companyId, ["lender_viewer"]);

    const { data: study, error: studyErr } = await svc
      .from("ea_studies")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        study_number: `EA-${crypto.randomUUID().slice(0, 6)}`,
        title: "P170 tenant A load flow",
        study_type: "load_flow",
      })
      .select("id")
      .single();
    if (studyErr || !study) throw studyErr ?? new Error("study insert failed");
    state.studyId = study.id;

    const { data: device, error: devErr } = await svc
      .from("ea_protection_devices")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        tag: `P170-RLY-${crypto.randomUUID().slice(0, 4)}`,
        device_type: "relay",
      })
      .select("id")
      .single();
    if (devErr || !device) throw devErr ?? new Error("device insert failed");
    state.deviceId = device.id;

    const { error: relayErr } = await svc.from("ea_relay_settings").insert({
      company_id: state.a.companyId,
      project_id: state.a.projectId,
      device_id: device.id,
      function_code: "50",
      pickup: 1.2,
    });
    if (relayErr) throw relayErr;

    const { data: tpl, error: tplErr } = await svc
      .from("ea_grid_code_templates")
      .insert({
        company_id: state.a.companyId,
        market: `P170-${crypto.randomUUID().slice(0, 6)}`,
        name: "P170 grid code",
        items: [{ code: "P170-GC-1", requirement: "Probe requirement" }],
      })
      .select("id")
      .single();
    if (tplErr || !tpl) throw tplErr ?? new Error("template insert failed");

    const { error: gcErr } = await svc.from("ea_grid_code_responses").insert({
      company_id: state.a.companyId,
      project_id: state.a.projectId,
      template_id: tpl.id,
      item_index: 0,
      status: "open",
    });
    if (gcErr) throw gcErr;
  }, 90_000);

  afterAll(async () => {
    if (!up) return;
    for (const id of [state.a?.companyId, state.b?.companyId]) {
      if (id) await svc.from("companies").delete().eq("id", id);
    }
    for (const actor of [state.engA, state.engB, state.clientViewerA, state.lenderViewerA]) {
      if (actor) await svc.auth.admin.deleteUser(actor.userId).catch(() => undefined);
    }
  }, 90_000);

  const denyRead = (table: string, actor: () => Actor, filter: () => Record<string, string>) =>
    it(`${table}: no rows leak`, async () => {
      let q = actor().client.from(table as never).select("id");
      for (const [k, v] of Object.entries(filter())) q = q.eq(k, v);
      const { data, error } = await q;
      // Either an explicit permission error or, more usually, zero rows.
      if (error) expect(error.message).toMatch(/permission|denied|policy/i);
      expect(data ?? []).toHaveLength(0);
    });

  describe("tenant B engineer", () => {
    denyRead(
      "ea_studies",
      () => state.engB!,
      () => ({ company_id: state.a!.companyId }),
    );
    denyRead(
      "ea_protection_devices",
      () => state.engB!,
      () => ({ company_id: state.a!.companyId }),
    );
    denyRead(
      "ea_relay_settings",
      () => state.engB!,
      () => ({ device_id: state.deviceId! }),
    );
    denyRead(
      "ea_grid_code_responses",
      () => state.engB!,
      () => ({ company_id: state.a!.companyId }),
    );

    it("cannot insert a study into tenant A", async () => {
      const { error } = await state.engB!.client.from("ea_studies").insert({
        company_id: state.a!.companyId,
        project_id: state.a!.projectId,
        study_number: `EA-X-${crypto.randomUUID().slice(0, 6)}`,
        title: "cross-tenant write attempt",
        study_type: "load_flow",
      });
      expect(error).not.toBeNull();
      expect(error!.message).toMatch(/row-level security|permission|denied|policy/i);
    });
  });

  describe("external viewers inside tenant A", () => {
    denyRead(
      "ea_studies",
      () => state.clientViewerA!,
      () => ({ company_id: state.a!.companyId }),
    );
    denyRead(
      "ea_studies",
      () => state.lenderViewerA!,
      () => ({ company_id: state.a!.companyId }),
    );
    denyRead(
      "ea_protection_devices",
      () => state.clientViewerA!,
      () => ({ company_id: state.a!.companyId }),
    );
    denyRead(
      "ea_grid_code_responses",
      () => state.lenderViewerA!,
      () => ({ company_id: state.a!.companyId }),
    );
  });

  it("tenant A engineer DOES read their own study (probe sanity)", async () => {
    const { data, error } = await state
      .engA!.client.from("ea_studies")
      .select("id, title")
      .eq("id", state.studyId!);
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(1);
  });
});
