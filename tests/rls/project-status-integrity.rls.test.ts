// Project completion integrity: governed completion, atomic handover approval,
// direct-write guard, tenant isolation, and separately authorized reopening.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { deleteFixtureUsers, purgeFixtureTenants } from "../helpers/fixture-teardown";
import {
  attachProfile,
  createTenant,
  createUser,
  isSupabaseUp,
  serviceClient,
} from "../portfolio/fixtures";

const up = await isSupabaseUp();
const d = up ? describe : describe.skip;

type UserFixture = Awaited<ReturnType<typeof createUser>>;

type ProjectFixture = {
  projectId: string;
  gateId: string;
};

async function createHandoverProject(
  svc: SupabaseClient<Database>,
  companyId: string,
  ownerId: string,
  label: string,
  gateStatus: "open" | "in_review" | "approved",
): Promise<ProjectFixture> {
  const code = `PSI-${label}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const { data: project, error: projectError } = await svc
    .from("projects")
    .insert({
      company_id: companyId,
      name: `Project status integrity ${label}`,
      code,
      archetype: "utility_pv",
      phase: "handover",
      status: "active",
      created_by: ownerId,
    })
    .select("id")
    .single();
  if (projectError || !project) throw projectError ?? new Error("project fixture failed");

  const { data: gate, error: gateError } = await svc
    .from("project_phase_gates")
    .insert({
      company_id: companyId,
      project_id: project.id,
      phase: "handover",
      name: "Final handover",
      sort_order: 4,
      status: gateStatus,
      checklist: [{ key: "turnover", label: "Turnover complete", required: true, done: true }],
      approved_by: gateStatus === "approved" ? ownerId : null,
      approved_at: gateStatus === "approved" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  if (gateError || !gate) throw gateError ?? new Error("gate fixture failed");

  return { projectId: project.id, gateId: gate.id };
}

async function createPendingHandoverApproval(
  svc: SupabaseClient<Database>,
  companyId: string,
  ownerId: string,
  approverId: string,
  label: string,
): Promise<ProjectFixture & { approvalId: string; instanceId: string }> {
  const fixture = await createHandoverProject(svc, companyId, ownerId, label, "open");
  const { data: instance, error: instanceError } = await svc
    .from("approval_instances")
    .insert({
      company_id: companyId,
      entity: "project_phase_gate",
      entity_type: "project_phase_gate",
      entity_id: fixture.gateId,
      status: "pending",
      requested_by: ownerId,
      metadata: { project_id: fixture.projectId, phase: "handover" },
    } as never)
    .select("id")
    .single();
  if (instanceError || !instance) throw instanceError ?? new Error("instance fixture failed");

  const { error: gateError } = await svc
    .from("project_phase_gates")
    .update({ status: "in_review", approval_instance_id: instance.id })
    .eq("id", fixture.gateId);
  if (gateError) throw gateError;

  const { data: approval, error: approvalError } = await svc
    .from("approvals")
    .insert({
      company_id: companyId,
      instance_id: instance.id,
      approver_id: approverId,
      status: "pending",
    })
    .select("id")
    .single();
  if (approvalError || !approval) throw approvalError ?? new Error("approval fixture failed");

  return { ...fixture, approvalId: approval.id, instanceId: instance.id };
}

async function rpc<T>(
  client: SupabaseClient<Database>,
  name: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const { data, error } = await client.rpc(name as never, args as never);
  return {
    data: data as T | null,
    error: error ? { message: error.message } : null,
  };
}

d("project status completion integrity", () => {
  const svc = serviceClient();
  const companyIds: string[] = [];
  const userIds: string[] = [];

  let companyA = "";
  let companyB = "";
  let companyAdminA: UserFixture;
  let projectAdminA: UserFixture;
  let projectAdminA2: UserFixture;
  let lateProjectAdminA: UserFixture;
  let companyAdminB: UserFixture;
  let ready: ProjectFixture;
  let notReady: ProjectFixture;
  let crossTenant: ProjectFixture;
  let atomic: ProjectFixture & { approvalId: string; instanceId: string };
  let genericBlocked: ProjectFixture & { approvalId: string; instanceId: string };
  let rejected: ProjectFixture & { approvalId: string; instanceId: string };
  let legacyCompanyApproval: ProjectFixture & { approvalId: string; instanceId: string };

  beforeAll(async () => {
    const [tenantA, tenantB] = await Promise.all([
      createTenant(svc, "project-status-a"),
      createTenant(svc, "project-status-b"),
    ]);
    companyA = tenantA.companyId;
    companyB = tenantB.companyId;
    companyIds.push(companyA, companyB);

    [companyAdminA, projectAdminA, projectAdminA2, lateProjectAdminA, companyAdminB] =
      await Promise.all([
        createUser(svc, "project-status-company-admin-a"),
        createUser(svc, "project-status-project-admin-a"),
        createUser(svc, "project-status-project-admin-a2"),
        createUser(svc, "project-status-late-project-admin-a"),
        createUser(svc, "project-status-company-admin-b"),
      ]);
    userIds.push(
      companyAdminA.userId,
      projectAdminA.userId,
      projectAdminA2.userId,
      lateProjectAdminA.userId,
      companyAdminB.userId,
    );

    await Promise.all([
      attachProfile(svc, companyAdminA.userId, companyAdminA.email, companyA, "company_admin"),
      attachProfile(svc, projectAdminA.userId, projectAdminA.email, companyA, "project_admin"),
      attachProfile(svc, projectAdminA2.userId, projectAdminA2.email, companyA, "project_admin"),
      attachProfile(svc, lateProjectAdminA.userId, lateProjectAdminA.email, companyA, "engineer"),
      attachProfile(svc, companyAdminB.userId, companyAdminB.email, companyB, "company_admin"),
    ]);

    ready = await createHandoverProject(svc, companyA, companyAdminA.userId, "ready", "approved");
    notReady = await createHandoverProject(
      svc,
      companyA,
      companyAdminA.userId,
      "not-ready",
      "open",
    );
    crossTenant = await createHandoverProject(
      svc,
      companyB,
      companyAdminB.userId,
      "cross-tenant",
      "approved",
    );
    atomic = await createPendingHandoverApproval(
      svc,
      companyA,
      companyAdminA.userId,
      projectAdminA.userId,
      "atomic",
    );
    genericBlocked = await createPendingHandoverApproval(
      svc,
      companyA,
      companyAdminA.userId,
      projectAdminA.userId,
      "generic-blocked",
    );
    rejected = await createPendingHandoverApproval(
      svc,
      companyA,
      companyAdminA.userId,
      projectAdminA.userId,
      "rejected",
    );
    legacyCompanyApproval = await createPendingHandoverApproval(
      svc,
      companyA,
      companyAdminA.userId,
      companyAdminA.userId,
      "legacy-company-approver",
    );

    const { error: siblingApprovalError } = await svc.from("approvals").insert({
      company_id: companyA,
      instance_id: atomic.instanceId,
      approver_id: projectAdminA2.userId,
      status: "pending",
    });
    if (siblingApprovalError) throw siblingApprovalError;

    const { error: rejectedSiblingError } = await svc.from("approvals").insert({
      company_id: companyA,
      instance_id: rejected.instanceId,
      approver_id: projectAdminA2.userId,
      status: "pending",
    });
    if (rejectedSiblingError) throw rejectedSiblingError;

  }, 180_000);

  afterAll(async () => {
    await purgeFixtureTenants(svc, companyIds);
    await deleteFixtureUsers(svc, userIds);
  }, 180_000);

  it("blocks direct authenticated writes into completed", async () => {
    const directInsert = await projectAdminA.client.from("projects").insert({
      company_id: companyA,
      name: "Direct completed project",
      code: `PSI-DIRECT-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
      archetype: "utility_pv",
      phase: "handover",
      status: "completed",
      created_by: projectAdminA.userId,
    });
    expect(directInsert.error?.message).toContain("PROJECT_STATUS_TRANSITION_REQUIRED");

    const { error } = await projectAdminA.client
      .from("projects")
      .update({ status: "completed" })
      .eq("id", ready.projectId);
    expect(error).not.toBeNull();
    expect(error?.message).toContain("PROJECT_STATUS_TRANSITION_REQUIRED");
  });

  it("blocks direct approval of the final handover gate", async () => {
    const { error } = await projectAdminA.client
      .from("project_phase_gates")
      .update({ status: "approved" })
      .eq("id", notReady.gateId);
    expect(error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");
  });

  it("blocks direct settlement or reset of a handover approval workflow", async () => {
    const approvalWrite = await projectAdminA.client
      .from("approvals")
      .update({ status: "approved" })
      .eq("id", genericBlocked.approvalId);
    expect(approvalWrite.error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");

    const instanceWrite = await projectAdminA.client
      .from("approval_instances")
      .update({ status: "approved" })
      .eq("id", genericBlocked.instanceId);
    expect(instanceWrite.error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");

    const gateReset = await projectAdminA.client
      .from("project_phase_gates")
      .update({ status: "open", approval_instance_id: null })
      .eq("id", genericBlocked.gateId);
    expect(gateReset.error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");

    const approvalReassignment = await companyAdminA.client
      .from("approvals")
      .update({ approver_id: companyAdminA.userId })
      .eq("id", genericBlocked.approvalId);
    expect(approvalReassignment.error?.message).toContain(
      "HANDOVER_GATE_DECISION_REQUIRED",
    );

    const instanceReassignment = await companyAdminA.client
      .from("approval_instances")
      .update({ entity_type: "legacy" })
      .eq("id", genericBlocked.instanceId);
    expect(instanceReassignment.error?.message).toContain(
      "HANDOVER_GATE_DECISION_REQUIRED",
    );

    const phaseRewrite = await projectAdminA.client
      .from("project_phase_gates")
      .update({ phase: "cod" })
      .eq("id", genericBlocked.gateId);
    expect(phaseRewrite.error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");
  });

  it("rejects the generic approval RPC for final handover without partial writes", async () => {
    const result = await rpc<void>(projectAdminA.client, "decide_approval", {
      p_approval_id: genericBlocked.approvalId,
      p_decision: "approved",
      p_comment: "Attempted generic approval",
    });
    expect(result.error?.message).toContain("HANDOVER_GATE_DECISION_REQUIRED");

    const [{ data: project }, { data: gate }, { data: approval }, { data: instance }] =
      await Promise.all([
        svc.from("projects").select("status").eq("id", genericBlocked.projectId).single(),
        svc
          .from("project_phase_gates")
          .select("status")
          .eq("id", genericBlocked.gateId)
          .single(),
        svc.from("approvals").select("status").eq("id", genericBlocked.approvalId).single(),
        svc
          .from("approval_instances")
          .select("status")
          .eq("id", genericBlocked.instanceId)
          .single(),
      ]);
    expect(project?.status).toBe("active");
    expect(gate?.status).toBe("in_review");
    expect(approval?.status).toBe("pending");
    expect(instance?.status).toBe("pending");
  });

  it("requires the company-scoped project_admin role", async () => {
    const companyAdminAttempt = await rpc<string>(companyAdminA.client, "project_complete", {
      p_project_id: ready.projectId,
    });
    expect(companyAdminAttempt.error?.message).toContain("PROJECT_ADMIN_REQUIRED");

    const crossTenantAttempt = await rpc<string>(projectAdminA.client, "project_complete", {
      p_project_id: crossTenant.projectId,
    });
    expect(crossTenantAttempt.error?.message).toContain("PROJECT_NOT_FOUND");
  });

  it("requires an approved handover gate", async () => {
    const result = await rpc<string>(projectAdminA.client, "project_complete", {
      p_project_id: notReady.projectId,
    });
    expect(result.error?.message).toContain("PROJECT_HANDOVER_GATE_REQUIRED");
  });

  it("completes through the governed RPC and audits the transition", async () => {
    const result = await rpc<string>(projectAdminA.client, "project_complete", {
      p_project_id: ready.projectId,
    });
    expect(result.error).toBeNull();
    expect(result.data).toBe("completed");

    const { data: project } = await projectAdminA.client
      .from("projects")
      .select("status")
      .eq("id", ready.projectId)
      .single();
    expect(project?.status).toBe("completed");

    const { data: audit } = await svc
      .from("audit_logs")
      .select("actor_id, action")
      .eq("entity_id", ready.projectId)
      .eq("action", "project.completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(audit?.actor_id).toBe(projectAdminA.userId);
  });

  it("blocks direct reopening and requires the separate company-admin operation", async () => {
    const direct = await projectAdminA.client
      .from("projects")
      .update({ status: "active" })
      .eq("id", ready.projectId);
    expect(direct.error?.message).toContain("PROJECT_STATUS_TRANSITION_REQUIRED");

    const projectAdminAttempt = await rpc<string>(projectAdminA.client, "project_reopen", {
      p_project_id: ready.projectId,
      p_reason: "Incorrect closeout",
    });
    expect(projectAdminAttempt.error?.message).toContain("COMPANY_ADMIN_REQUIRED");

    const noReason = await rpc<string>(companyAdminA.client, "project_reopen", {
      p_project_id: ready.projectId,
      p_reason: " ",
    });
    expect(noReason.error?.message).toContain("PROJECT_REOPEN_REASON_REQUIRED");

    const reopened = await rpc<string>(companyAdminA.client, "project_reopen", {
      p_project_id: ready.projectId,
      p_reason: "Closeout dossier requires correction",
    });
    expect(reopened.error).toBeNull();
    expect(reopened.data).toBe("active");
  });

  it("requires every assigned project admin before atomic completion", async () => {
    const firstResult = await rpc<Record<string, unknown>>(
      projectAdminA.client,
      "decide_handover_gate",
      {
        p_approval_id: atomic.approvalId,
        p_decision: "approve",
        p_comment: "Final handover accepted",
      },
    );
    expect(firstResult.error).toBeNull();

    const [{ data: firstProject }, { data: firstGate }, { data: firstInstance }] =
      await Promise.all([
        svc.from("projects").select("status").eq("id", atomic.projectId).single(),
        svc.from("project_phase_gates").select("status").eq("id", atomic.gateId).single(),
        svc
          .from("approval_instances")
          .select("status")
          .eq("id", atomic.instanceId)
          .single(),
      ]);
    expect(firstProject?.status).toBe("active");
    expect(firstGate?.status).toBe("in_review");
    expect(firstInstance?.status).toBe("in_progress");

    const { data: sibling } = await svc
      .from("approvals")
      .select("id, status")
      .eq("instance_id", atomic.instanceId)
      .eq("approver_id", projectAdminA2.userId)
      .single();
    expect(sibling?.status).toBe("pending");

    const finalResult = await rpc<Record<string, unknown>>(
      projectAdminA2.client,
      "decide_handover_gate",
      {
        p_approval_id: sibling!.id,
        p_decision: "approve",
        p_comment: "Final handover countersigned",
      },
    );
    expect(finalResult.error).toBeNull();

    const [
      { data: project },
      { data: gate },
      { data: approval },
      { data: siblingApproval },
      { data: instance },
    ] =
      await Promise.all([
        svc.from("projects").select("status").eq("id", atomic.projectId).single(),
        svc.from("project_phase_gates").select("status").eq("id", atomic.gateId).single(),
        svc.from("approvals").select("status").eq("id", atomic.approvalId).single(),
        svc
          .from("approvals")
          .select("status")
          .eq("instance_id", atomic.instanceId)
          .eq("approver_id", projectAdminA2.userId)
          .single(),
        svc
          .from("approval_instances")
          .select("status")
          .eq("id", atomic.instanceId)
          .single(),
      ]);
    expect(project?.status).toBe("completed");
    expect(gate?.status).toBe("approved");
    expect(approval?.status).toBe("approved");
    expect(siblingApproval?.status).toBe("approved");
    expect(instance?.status).toBe("approved");
  });

  it("rejects the final gate atomically and closes sibling approvals", async () => {
    const result = await rpc<Record<string, unknown>>(
      projectAdminA.client,
      "decide_handover_gate",
      {
        p_approval_id: rejected.approvalId,
        p_decision: "reject",
        p_comment: "Closeout evidence is incomplete",
      },
    );
    expect(result.error).toBeNull();

    const [
      { data: project },
      { data: gate },
      { data: approval },
      { data: siblingApproval },
      { data: instance },
    ] = await Promise.all([
      svc.from("projects").select("status").eq("id", rejected.projectId).single(),
      svc
        .from("project_phase_gates")
        .select("status, approval_instance_id")
        .eq("id", rejected.gateId)
        .single(),
      svc.from("approvals").select("status").eq("id", rejected.approvalId).single(),
      svc
        .from("approvals")
        .select("status")
        .eq("instance_id", rejected.instanceId)
        .eq("approver_id", projectAdminA2.userId)
        .single(),
      svc
        .from("approval_instances")
        .select("status")
        .eq("id", rejected.instanceId)
        .single(),
    ]);
    expect(project?.status).toBe("active");
    expect(gate?.status).toBe("open");
    expect(gate?.approval_instance_id).toBeNull();
    expect(approval?.status).toBe("rejected");
    expect(siblingApproval?.status).toBe("skipped");
    expect(instance?.status).toBe("rejected");
  });

  it("rejects legacy company-admin decisions and lets a project admin retire them", async () => {
    const result = await rpc<Record<string, unknown>>(
      companyAdminA.client,
      "decide_handover_gate",
      {
        p_approval_id: legacyCompanyApproval.approvalId,
        p_decision: "approve",
        p_comment: null,
      },
    );
    expect(result.error?.message).toContain("PROJECT_ADMIN_REQUIRED");

    const [{ data: project }, { data: gate }, { data: approval }] = await Promise.all([
      svc.from("projects").select("status").eq("id", legacyCompanyApproval.projectId).single(),
      svc
        .from("project_phase_gates")
        .select("status")
        .eq("id", legacyCompanyApproval.gateId)
        .single(),
      svc
        .from("approvals")
        .select("status")
        .eq("id", legacyCompanyApproval.approvalId)
        .single(),
    ]);
    expect(project?.status).toBe("active");
    expect(gate?.status).toBe("in_review");
    expect(approval?.status).toBe("pending");

    const { error: lateRoleError } = await svc.from("user_roles").insert({
      company_id: companyA,
      user_id: lateProjectAdminA.userId,
      role: "project_admin",
    });
    if (lateRoleError) throw lateRoleError;

    const { data: replacement, error: replacementError } = await svc
      .from("approvals")
      .select("id")
      .eq("instance_id", legacyCompanyApproval.instanceId)
      .eq("approver_id", lateProjectAdminA.userId)
      .single();
    if (replacementError || !replacement) {
      throw replacementError ?? new Error("project-admin replacement approval missing");
    }
    const replacementDecision = await rpc<Record<string, unknown>>(
      lateProjectAdminA.client,
      "decide_handover_gate",
      {
        p_approval_id: replacement.id,
        p_decision: "approve",
        p_comment: "Project-admin replacement approval",
      },
    );
    expect(replacementDecision.error).toBeNull();

    const [{ data: completed }, { data: retiredLegacy }] = await Promise.all([
      svc
        .from("projects")
        .select("status")
        .eq("id", legacyCompanyApproval.projectId)
        .single(),
      svc
        .from("approvals")
        .select("status")
        .eq("id", legacyCompanyApproval.approvalId)
        .single(),
    ]);
    expect(completed?.status).toBe("completed");
    expect(retiredLegacy?.status).toBe("skipped");
  });
});
