// P-148 — SLD core cross-tenant RLS probe.
//
// Follows the repo pattern (tests/rls/helpers/rls.ts): service-role client for
// setup/teardown only, per-user JWT clients for every assertion. Self-skips
// when the Supabase test env is unreachable so `bun run test:all` still passes
// on isolated shards.
//
// Proves:
//   1. A user in company B reads zero sld_drawings / sld_objects /
//      sld_schedules rows created under company A.
//   2. A client_viewer (no engineering role) cannot INSERT an sld_drawing.
//   3. An engineer in their own company CAN insert.

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
  const slug = `p148-${label}-${crypto.randomUUID().slice(0, 8)}`;
  const { data: co, error } = await svc
    .from("companies")
    .insert({ name: `P148 ${label}`, slug, plan_tier: "enterprise" })
    .select("id")
    .single();
  if (error || !co) throw error ?? new Error("company insert failed");
  const { data: proj, error: projErr } = await svc
    .from("projects")
    .insert({
      company_id: co.id,
      name: `P148 project ${label}`,
      code: `P148-${label.toUpperCase()}-${crypto.randomUUID().slice(0, 4)}`,
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

describe.skipIf(!up)("P-148 SLD core — cross-tenant RLS", () => {
  const svc = up ? serviceClient() : (null as never);
  const state: {
    a?: { companyId: string; projectId: string };
    b?: { companyId: string; projectId: string };
    engineerA?: Actor;
    engineerB?: Actor;
    viewerA?: Actor;
    drawingId?: string;
    revisionId?: string;
    objectId?: string;
  } = {};

  beforeAll(async () => {
    state.a = await makeCompany(svc, "a");
    state.b = await makeCompany(svc, "b");
    state.engineerA = await makeActor(svc, "eng-a", state.a.companyId, ["engineer"]);
    state.engineerB = await makeActor(svc, "eng-b", state.b.companyId, ["engineer"]);
    state.viewerA = await makeActor(svc, "viewer-a", state.a.companyId, []);

    // Plant a complete SLD stack under company A with the service client.
    const { data: dwg, error: dwgErr } = await svc
      .from("sld_drawings")
      .insert({
        company_id: state.a.companyId,
        project_id: state.a.projectId,
        drawing_number: "SLD-0001",
        title: "P148 tenant A main SLD",
      })
      .select("id")
      .single();
    if (dwgErr || !dwg) throw dwgErr ?? new Error("drawing insert failed");
    state.drawingId = dwg.id;

    const { data: rev, error: revErr } = await svc
      .from("sld_revisions")
      .insert({ company_id: state.a.companyId, drawing_id: dwg.id, revision_code: "A" })
      .select("id")
      .single();
    if (revErr || !rev) throw revErr ?? new Error("revision insert failed");
    state.revisionId = rev.id;

    const { data: o, error: oErr } = await svc
      .from("sld_objects")
      .insert({
        company_id: state.a.companyId,
        revision_id: rev.id,
        symbol_type: "inverter",
        tag: "INV-01-01",
        x: 100,
        y: 100,
      })
      .select("id")
      .single();
    if (oErr || !o) throw oErr ?? new Error("object insert failed");
    state.objectId = o.id;

    const { error: schErr } = await svc.from("sld_schedules").insert({
      company_id: state.a.companyId,
      revision_id: rev.id,
      schedule_type: "equipment",
      rows: [{ tag: "INV-01-01", symbol_type: "inverter" }],
      row_count: 1,
    });
    if (schErr) throw schErr;
  }, 60_000);

  afterAll(async () => {
    if (!up) return;
    for (const id of [state.a?.companyId, state.b?.companyId]) {
      if (id) await svc.from("companies").delete().eq("id", id);
    }
    for (const actor of [state.engineerA, state.engineerB, state.viewerA]) {
      if (actor) await svc.auth.admin.deleteUser(actor.userId).catch(() => undefined);
    }
  }, 60_000);

  it("company B engineer reads 0 sld_drawings from company A", async () => {
    const { data, error } = await state
      .engineerB!.client.from("sld_drawings")
      .select("id")
      .eq("company_id", state.a!.companyId);
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("company B engineer reads 0 sld_objects from company A", async () => {
    const { data, error } = await state
      .engineerB!.client.from("sld_objects")
      .select("id")
      .eq("revision_id", state.revisionId!);
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("company B engineer reads 0 sld_schedules from company A", async () => {
    const { data, error } = await state
      .engineerB!.client.from("sld_schedules")
      .select("id")
      .eq("revision_id", state.revisionId!);
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("company A engineer DOES read their own drawing", async () => {
    const { data, error } = await state
      .engineerA!.client.from("sld_drawings")
      .select("id, drawing_number")
      .eq("id", state.drawingId!);
    expect(error, error?.message).toBeNull();
    expect(data ?? []).toHaveLength(1);
    expect(data![0].drawing_number).toBe("SLD-0001");
  });

  it("client_viewer (no engineering role) INSERT is denied", async () => {
    const { error } = await state.viewerA!.client.from("sld_drawings").insert({
      company_id: state.a!.companyId,
      project_id: state.a!.projectId,
      drawing_number: "SLD-9998",
      title: "viewer attempt",
    });
    expect(error).not.toBeNull();
  });

  it("engineer INSERT into their own tenant is allowed", async () => {
    const { data, error } = await state
      .engineerA!.client.from("sld_drawings")
      .insert({
        company_id: state.a!.companyId,
        project_id: state.a!.projectId,
        drawing_number: "SLD-0002",
        title: "engineer insert",
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data?.id).toBeTruthy();
  });

  it("engineer cannot INSERT a drawing scoped to the other tenant", async () => {
    const { error } = await state.engineerA!.client.from("sld_drawings").insert({
      company_id: state.b!.companyId,
      project_id: state.b!.projectId,
      drawing_number: "SLD-9999",
      title: "cross-tenant attempt",
    });
    expect(error).not.toBeNull();
  });
});
