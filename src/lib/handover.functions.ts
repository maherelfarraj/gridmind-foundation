// P-099 — Handover ceremony server functions.
// Rules in handover.rules.ts, pure helpers in handover.server.ts.
import { createServerFn } from "@tanstack/react-start";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { requireSupabaseAuth as requireSupabaseAuthMiddleware } from "@/integrations/supabase/auth-middleware";
import {
  getHandoverBoardInput,
  signCccTransferInput,
  type HandoverPrereqKey,
} from "@/lib/handover.rules";
import {
  assembleHandoverHistory,
  autoCompleteHandoverChecklist,
  checkHandoverPrereqs,
} from "@/lib/handover.server";
import { resolveGateApproverIds } from "@/lib/project-status.server";

// ---------------------------------------------------------------------------
// helpers (mirrors commissioning-certificates.functions.ts)
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, metadata?: Record<string, unknown>): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code, ...(metadata ?? {}) }),
    headers: { "content-type": "application/json; charset=utf-8" },
    metadata,
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

const EXECUTE_ROLES = new Set(["construction_admin", "project_admin", "company_admin"]);
const READ_ROLES = new Set([
  ...EXECUTE_ROLES,
  "om_admin",
  "engineer",
  "client_viewer",
  "finance_admin",
]);

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// getHandoverBoard
// ---------------------------------------------------------------------------
export interface HandoverBoard {
  project: {
    id: string;
    name: string;
    code: string | null;
    phase: string;
    status: string;
  };
  company: { name: string };
  prereqs: {
    passes: Record<HandoverPrereqKey, boolean>;
    reasons: { key: HandoverPrereqKey; label: string }[];
  };
  cccCertificate: {
    id: string;
    certificate_number: string;
    status: string;
    effective_date: string | null;
    signatures: any[];
  } | null;
  handoverGate: {
    id: string;
    status: string;
    checklist: any[];
    approval_instance_id: string | null;
    approved_at: string | null;
  } | null;
  approvers: { pending: number; total: number } | null;
  history: Awaited<ReturnType<typeof assembleHandoverHistory>>;
  permissions: { canRead: boolean; canExecute: boolean };
}

export const getHandoverBoard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => getHandoverBoardInput.parse(raw))
  .handler(async ({ data, context }): Promise<HandoverBoard> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    const canRead = roles.some((r) => READ_ROLES.has(r));
    if (!canRead) httpError(403, "forbidden");
    const canExecute = roles.some((r) => EXECUTE_ROLES.has(r));

    const [{ data: proj }, { data: co }, prereqs, { data: ccc }, { data: gate }, history] =
      await Promise.all([
        context.supabase
          .from("projects")
          .select("id, name, code, phase, status, company_id")
          .eq("id", data.projectId)
          .maybeSingle(),
        context.supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
        checkHandoverPrereqs(context.supabase, companyId, data.projectId),
        context.supabase
          .from("commissioning_certificates")
          .select("id, certificate_number, status, effective_date, signatures")
          .eq("company_id", companyId)
          .eq("project_id", data.projectId)
          .eq("certificate_type", "ccc_transfer")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        context.supabase
          .from("project_phase_gates")
          .select("id, status, checklist, approval_instance_id, approved_at")
          .eq("company_id", companyId)
          .eq("project_id", data.projectId)
          .eq("phase", "handover")
          .maybeSingle(),
        assembleHandoverHistory(context.supabase, companyId, data.projectId),
      ]);

    if (!proj || (proj as any).company_id !== companyId) {
      httpError(404, "project_not_found");
    }

    let approvers: { pending: number; total: number } | null = null;
    if ((gate as any)?.approval_instance_id) {
      const { data: aps } = await context.supabase
        .from("approvals")
        .select("status")
        .eq("instance_id", (gate as any).approval_instance_id);
      const list = (aps ?? []) as { status: string }[];
      approvers = {
        pending: list.filter((a) => a.status === "pending").length,
        total: list.length,
      };
    }

    return {
      project: {
        id: (proj as any).id,
        name: (proj as any).name ?? "",
        code: (proj as any).code ?? null,
        phase: (proj as any).phase,
        status: (proj as any).status,
      },
      company: { name: (co as any)?.name ?? "" },
      prereqs: { passes: prereqs.passes, reasons: prereqs.reasons },
      cccCertificate: ccc
        ? {
            id: (ccc as any).id,
            certificate_number: (ccc as any).certificate_number,
            status: (ccc as any).status,
            effective_date: (ccc as any).effective_date,
            signatures: Array.isArray((ccc as any).signatures) ? (ccc as any).signatures : [],
          }
        : null,
      handoverGate: gate
        ? {
            id: (gate as any).id,
            status: (gate as any).status,
            checklist: Array.isArray((gate as any).checklist) ? (gate as any).checklist : [],
            approval_instance_id: (gate as any).approval_instance_id ?? null,
            approved_at: (gate as any).approved_at ?? null,
          }
        : null,
      approvers,
      history,
      permissions: { canRead, canExecute },
    };
  });

