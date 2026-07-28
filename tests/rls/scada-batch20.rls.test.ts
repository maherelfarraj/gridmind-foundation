// P-178 (Batch 20) — RLS stub for the SCADA operations tables.
//
// Runs only under the full-suite config (`bun run test:all`); the unit config
// excludes tests/rls/**. Self-skips when Supabase env is unreachable, exactly
// like the P-132 matrix.
//
// Proves:
//   1. A user in company A reads ZERO rows planted under company B on all
//      eight Batch 20 tables.
//   2. scada_events INSERT is denied for a field_technician and allowed for
//      an om_admin.
//   3. scada_events is append-only: UPDATE by an authenticated user is denied.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/integrations/supabase/types";
import { isSupabaseUp, serviceClient, setupFixtures, type Fixtures } from "./helpers/rls";
import { signInWithBackoff } from "../helpers/auth-retry";

const URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const ANON =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY ??
  "";

const up = await isSupabaseUp();

const BATCH20_TABLES = [
  "asset_nodes",
  "tag_dictionary",
  "scada_events",
  "scada_kpi_daily",
  "event_action_rules",
  "event_action_log",
  "ingestion_retry_queue",
  "ingestion_dead_letter",
] as const;

type Extra = {
  userId: string;
  client: SupabaseClient<Database>;
};

async function makeRoleUser(
  svc: SupabaseClient<Database>,
  companyId: string,
  role: "field_technician" | "om_admin",
): Promise<Extra> {
  const email = `p178-${role}-${crypto.randomUUID().slice(0, 8)}@gm-rls-test.local`;
  const password = `Pw!${crypto.randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  await svc.from("profiles").upsert({ id: data.user.id, company_id: companyId, email });
  await svc.from("user_roles").insert({ user_id: data.user.id, company_id: companyId, role });

  const auth = createClient<Database>(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signIn, error: signInErr } = await signInWithBackoff(auth, email, password);
  if (signInErr || !signIn.session) throw signInErr ?? new Error("sign-in failed");
  return {
    userId: data.user.id,
    client: createClient<Database>(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } },
    }),
  };
}

describe.skipIf(!up)("P-178 Batch 20 RLS isolation", () => {
  let f: Fixtures;
  let tech: Extra;
  let omAdmin: Extra;
  let seeded: Record<string, string[]> = {};

  beforeAll(async () => {
    f = await setupFixtures();
    const svc = serviceClient();
    [tech, omAdmin] = await Promise.all([
      makeRoleUser(svc, f.A.companyId, "field_technician"),
      makeRoleUser(svc, f.A.companyId, "om_admin"),
    ]);

    const ids: Record<string, string[]> = {};
    const plant = async (table: string, payload: Record<string, unknown>) => {
      const { data, error } = await svc
        .from(table as never)
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw new Error(`${table}: ${error.message}`);
      ids[table] = [(data as { id: string }).id];
      return (data as { id: string }).id;
    };

    const nodeId = await plant("asset_nodes", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      node_type: "plant",
      name: "P178 plant B",
      tag: `P178-${crypto.randomUUID().slice(0, 8)}`,
    });
    await plant("tag_dictionary", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      asset_node_id: nodeId,
      tag: `P178-TAG-${crypto.randomUUID().slice(0, 8)}`,
      metric: "power_kw",
      unit: "kW",
    });
    const eventId = await plant("scada_events", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      event_type: "trip",
      severity: "major",
      message: "P178 fixture trip",
    });
    await plant("scada_kpi_daily", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      day: "2026-04-01",
      downtime_minutes: 10,
    });
    const ruleId = await plant("event_action_rules", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      name: `P178 rule ${crypto.randomUUID().slice(0, 8)}`,
      event_type: "trip",
      action_type: "create_work_order",
      requires_approval: true,
    });
    await plant("event_action_log", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      rule_id: ruleId,
      scada_event_id: eventId,
      action_type: "create_work_order",
      status: "pending_approval",
    });
    await plant("ingestion_retry_queue", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      payload: { rows: [] },
      payload_kind: "telemetry",
      error: "fixture",
    });
    await plant("ingestion_dead_letter", {
      company_id: f.B.companyId,
      project_id: f.B.projectId,
      payload: { rows: [] },
      payload_kind: "telemetry",
      first_error: "fixture",
      final_error: "fixture",
      attempts: 5,
    });
    seeded = ids;
  }, 90_000);

  afterAll(async () => {
    const svc = serviceClient();
    for (const table of [...BATCH20_TABLES].reverse()) {
      const ids = seeded[table] ?? [];
      if (ids.length)
        await svc
          .from(table as never)
          .delete()
          .in("id", ids);
    }
    for (const u of [tech, omAdmin]) {
      if (u) await svc.auth.admin.deleteUser(u.userId).catch(() => undefined);
    }
    await f?.cleanup();
  }, 90_000);

  for (const table of BATCH20_TABLES) {
    it(`${table}: company A reads zero rows from company B`, async () => {
      const { data, error } = await f.A.client
        .from(table as never)
        .select("id")
        .eq("company_id", f.B.companyId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("scada_events: field_technician INSERT is denied", async () => {
    const { error } = await tech.client.from("scada_events").insert({
      company_id: f.A.companyId,
      project_id: f.A.projectId,
      event_type: "trip",
      severity: "major",
      message: "tech should not write this",
    } as never);
    expect(error).not.toBeNull();
  });

  it("scada_events: om_admin INSERT is allowed", async () => {
    const { data, error } = await omAdmin.client
      .from("scada_events")
      .insert({
        company_id: f.A.companyId,
        project_id: f.A.projectId,
        event_type: "trip",
        severity: "major",
        message: "om_admin write",
      } as never)
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    if (data?.id) await serviceClient().from("scada_events").delete().eq("id", data.id);
  });

  it("scada_events is append-only: authenticated UPDATE changes nothing", async () => {
    const svc = serviceClient();
    const { data: row } = await svc
      .from("scada_events")
      .insert({
        company_id: f.A.companyId,
        project_id: f.A.projectId,
        event_type: "trip",
        severity: "major",
        message: "immutable row",
      } as never)
      .select("id")
      .single();
    const id = (row as { id: string }).id;

    const { data: updated } = await f.A.client
      .from("scada_events")
      .update({ message: "tampered" } as never)
      .eq("id", id)
      .select("id");
    // No UPDATE policy exists → zero rows affected (and never an error-free edit).
    expect(updated ?? []).toHaveLength(0);

    const { data: after } = await svc
      .from("scada_events")
      .select("message")
      .eq("id", id)
      .maybeSingle();
    expect((after as { message: string } | null)?.message).toBe("immutable row");
    await svc.from("scada_events").delete().eq("id", id);
  });
});
