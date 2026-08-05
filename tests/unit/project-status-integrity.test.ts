import { describe, expect, it } from "vitest";

import {
  PROJECT_COMPLETION_ROLE,
  PROJECT_STATUS_ERROR_DETAILS,
  getProjectLifecycleActionState,
  projectStatusErrorDetail,
} from "@/lib/project-status.rules";
import { reopenProjectInput } from "@/lib/project-status.schemas";
import { mapProjectStatusRpcError } from "@/lib/project-status.server";

function captureMappedError(message: string, code = "P0001") {
  try {
    mapProjectStatusRpcError({ code, message });
  } catch (error) {
    return error as Error & { statusCode?: number; body?: string };
  }
  throw new Error("expected mapProjectStatusRpcError to throw");
}

describe("project status integrity errors", () => {
  it("uses project_admin as the final handover approval role", () => {
    expect(PROJECT_COMPLETION_ROLE).toBe("project_admin");
  });

  it("enables completion only for a project admin after final handover approval", () => {
    expect(
      getProjectLifecycleActionState({
        roles: ["project_admin"],
        projectStatus: "active",
        projectPhase: "handover",
        handoverGateStatus: "approved",
      }),
    ).toMatchObject({ canComplete: true, canReopen: false, completionBlocker: null });

    expect(
      getProjectLifecycleActionState({
        roles: ["company_admin"],
        projectStatus: "active",
        projectPhase: "handover",
        handoverGateStatus: "approved",
      }),
    ).toMatchObject({
      canComplete: false,
      completionBlocker: "project_admin_required",
    });
  });

  it("keeps completion blocked until the handover phase and gate are ready", () => {
    expect(
      getProjectLifecycleActionState({
        roles: ["project_admin"],
        projectStatus: "active",
        projectPhase: "cod",
        handoverGateStatus: "approved",
      }).completionBlocker,
    ).toBe("handover_phase_required");

    expect(
      getProjectLifecycleActionState({
        roles: ["project_admin"],
        projectStatus: "active",
        projectPhase: "handover",
        handoverGateStatus: "in_review",
      }).completionBlocker,
    ).toBe("handover_gate_approval_required");
  });

  it("allows only company admins to reopen a completed project", () => {
    expect(
      getProjectLifecycleActionState({
        roles: ["company_admin"],
        projectStatus: "completed",
        projectPhase: "handover",
        handoverGateStatus: "approved",
      }),
    ).toMatchObject({
      canComplete: false,
      canReopen: true,
      completionBlocker: "already_completed",
    });
  });

  it("requires and trims the audited reopen reason", () => {
    const input = reopenProjectInput.parse({
      projectId: "00000000-0000-4000-8000-000000000001",
      reason: "  Closeout dossier correction  ",
    });
    expect(input.reason).toBe("Closeout dossier correction");
    expect(() =>
      reopenProjectInput.parse({
        projectId: "00000000-0000-4000-8000-000000000001",
        reason: "   ",
      }),
    ).toThrow();
  });

  it("maps completion authorization to a typed 403", () => {
    const error = captureMappedError("PROJECT_ADMIN_REQUIRED", "42501");
    expect(error.statusCode).toBe(403);
    expect(JSON.parse(error.body ?? "{}")).toEqual({
      error: "PROJECT_ADMIN_REQUIRED",
      message: PROJECT_STATUS_ERROR_DETAILS.PROJECT_ADMIN_REQUIRED.message,
    });
  });

  it("maps invalid lifecycle transitions to typed 409 responses", () => {
    for (const code of [
      "PROJECT_HANDOVER_REQUIRED",
      "PROJECT_HANDOVER_GATE_REQUIRED",
      "PROJECT_ADMIN_APPROVER_REQUIRED",
      "PROJECT_NOT_COMPLETED",
      "PROJECT_STATUS_TRANSITION_REQUIRED",
      "HANDOVER_GATE_DECISION_REQUIRED",
    ] as const) {
      const detail = projectStatusErrorDetail({ message: `rpc failed: ${code}` });
      expect(detail).toMatchObject({ code, status: 409 });
    }
  });

  it("requires a reopen reason with a typed 400", () => {
    const error = captureMappedError("PROJECT_REOPEN_REASON_REQUIRED", "23514");
    expect(error.statusCode).toBe(400);
    expect(JSON.parse(error.body ?? "{}").error).toBe("PROJECT_REOPEN_REASON_REQUIRED");
  });

  it("does not hide unknown backend failures", () => {
    const error = captureMappedError("connection reset", "08006");
    expect(error.message).toBe("connection reset");
    expect(error.statusCode).toBeUndefined();
  });
});
