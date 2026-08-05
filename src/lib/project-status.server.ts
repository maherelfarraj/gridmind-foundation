// Server-only project lifecycle helpers. Database RPCs remain the source of
// truth for authorization and transition integrity.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  PROJECT_COMPLETION_ROLE,
  PROJECT_STATUS_ERROR_DETAILS,
  projectStatusErrorDetail,
} from "@/lib/project-status.rules";

export type ProjectStatusContext = {
  supabase: SupabaseClient<Database>;
};

export type ProjectStatusResult = {
  projectId: string;
  status: "active" | "completed";
};

export function projectStatusHttpError(status: number, code: string, message: string): never {
  throw Object.assign(new Error(message), {
    statusCode: status,
    body: JSON.stringify({ error: code, message }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export function mapProjectStatusRpcError(error: { code?: string; message?: string }): never {
  const detail = projectStatusErrorDetail(error);
  if (detail) projectStatusHttpError(detail.status, detail.code, detail.message);
  if (error.code === "42501") {
    projectStatusHttpError(403, "FORBIDDEN", "You do not have permission for this action.");
  }
  throw Object.assign(new Error(error.message || "PROJECT_STATUS_UPDATE_FAILED"), error);
}

export async function completeProjectStatus(
  context: ProjectStatusContext,
  projectId: string,
): Promise<ProjectStatusResult> {
  const { data, error } = await context.supabase.rpc(
    "project_complete" as never,
    { p_project_id: projectId } as never,
  );
  if (error) mapProjectStatusRpcError(error);
  return { projectId, status: String(data) as "completed" };
}

export async function reopenProjectStatus(
  context: ProjectStatusContext,
  projectId: string,
  reason: string,
): Promise<ProjectStatusResult> {
  const { data, error } = await context.supabase.rpc(
    "project_reopen" as never,
    { p_project_id: projectId, p_reason: reason } as never,
  );
  if (error) mapProjectStatusRpcError(error);
  return { projectId, status: String(data) as "active" };
}

export async function resolveGateApproverIds(
  context: ProjectStatusContext,
  companyId: string,
  phase: string,
): Promise<string[]> {
  const role = phase === "handover" ? PROJECT_COMPLETION_ROLE : "company_admin";
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", role);
  if (error) throw error;

  const approverIds = Array.from(
    new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id)),
  );
  if (approverIds.length > 0) return approverIds;

  if (phase === "handover") {
    const detail = PROJECT_STATUS_ERROR_DETAILS.PROJECT_ADMIN_APPROVER_REQUIRED;
    projectStatusHttpError(detail.status, "PROJECT_ADMIN_APPROVER_REQUIRED", detail.message);
  }
  projectStatusHttpError(409, "NO_APPROVERS", "Assign a company admin before requesting approval.");
}

export async function isHandoverGateApproval(
  context: ProjectStatusContext,
  approvalId: string,
): Promise<boolean> {
  const { data: approval, error: approvalError } = await context.supabase
    .from("approvals")
    .select("instance_id")
    .eq("id", approvalId)
    .maybeSingle();
  if (approvalError) throw approvalError;
  if (!approval) return false;

  const { data: instance, error: instanceError } = await context.supabase
    .from("approval_instances")
    .select("entity, entity_type, entity_id")
    .eq("id", approval.instance_id)
    .maybeSingle();
  if (instanceError) throw instanceError;
  if (!instance) return false;
  if (instance.entity !== "project_phase_gate" && instance.entity_type !== "project_phase_gate") {
    return false;
  }

  const { data: gate, error: gateError } = await context.supabase
    .from("project_phase_gates")
    .select("phase")
    .eq("id", instance.entity_id)
    .maybeSingle();
  if (gateError) throw gateError;
  return gate?.phase === "handover";
}

export async function decideHandoverGate(
  context: ProjectStatusContext,
  approvalId: string,
  decision: "approve" | "reject",
  comment?: string | null,
): Promise<void> {
  const { error } = await context.supabase.rpc(
    "decide_handover_gate" as never,
    {
      p_approval_id: approvalId,
      p_decision: decision,
      p_comment: comment ?? null,
    } as never,
  );
  if (error) mapProjectStatusRpcError(error);
}
