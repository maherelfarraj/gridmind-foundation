// P-146 — SLD governance server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { cadAudit, cadHttpError, loadCadDrawing } from "@/lib/sld-cad.server";
import {
  SLD_APPROVAL_ENTITY,
  SLD_APPROVAL_RULE_KEY,
  isEngineeringAdmin,
  issueForConstruction,
  loadGovernance,
  openReviewRound,
  toTransitionContext,
} from "@/lib/sld-status.server";
import { availableTransitions, checkTransition, type SldStatus } from "@/lib/sld/status-machine";

const drawingInput = z.object({ drawingId: z.string().uuid() });

const transitionInput = z.object({
  drawingId: z.string().uuid(),
  target: z.enum(["draft", "under_review", "approved", "ifc", "as_built", "superseded"]),
  comment: z.string().trim().max(1000).default(""),
  metadata: z
    .object({ replacement_drawing_id: z.string().uuid().optional() })
    .partial()
    .default({}),
});

/** Governance snapshot: status, guards, approval progress and review rounds. */
export const getSldGovernance = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    const snap = await loadGovernance(context, drawing);
    const engAdmin = await isEngineeringAdmin(context, drawing.company_id);
    const ctx = toTransitionContext(snap, { isEngineeringAdmin: engAdmin, hasReplacement: true });

    const approverIds = (snap.approval?.steps ?? []).map((s) => s.approver_id);
    const names = new Map<string, string>();
    if (approverIds.length > 0) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", approverIds);
      for (const p of (profiles ?? []) as any[]) names.set(p.id, p.full_name ?? "");
    }

    return {
      drawing: {
        id: drawing.id,
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        title: drawing.title,
        status: drawing.status as SldStatus,
        locked: drawing.locked,
      },
      revision: { id: snap.revisionId, code: snap.revisionCode },
      guards: {
        objectCount: snap.objectCount,
        hasValidation: snap.hasValidation,
        errorCount: snap.errorCount,
        warningCount: snap.warningCount,
        validationRanAt: snap.validationRanAt,
        openSignoffs: snap.openSignoffs,
      },
      isEngineeringAdmin: engAdmin,
      rounds: snap.rounds,
      approval: snap.approval
        ? {
            ...snap.approval,
            rule_key: SLD_APPROVAL_RULE_KEY,
            steps: snap.approval.steps.map((s) => ({
              ...s,
              approver_name: names.get(s.approver_id) ?? null,
            })),
          }
        : null,
      transitions: availableTransitions(ctx),
    };
  });

/**
 * The single authority for SLD status changes. The P-111 approval engine
 * decides `approved`; the frontend only requests transitions.
 */
export const transitionSldStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => transitionInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    const from = drawing.status as SldStatus;
    const target = data.target as SldStatus;

    const snap = await loadGovernance(context, drawing);
    const engAdmin = await isEngineeringAdmin(context, drawing.company_id);
    const hasReplacement = Boolean(data.metadata?.replacement_drawing_id);
    const ctx = toTransitionContext(snap, { isEngineeringAdmin: engAdmin, hasReplacement });

    const audit = async (outcome: string, extra: Record<string, unknown>) =>
      cadAudit(context, "sld.status_transition", drawing.id, {
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        from,
        to: target,
        outcome,
        comment: data.comment || null,
        revision_id: snap.revisionId,
        ...extra,
      });

    let check = checkTransition(ctx, target);

    // under_review → approved: ask the P-111 engine first.
    if (target === "approved" && check.code === "approval_required") {
      const { data: instanceId, error } = await context.supabase.rpc("start_approval_instance", {
        p_rule_key: SLD_APPROVAL_RULE_KEY,
        p_entity_type: SLD_APPROVAL_ENTITY,
        p_entity_id: drawing.id,
        p_metadata: { revision_id: snap.revisionId, drawing_number: drawing.drawing_number },
      });
      if (error) {
        await audit("denied", { code: "approval_engine_error", detail: error.message });
        cadHttpError(409, "approval_engine_error", error.message);
      }
      if (instanceId) {
        await audit("pending_approval", { approval_instance_id: instanceId });
        cadHttpError(
          409,
          "approval_pending",
          "Approval requested — the drawing moves to approved once the workflow completes.",
        );
      }
      // No rule configured: engineering_admin may decide inline (P-111 note).
      check = checkTransition(
        { ...ctx, isEngineeringAdmin: engAdmin, approvalStatus: "none" },
        target,
      );
    }

    if (!check.allowed) {
      await audit("denied", {
        code: check.code,
        reason: check.reason,
        error_count: snap.errorCount,
        open_signoffs: snap.openSignoffs,
      });
      cadHttpError(check.code === "forbidden" ? 403 : 409, check.code ?? "denied", check.reason!);
    }

    const extra: Record<string, unknown> = {};

    if (target === "under_review") {
      const round = await openReviewRound(context, snap);
      extra.review_round_id = round.roundId;
      extra.review_round_no = round.roundNo;
    }

    if (target === "ifc") {
      const issued = await issueForConstruction(context, snap);
      Object.assign(extra, issued);
      const { error } = await context.supabase
        .from("sld_drawings")
        .update({
          status: "ifc",
          locked: true,
          drawing_register_id: issued.registerId,
        } as any)
        .eq("id", drawing.id);
      if (error) throw error;
    } else if (target === "as_built") {
      cadHttpError(
        409,
        "use_mark_as_built",
        "Create the as-built revision from the Revisions panel (markAsBuilt).",
      );
    } else {
      const patch: Record<string, unknown> = { status: target };
      if (target === "superseded") patch.locked = true;
      const { error } = await context.supabase
        .from("sld_drawings")
        .update(patch as any)
        .eq("id", drawing.id);
      if (error) throw error;
      if (target === "superseded") {
        extra.replacement_drawing_id = data.metadata?.replacement_drawing_id ?? null;
      }
    }

    if (snap.revisionId) {
      await context.supabase
        .from("sld_revisions")
        .update({ status: target } as any)
        .eq("id", snap.revisionId);
    }

    // Closing the loop: an approved drawing closes its open review rounds.
    if (target === "approved" || target === "ifc") {
      for (const round of snap.rounds.filter((r) => r.status === "open")) {
        await context.supabase
          .from("drawing_review_rounds")
          .update({ status: "closed" } as any)
          .eq("id", round.id);
      }
    }

    await audit("granted", extra);

    return { ok: true, from, to: target, ...extra };
  });