// ---------------------------------------------------------------------------
// signCccTransfer — after CCC certificate is signed on the certificates page,
// this endpoint re-validates the prerequisite gauntlet, auto-completes the
// Handover gate checklist, and routes the gate into `in_review`. The existing
// P-040 `decideGateTransition` then completes the project through the governed
// project-admin handover path on approval.
// ---------------------------------------------------------------------------
export interface SignCccResult {
  ok: true;
  gateId: string;
  approvalInstanceId: string;
}

export const signCccTransfer = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuthMiddleware])
  .inputValidator((raw: unknown) => signCccTransferInput.parse(raw))
  .handler(async ({ data, context }): Promise<SignCccResult> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!roles.some((r) => EXECUTE_ROLES.has(r))) httpError(403, "forbidden");

    // Project must belong to caller's company.
    const { data: proj } = await context.supabase
      .from("projects")
      .select("id, company_id, phase")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!proj || (proj as any).company_id !== companyId) {
      httpError(404, "project_not_found");
    }

    // Full prereq gauntlet — 409 with reasons array if anything fails.
    const prereqs = await checkHandoverPrereqs(context.supabase, companyId, data.projectId);
    if (prereqs.reasons.length > 0) {
      httpError(409, "handover_prereqs_failed", {
        reasons: prereqs.reasons,
      });
    }

    // Handover gate.
    const { data: gateRow, error: gErr } = await context.supabase
      .from("project_phase_gates")
      .select("id, project_id, company_id, phase, status, checklist, approval_instance_id")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .eq("phase", "handover")
      .maybeSingle();
    if (gErr) throw gErr;
    if (!gateRow) httpError(409, "handover_gate_missing");
    const gate = gateRow as any;

    if (gate.status === "approved") {
      httpError(409, "handover_already_approved");
    }
    if (gate.status === "in_review" && gate.approval_instance_id) {
      // Idempotent — already requested.
      return {
        ok: true,
        gateId: gate.id,
        approvalInstanceId: gate.approval_instance_id,
      };
    }

    // Resolve final-gate approvers before mutating the gate so a missing
    // project-admin assignment leaves the workflow untouched.
    const approverIds = await resolveGateApproverIds(context, companyId, "handover");

    const nowIso = new Date().toISOString();
    const nextChecklist = autoCompleteHandoverChecklist(gate.checklist, context.user!.id, nowIso);

    // Flip locked → open first (so the transition step is coherent), then
    // continue in-place to in_review.
    const { error: openErr } = await context.supabase
      .from("project_phase_gates")
      .update({ checklist: nextChecklist, status: "open" })
      .eq("id", gate.id);
    if (openErr) throw openErr;

    // Create approval instance + approvals (mirror requestGateTransition).
    const { data: inst, error: iErr } = await context.supabase
      .from("approval_instances")
      .insert({
        company_id: companyId,
        entity: "project_phase_gate",
        entity_type: "project_phase_gate",
        entity_id: gate.id,
        requested_by: context.user!.id,
        metadata: {
          project_id: gate.project_id,
          phase: "handover",
          trigger: "ccc_transfer",
        },
      })
      .select("id")
      .single();
    if (iErr) throw iErr;

    const { error: apErr } = await context.supabase.from("approvals").insert(
      approverIds.map((uid) => ({
        company_id: companyId,
        instance_id: (inst as any).id,
        approver_id: uid,
      })),
    );
    if (apErr) throw apErr;

    const { error: upErr } = await context.supabase
      .from("project_phase_gates")
      .update({
        status: "in_review",
        approval_instance_id: (inst as any).id,
      })
      .eq("id", gate.id);
    if (upErr) throw upErr;

    // Audit: CCC signed handover event + gate transition requested.
    const cccId = prereqs.cccCertificateId;
    if (cccId) {
      const { data: cccRow } = await context.supabase
        .from("commissioning_certificates")
        .select("effective_date, signatures")
        .eq("id", cccId)
        .maybeSingle();
      const sigs = Array.isArray((cccRow as any)?.signatures) ? (cccRow as any).signatures : [];
      await audit(context, "handover.ccc_signed", "commissioning_certificates", cccId, {
        project_id: data.projectId,
        effective_date: (cccRow as any)?.effective_date ?? null,
        parties: sigs.map((s: any) => s?.party).filter(Boolean),
      });
    }

    await audit(context, "gate.transition_requested", "project_phase_gates", gate.id, {
      project_id: data.projectId,
      phase: "handover",
      approval_instance_id: (inst as any).id,
      trigger: "ccc_transfer",
    });

    return {
      ok: true,
      gateId: gate.id,
      approvalInstanceId: (inst as any).id,
    };
  });
