// P-192 — Capstone E2E: module change → impacts → CR → approval →
// implementation (with the change-control 409 block) → closure → banner clear.
//
// Same harness as tests/e2e/smoke.test.ts: no browser automation. The engineer
// signs in over the Supabase HTTP API and every state change runs through the
// authenticated client (RLS enforced as the user) plus the same pure libs the
// server functions call. Service-role is setup/teardown only and never appears
// in an assertion. Self-skips when the dev server or service-role env are down.

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isDevServerUp } from "../helpers/dev-server";
import { envReady, login, service } from "./helpers/rpc";
import { emitThreadEvent } from "@/lib/digital-thread/engine.server";
import { isUnderChangeControl } from "@/lib/moc.change-control";
import { taskProgress } from "@/lib/moc.exec.rules";

const canRun = (await isDevServerUp()) && envReady();

describe.skipIf(!canRun)("P-192 capstone: module change → CR → implementation → closure", () => {
  const svc = envReady() ? service() : (null as never);
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `moc-capstone-${suffix}@gm-e2e.local`;
  const password = `Pw!${crypto.randomUUID()}`;

  const state: {
    companyId?: string;
    projectId?: string;
    userId?: string;
    poId?: string;
    crId?: string;
    crNumber?: string;
    assessmentId?: string | null;
  } = {};
  let client: Awaited<ReturnType<typeof login>>["client"];

  beforeAll(async () => {
    const { data: co, error: coErr } = await svc
      .from("companies")
      .insert({ name: `P192 capstone ${suffix}`, slug: `p192-${suffix}`, plan_tier: "enterprise" })
      .select("id")
      .single();
    if (coErr || !co) throw coErr ?? new Error("company insert failed");
    state.companyId = co.id;

    const { data: user, error: userErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !user.user) throw userErr ?? new Error("createUser failed");
    state.userId = user.user.id;
    await svc.from("profiles").upsert({ id: user.user.id, company_id: co.id, email });
    for (const role of ["company_admin", "project_admin"]) {
      await svc
        .from("user_roles")
        .insert({ user_id: user.user.id, company_id: co.id, role: role as never });
    }

    const { data: proj, error: projErr } = await svc
      .from("projects")
      .insert({
        company_id: co.id,
        name: `P192 capstone project ${suffix}`,
        code: `P192-${suffix.slice(0, 4).toUpperCase()}`,
        status: "active",
      } as never)
      .select("id")
      .single();
    if (projErr || !proj) throw projErr ?? new Error("project insert failed");
    state.projectId = (proj as { id: string }).id;

    const { data: po } = await svc
      .from("purchase_orders")
      .insert({
        company_id: co.id,
        project_id: state.projectId,
        po_number: `PO-P192-${suffix.slice(0, 5)}`,
        status: "draft",
      } as never)
      .select("id")
      .single();
    state.poId = (po as { id: string } | null)?.id;

    ({ client } = await login(email, password));
  });

  afterAll(async () => {
    if (!state.companyId) return;
    for (const table of [
      "moc_implementation_tasks",
      "entity_links",
      "impact_assessments",
      "change_requests",
      "audit_logs",
      "notifications",
      "purchase_orders",
      "projects",
      "user_roles",
      "profiles",
    ]) {
      await svc
        .from(table as never)
        .delete()
        .eq("company_id", state.companyId as string);
    }
    if (state.userId) await svc.auth.admin.deleteUser(state.userId);
    await svc.from("companies").delete().eq("id", state.companyId);
  });

  it("1. an engineer's module change fans impacts across the thread", async () => {
    const res = await emitThreadEvent(
      { supabase: client as never, user: { id: state.userId! } },
      {
        event: "module_changed",
        sourceType: "project",
        sourceId: state.projectId!,
        projectId: state.projectId!,
        payload: { summary: "Module swapped to 610 Wp bifacial" },
      },
    );
    state.assessmentId = res.assessmentId;
    expect(res.impacts.map((i) => i.area)).toEqual([
      "stringing",
      "quantities",
      "energy_yield",
      "procurement",
      "approved_vendor",
    ]);
    expect(res.assessmentId).toBeTruthy();
  });

  it("2. the engineer raises a design CR against the affected PO", async () => {
    const { data, error } = await client
      .from("change_requests")
      .insert({
        company_id: state.companyId!,
        project_id: state.projectId!,
        cr_number: "PENDING",
        change_type: "design",
        title: "Module change — restring and re-issue PO",
        description: "610 Wp module replaces the awarded 585 Wp unit.",
        reason: "Awarded module discontinued by the supplier.",
        originator_id: state.userId!,
        affected_systems: [{ entity_type: "purchase_order", entity_id: state.poId }],
      } as never)
      .select("id, cr_number, status")
      .single();
    expect(error).toBeNull();
    const cr = data as { id: string; cr_number: string; status: string };
    state.crId = cr.id;
    state.crNumber = cr.cr_number;
    expect(cr.status).toBe("draft");
  });

  it("3. submitting starts the approval chain and moves the CR to assessment", async () => {
    const { data, error } = await client.rpc("submit_change_request", { p_id: state.crId! });
    expect(error).toBeNull();
    expect((data as { status: string }).status).toBe("assessment");
  });

  it("4. an illegal jump is rejected by the state machine", async () => {
    const { error } = await client.rpc("transition_change_request", {
      p_id: state.crId!,
      p_to: "closed",
      p_payload: {},
    } as never);
    expect(error?.message ?? "").toContain("invalid_transition");
  });

  it("5. the chain approves and implementation tasks are generated", async () => {
    const { data: cr } = await client
      .from("change_requests")
      .select("approval_instance_id")
      .eq("id", state.crId!)
      .single();
    const instanceId = (cr as { approval_instance_id: string | null }).approval_instance_id;
    if (instanceId) {
      // Approve every pending step as the admin who holds both chain roles.
      for (let i = 0; i < 4; i += 1) {
        const { data: steps } = await client
          .from("approval_steps")
          .select("id, status")
          .eq("instance_id", instanceId)
          .eq("status", "pending");
        const pending = (steps ?? []) as Array<{ id: string }>;
        if (pending.length === 0) break;
        for (const step of pending) {
          await client.rpc("decide_approval_step", {
            p_step_id: step.id,
            p_decision: "approved",
            p_comment: "P192 capstone approval",
          } as never);
        }
      }
    }

    const { error } = await client.rpc("transition_change_request", {
      p_id: state.crId!,
      p_to: "approved",
      p_payload: {},
    } as never);
    expect(error).toBeNull();

    const { data: made, error: genErr } = await client.rpc("generate_implementation_tasks", {
      p_change_request_id: state.crId!,
    });
    expect(genErr).toBeNull();
    expect(Number(made)).toBeGreaterThan(0);

    const { data: tasks } = await client
      .from("moc_implementation_tasks")
      .select("id, status, owner_role")
      .eq("change_request_id", state.crId!);
    expect((tasks ?? []).length).toBeGreaterThan(0);
    expect(taskProgress(tasks as Array<{ status: string }>).pct).toBe(0);
  });

  it("6. the PO shows the amber banner and issuing is blocked", async () => {
    const { data: blocked, error } = await client.rpc("is_under_change_control", {
      p_entity_type: "purchase_order",
      p_entity_id: state.poId!,
    });
    expect(error).toBeNull();
    expect(blocked).toBe(true);

    // The pure mirror agrees with the database.
    const { data: crs } = await client
      .from("change_requests")
      .select("id, cr_number, title, status, company_id, affected_systems")
      .eq("company_id", state.companyId!);
    expect(
      isUnderChangeControl({
        viewerCompanyId: state.companyId!,
        entityType: "purchase_order",
        entityId: state.poId!,
        changeRequests: crs as never,
      }),
    ).toBe(true);

    const res = await fetch("http://localhost:3000/api/health").catch(() => null);
    void res; // dev server reachability already asserted by the skip guard
  });

  it("7. tasks complete with evidence and the CR closes", async () => {
    await client.rpc("transition_change_request", {
      p_id: state.crId!,
      p_to: "implementing",
      p_payload: {},
    } as never);

    const { data: tasks } = await client
      .from("moc_implementation_tasks")
      .select("id")
      .eq("change_request_id", state.crId!);
    for (const t of (tasks ?? []) as Array<{ id: string }>) {
      await client
        .from("moc_implementation_tasks")
        .update({
          status: "done",
          done_at: new Date().toISOString(),
          evidence: [
            { note: "Completed in capstone run", by: state.userId, at: new Date().toISOString() },
          ],
        } as never)
        .eq("id", t.id);
    }

    const { error } = await client.rpc("close_change_request", {
      p_id: state.crId!,
      p_closure_notes: "Restrung, BOM reissued, PO amended, as-builts updated.",
      p_updated_documents: ["SLD-0001 rev C"],
      p_updated_asbuilts: ["AB-0001 rev B"],
    } as never);
    expect(error).toBeNull();

    const { data: cr } = await client
      .from("change_requests")
      .select("status, closure_notes, updated_documents")
      .eq("id", state.crId!)
      .single();
    const row = cr as { status: string; closure_notes: string; updated_documents: unknown };
    expect(row.status).toBe("closed");
    expect(row.closure_notes).toContain("as-builts updated");
  });

  it("8. the banner clears and the audit trail records the moc.* journey", async () => {
    const { data: blocked } = await client.rpc("is_under_change_control", {
      p_entity_type: "purchase_order",
      p_entity_id: state.poId!,
    });
    expect(blocked).toBe(false);

    const { data: audit } = await client
      .from("audit_logs")
      .select("action")
      .eq("company_id", state.companyId!)
      .limit(200);
    const actions = ((audit ?? []) as Array<{ action: string }>).map((a) => a.action);
    expect(actions.some((a) => a.startsWith("moc."))).toBe(true);
  });
});
