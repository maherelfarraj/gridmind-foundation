// P-158 — PV design tables cross-tenant RLS probe.
//
// Follows the repo pattern (tests/rls/helpers/rls.ts): service-role client for
// setup/teardown only, per-user JWT clients for every assertion. Self-skips
// when the Supabase test env is unreachable so `bun run test:all` still passes
// without credentials.
//
// Proves, for pv_equipment_library / pv_site_configs / pv_layouts /
// pv_strings / pv_simulations:
//   1. A user in company B reads zero rows planted under company A.
//   2. A cross-tenant INSERT (company A's ID from company B's session) fails.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { isSupabaseUp, serviceClient } from "./helpers/rls";

const URL_ = process.env.SUPABASE_TEST_URL ?? process.env.SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";

type AppRole = Database["public"]["Enums"]["app_role"];
type Actor = { userId: string; client: SupabaseClient<Database> };

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
  return {
    userId: data.user.id,
    client: createClient<Database>(URL_, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    }),
  };
}

async function makeCompany(svc: SupabaseClient<Database>, label: string) {
  const slug = `p158-${label}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: co, error } = await svc
    .from("companies")
    .insert({ name: `P158 ${label}`, slug, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (error || !co) throw error ?? new Error("company insert failed");
  const { data: proj, error: projErr } = await svc
    .from("projects")
    .insert({
      company_id: co.id,
      name: `P158 project ${label}`,
      code: `P158-${label.toUpperCase()}-${crypto.randomUUID().slice(0, 4)}`,
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

describe.skipIf(!up)("P-158 PV design tables — cross-tenant RLS", () => {
  const svc = up ? serviceClient() : (null as never);
  const state: {
    a?: { companyId: string; projectId: string };
    b?: { companyId: string; projectId: string };
    engineerB?: Actor;
    siteConfigId?: string;
    layoutId?: string;
    simulationId?: string;
  } = {};

  beforeAll(async () => {
    state.a = await makeCompany(svc, "a");
    state.b = await makeCompany(svc, "b");
    state.engineerB = await makeActor(svc, "eng-b", state.b.companyId, ["engineer"]);

    await svc.from("pv_equipment_library").insert({
      company_id: state.a.companyId,
      category: "module",
      manufacturer: "P158 Modules",
      model: `M-${crypto.randomUUID().slice(0, 6)}`,
      status: "active",
    } as never);

    const { data: site, error: siteErr } = await svc
      .from("pv_site_configs")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        name: "P158 site",
        status: "active",
      } as never)
      .select("id")
      .single();
    if (siteErr || !site) throw siteErr ?? new Error("site config insert failed");
    state.siteConfigId = (site as { id: string }).id;

    const { data: layout, error: layoutErr } = await svc
      .from("pv_layouts")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        site_config_id: state.siteConfigId,
        name: "P158 layout",
        status: "draft",
      } as never)
      .select("id")
      .single();
    if (layoutErr || !layout) throw layoutErr ?? new Error("layout insert failed");
    state.layoutId = (layout as { id: string }).id;

    const { data: sim, error: simErr } = await svc
      .from("pv_simulations")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        name: "P158 simulation",
        status: "complete",
        engine_id: "gridmind-yield-v2",
        calc_version: 2,
      } as never)
      .select("id")
      .single();
    if (simErr || !sim) throw simErr ?? new Error("simulation insert failed");
    state.simulationId = (sim as { id: string }).id;
  }, 60_000);

  afterAll(async () => {
    if (!up) return;
    for (const id of [state.a?.companyId, state.b?.companyId]) {
      if (id) await svc.from("companies").delete().eq("id", id);
    }
    if (state.engineerB) {
      await svc.auth.admin.deleteUser(state.engineerB.userId).catch(() => undefined);
    }
  }, 60_000);

  const tables = [
    "pv_equipment_library",
    "pv_site_configs",
    "pv_layouts",
    "pv_strings",
    "pv_simulations",
  ] as const;

  for (const table of tables) {
    it(`company B reads 0 ${table} rows from company A`, async () => {
      const { data, error } = await state
        .engineerB!.client.from(table)
        .select("id")
        .eq("company_id", state.a!.companyId);
      expect(error, error?.message).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("cross-tenant pv_site_configs insert is rejected", async () => {
    const { error } = await state.engineerB!.client.from("pv_site_configs").insert({
      company_id: state.a!.companyId,
      project_id: state.a!.projectId,
      name: "cross-tenant",
      status: "draft",
    } as never);
    expect(error).not.toBeNull();
  });

  it("cross-tenant pv_layouts insert is rejected", async () => {
    const { error } = await state.engineerB!.client.from("pv_layouts").insert({
      company_id: state.a!.companyId,
      project_id: state.a!.projectId,
      site_config_id: state.siteConfigId!,
      name: "cross-tenant",
      status: "draft",
    } as never);
    expect(error).not.toBeNull();
  });

  it("cross-tenant pv_simulations insert is rejected", async () => {
    const { error } = await state.engineerB!.client.from("pv_simulations").insert({
      company_id: state.a!.companyId,
      project_id: state.a!.projectId,
      name: "cross-tenant",
      status: "complete",
      engine_id: "gridmind-yield-v2",
      calc_version: 2,
    } as never);
    expect(error).not.toBeNull();
  });
});
