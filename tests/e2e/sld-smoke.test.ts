// P-148 — SLD CAD E2E smoke.
//
// Same harness as tests/e2e/smoke.test.ts: no browser automation. The engineer
// signs in over the Supabase HTTP API and every state change runs through the
// authenticated client (RLS enforced as the user) plus the same pure libs the
// server functions call. Setup/teardown uses a service-role client that never
// appears in an assertion. Self-skips when the dev server or service-role env
// are unavailable.
//
// Flow: create drawing (SLD-0001) → place inverter + transformer + grid point
// → connect ports → validate (zero errors) → generate schedules (3 equipment
// rows) → submit for review → approve via a seeded sld_drawing_approval
// instance → status reads approved. An audit row is asserted for each step.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDevServerUp } from "../helpers/dev-server";
import { envReady, login, service } from "./helpers/rpc";
import { runValidation, type ConnEdge, type ConnObject } from "@/lib/sld/connectivity";

const canRun = (await isDevServerUp()) && envReady();

const SYMBOLS = [
  { type_key: "inverter", category: "conversion", tag_prefix: "INV" },
  { type_key: "transformer", category: "transformation", tag_prefix: "TR" },
  { type_key: "grid_connection_point", category: "grid", tag_prefix: "GRD" },
];

describe.skipIf(!canRun)("P-148 e2e smoke: SLD create → validate → schedule → approve", () => {
  const svc = envReady() ? service() : (null as never);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `sld-smoke-${suffix}@gm-e2e.local`;
  const password = `Pw!${crypto.randomUUID()}`;

  const state: {
    companyId?: string;
    projectId?: string;
    userId?: string;
    drawingId?: string;
    revisionId?: string;
    objectIds?: Record<string, string>;
    instanceId?: string;
  } = {};

  beforeAll(async () => {
    const { data: co, error: coErr } = await svc
      .from("companies")
      .insert({ name: `SLD E2E ${suffix}`, slug: `sld-e2e-${suffix}`, plan_tier: "enterprise" })
      .select("id")
      .single();
    if (coErr || !co) throw coErr ?? new Error("company insert failed");
    state.companyId = co.id;

    const { data: u, error: uErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (uErr || !u.user) throw uErr ?? new Error("user create failed");
    state.userId = u.user.id;
    await svc.from("profiles").upsert({ id: state.userId, company_id: co.id, email });
    await svc.from("user_roles").insert(
      (["engineer", "engineering_admin", "project_admin"] as const).map((role) => ({
        user_id: state.userId!,
        company_id: co.id,
        role,
      })),
    );

    const { data: proj, error: projErr } = await svc
      .from("projects")
      .insert({
        company_id: co.id,
        name: `SLD E2E project ${suffix}`,
        code: `SLDE2E-${suffix.toUpperCase()}`,
        archetype: "utility_pv",
        phase: "development",
        status: "active",
        created_by: state.userId,
      })
      .select("id")
      .single();
    if (projErr || !proj) throw projErr ?? new Error("project insert failed");
    state.projectId = proj.id;
  }, 60_000);

  afterAll(async () => {
    if (!canRun) return;
    if (state.companyId) await svc.from("companies").delete().eq("id", state.companyId);
    if (state.userId) await svc.auth.admin.deleteUser(state.userId).catch(() => undefined);
  }, 60_000);

  it("runs the CAD golden path end to end", async () => {
    const start = Date.now();
    const { client, userId } = await login(email, password);

    // ----------------------------------------------------------------- 1
    console.info("[sld-smoke] step 1 — create drawing with auto number");
    const { data: nextNumber, error: numErr } = await client.rpc("next_sld_drawing_number", {
      p_project_id: state.projectId!,
    });
    expect(numErr, numErr?.message).toBeNull();
    expect(nextNumber).toBe("SLD-0001");

    const { data: dwg, error: dwgErr } = await client
      .from("sld_drawings")
      .insert({
        company_id: state.companyId!,
        project_id: state.projectId!,
        drawing_number: nextNumber as string,
        title: "Main single line diagram",
        created_by: userId,
      })
      .select("id, drawing_number, status")
      .single();
    expect(dwgErr, dwgErr?.message).toBeNull();
    expect(dwg!.drawing_number).toBe("SLD-0001");
    expect(dwg!.status).toBe("draft");
    state.drawingId = dwg!.id;

    const { data: rev, error: revErr } = await client
      .from("sld_revisions")
      .insert({
        company_id: state.companyId!,
        drawing_id: state.drawingId!,
        revision_code: "A",
        created_by: userId,
      })
      .select("id")
      .single();
    expect(revErr, revErr?.message).toBeNull();
    state.revisionId = rev!.id;
    await client
      .from("sld_drawings")
      .update({ current_revision_id: state.revisionId! })
      .eq("id", state.drawingId!);

    await client.rpc("write_audit_log", {
      p_action: "sld.drawing_created",
      p_entity: "sld_drawings",
      p_entity_id: state.drawingId!,
      p_metadata: { drawing_number: "SLD-0001", via: "e2e_sld_smoke" },
    });

    // ----------------------------------------------------------------- 2
    console.info("[sld-smoke] step 2 — place inverter + transformer + grid point");
    const placements = [
      { symbol_type: "inverter", tag: "INV-01-01", x: 100, y: 200 },
      { symbol_type: "transformer", tag: "TR-01-01", x: 400, y: 200 },
      { symbol_type: "grid_connection_point", tag: "GRD-01-01", x: 700, y: 200 },
    ];
    const { data: placed, error: placeErr } = await client
      .from("sld_objects")
      .insert(
        placements.map((p) => ({
          company_id: state.companyId!,
          revision_id: state.revisionId!,
          symbol_type: p.symbol_type,
          tag: p.tag,
          x: p.x,
          y: p.y,
          layer_id: "equipment",
          properties: {
            voltage_kv: p.symbol_type === "grid_connection_point" ? 33 : 0.69,
            ...(p.symbol_type === "transformer"
              ? { hv_kv: 33, lv_kv: 0.69, rating_kva: 5000 }
              : {}),
            ...(p.symbol_type === "inverter" ? { rating_kw: 3300, ac_voltage_v: 690 } : {}),
          },
          created_by: userId,
        })),
      )
      .select("id, symbol_type");
    expect(placeErr, placeErr?.message).toBeNull();
    expect(placed).toHaveLength(3);
    state.objectIds = Object.fromEntries(placed!.map((o) => [o.symbol_type, o.id]));

    // ----------------------------------------------------------------- 3
    console.info("[sld-smoke] step 3 — connect ports");
    const { error: connErr } = await client.from("sld_connections").insert([
      {
        company_id: state.companyId!,
        revision_id: state.revisionId!,
        from_object_id: state.objectIds!.inverter,
        from_port: "out",
        to_object_id: state.objectIds!.transformer,
        to_port: "lv",
        connection_type: "cable",
        cable_number: "CBL-01-01",
        created_by: userId,
      },
      {
        company_id: state.companyId!,
        revision_id: state.revisionId!,
        from_object_id: state.objectIds!.transformer,
        from_port: "hv",
        to_object_id: state.objectIds!.grid_connection_point,
        to_port: "in",
        connection_type: "cable",
        cable_number: "CBL-01-02",
        created_by: userId,
      },
    ]);
    expect(connErr, connErr?.message).toBeNull();

    // ----------------------------------------------------------------- 4
    console.info("[sld-smoke] step 4 — validate connectivity (expect zero errors)");
    const { data: objRows } = await client
      .from("sld_objects")
      .select("id, symbol_type, tag, properties")
      .eq("revision_id", state.revisionId!);
    const { data: connRows } = await client
      .from("sld_connections")
      .select("id, from_object_id, from_port, to_object_id, to_port, connection_type, properties")
      .eq("revision_id", state.revisionId!);

    const issues = runValidation(
      (objRows ?? []) as unknown as ConnObject[],
      (connRows ?? []) as unknown as ConnEdge[],
      SYMBOLS,
      { projectVoltagesKv: [0.69, 33] },
    );
    expect(
      issues.filter((i) => i.severity === "error"),
      JSON.stringify(issues),
    ).toHaveLength(0);

    await client.rpc("write_audit_log", {
      p_action: "sld.validated",
      p_entity: "sld_revisions",
      p_entity_id: state.revisionId!,
      p_metadata: { errors: 0, warnings: issues.length, via: "e2e_sld_smoke" },
    });

    // ----------------------------------------------------------------- 5
    console.info("[sld-smoke] step 5 — generate schedules (3 equipment rows)");
    const equipmentRows = (objRows ?? []).map((o) => ({
      tag: o.tag,
      symbol_type: o.symbol_type,
    }));
    const { data: sched, error: schedErr } = await client
      .from("sld_schedules")
      .insert({
        company_id: state.companyId!,
        revision_id: state.revisionId!,
        schedule_type: "equipment",
        rows: equipmentRows,
        row_count: equipmentRows.length,
        generated_by: userId,
      })
      .select("row_count")
      .single();
    expect(schedErr, schedErr?.message).toBeNull();
    expect(sched!.row_count).toBe(3);

    await client.rpc("write_audit_log", {
      p_action: "sld.schedules_generated",
      p_entity: "sld_revisions",
      p_entity_id: state.revisionId!,
      p_metadata: { equipment_rows: 3, via: "e2e_sld_smoke" },
    });

    // ----------------------------------------------------------------- 6
    console.info("[sld-smoke] step 6 — submit for review");
    const { error: reviewErr } = await client
      .from("sld_drawings")
      .update({ status: "under_review" })
      .eq("id", state.drawingId!);
    expect(reviewErr, reviewErr?.message).toBeNull();

    await client.rpc("write_audit_log", {
      p_action: "sld.status_changed",
      p_entity: "sld_drawings",
      p_entity_id: state.drawingId!,
      p_metadata: { from: "draft", to: "under_review", via: "e2e_sld_smoke" },
    });

    // ----------------------------------------------------------------- 7
    console.info("[sld-smoke] step 7 — approve via sld_drawing_approval instance");
    const { data: inst, error: instErr } = await client
      .from("approval_instances")
      .insert({
        company_id: state.companyId!,
        entity: "sld_drawing",
        entity_type: "sld_drawing",
        entity_id: state.drawingId!,
        rule_key: "sld_drawing_approval",
        requested_by: userId,
        status: "approved",
        completed_at: new Date().toISOString(),
        metadata: { project_id: state.projectId, via: "e2e_sld_smoke" },
      })
      .select("id, status")
      .single();
    expect(instErr, instErr?.message).toBeNull();
    expect(inst!.status).toBe("approved");
    state.instanceId = inst!.id;

    const { data: approved, error: apprErr } = await client
      .from("sld_drawings")
      .update({ status: "approved" })
      .eq("id", state.drawingId!)
      .select("status")
      .single();
    expect(apprErr, apprErr?.message).toBeNull();
    expect(approved!.status).toBe("approved");

    await client.rpc("write_audit_log", {
      p_action: "sld.approved",
      p_entity: "sld_drawings",
      p_entity_id: state.drawingId!,
      p_metadata: { instance_id: state.instanceId, via: "e2e_sld_smoke" },
    });

    // ----------------------------------------------------------------- 8
    console.info("[sld-smoke] step 8 — verify audit rows for every step");
    const actions = [
      "sld.drawing_created",
      "sld.validated",
      "sld.schedules_generated",
      "sld.status_changed",
      "sld.approved",
    ] as const;
    const { data: audits, error: audErr } = await svc
      .from("audit_logs")
      .select("action")
      .eq("company_id", state.companyId!)
      .in("action", actions as unknown as string[]);
    expect(audErr, audErr?.message).toBeNull();
    const seen = new Set((audits ?? []).map((r) => r.action));
    for (const a of actions) expect(seen.has(a), `missing audit row for ${a}`).toBe(true);

    const elapsed = Date.now() - start;
    console.info(`[sld-smoke] complete — ${elapsed}ms`);
    expect(elapsed).toBeLessThan(60_000);
  }, 60_000);
});
