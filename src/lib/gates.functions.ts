// P-040 — Phase gate engine: checklist toggling, transition requests,
// approve/reject, history reads. All executed under the caller's Supabase
// context, so RLS enforces tenancy. Audit rows use the existing
// write_audit_log RPC.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-attacher";

const PHASE_ORDER = ["development", "ntp", "cod", "handover"] as const;
type Phase = (typeof PHASE_ORDER)[number];

function httpError(status: number, code: string): never {
  throw Object.assign(new Error(code), {
    statusCode: status,
    body: JSON.stringify({ error: code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function assertGateAdmin(context: any) {
  const [{ data: isCoAdmin }, { data: isProjAdmin }] = await Promise.all([
    context.supabase.rpc("has_company_role", { p_role: "company_admin" }),
    context.supabase.rpc("has_company_role", { p_role: "project_admin" }),
  ]);
  if (!isCoAdmin && !isProjAdmin) httpError(403, "forbidden");
}

// ---------------------------------------------------------------------------
// getGateHistory
// ---------------------------------------------------------------------------
const historyInput = z.object({ project_id: z.string().uuid() });

export type GateHistoryEntry = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  metadata: Record<string, any>;
  created_at: string;
};

export const getGateHistory = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => historyInput.parse(input))
  .handler(async ({ data, context }): Promise<GateHistoryEntry[]> => {
    requireSupabaseAuth(context);

    const { data: rows, error } = await context.supabase
      .from("audit_logs")
      .select("id, action, actor_id, metadata, created_at")
      .eq("entity", "project_phase_gates")
      .filter("metadata->>project_id", "eq", data.project_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const actorIds = Array.from(
      new Set(
        (rows ?? [])
          .map((r: any) => r.actor_id)
          .filter((v: string | null): v is string => !!v),
      ),
    );
    let actorMap: Record<string, { full_name: string | null; email: string | null }> = {};
    if (actorIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name, email")
        .in("id", actorIds);
      for (const p of (profs ?? []) as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
      }>) {
        actorMap[p.id] = { full_name: p.full_name, email: p.email };
      }
    }

    return (rows ?? []).map((r: any) => ({
      id: r.id,
      action: r.action,
      actor_id: r.actor_id,
      actor_name: r.actor_id ? actorMap[r.actor_id]?.full_name ?? null : null,
      actor_email: r.actor_id ? actorMap[r.actor_id]?.email ?? null : null,
      metadata: r.metadata ?? {},
      created_at: r.created_at,
    }));
  });

// ---------------------------------------------------------------------------
// toggleGateChecklistItem
// ---------------------------------------------------------------------------
const toggleInput = z.object({
  gate_id: z.string().uuid(),
  key: z.string().min(1),
  done: z.boolean(),
});

export const toggleGateChecklistItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => toggleInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertGateAdmin(context);

    const { data: gate, error: gErr } = await context.supabase
      .from("project_phase_gates")
      .select("id, project_id, company_id, phase, status, checklist")
      .eq("id", data.gate_id)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!gate) httpError(404, "gate_not_found");
    if (gate.status !== "open" && gate.status !== "in_review") {
      httpError(409, "gate_locked");
    }

    const items: any[] = Array.isArray(gate.checklist) ? gate.checklist : [];
    let found = false;
    const nowIso = new Date().toISOString();
    const nextList = items.map((it: any) => {
      if (String(it?.key) !== data.key) return it;
      found = true;
      return {
        key: it.key,
        label: it.label,
        required: it.required !== false,
        done: data.done,
        done_by: data.done ? context.user.id : null,
        done_at: data.done ? nowIso : null,
      };
    });
    if (!found) httpError(404, "checklist_item_not_found");

    const { error: upErr } = await context.supabase
      .from("project_phase_gates")
      .update({ checklist: nextList })
      .eq("id", gate.id);
    if (upErr) throw upErr;

    const { error: auErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "gate.checklist_toggled",
      p_entity: "project_phase_gates",
      p_entity_id: gate.id,
      p_metadata: {
        project_id: gate.project_id,
        phase: gate.phase,
        key: data.key,
        done: data.done,
      },
    });
    if (auErr) throw auErr;

    return { ok: true };
  });

// ---------------------------------------------------------------------------
// requestGateTransition
// ---------------------------------------------------------------------------
const requestInput = z.object({ gate_id: z.string().uuid() });

export const requestGateTransition = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => requestInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertGateAdmin(context);

    const { data: gate, error: gErr } = await context.supabase
      .from("project_phase_gates")
      .select("id, project_id, company_id, phase, status, checklist")
      .eq("id", data.gate_id)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!gate) httpError(404, "gate_not_found");
    if (gate.status !== "open") httpError(409, "gate_not_open");

    const items: any[] = Array.isArray(gate.checklist) ? gate.checklist : [];
    for (const it of items) {
      if (it?.required !== false && !it?.done) httpError(409, "checklist_incomplete");
    }

    const { data: inst, error: iErr } = await context.supabase
      .from("approval_instances")
      .insert({
        company_id: gate.company_id,
        entity: "project_phase_gate",
        entity_id: gate.id,
        requested_by: context.user.id,
        metadata: { project_id: gate.project_id, phase: gate.phase },
      })
      .select("id")
      .single();
    if (iErr) throw iErr;

    const { data: admins, error: aErr } = await context.supabase
      .from("user_roles")
      .select("user_id")
      .eq("company_id", gate.company_id)
      .eq("role", "company_admin");
    if (aErr) throw aErr;

    const approverIds = Array.from(
      new Set((admins ?? []).map((r: any) => r.user_id as string)),
    );
    if (approverIds.length === 0) httpError(409, "no_approvers");

    const { error: apErr } = await context.supabase.from("approvals").insert(
      approverIds.map((uid) => ({
        company_id: gate.company_id,
        instance_id: inst.id,
        approver_id: uid,
      })),
    );
    if (apErr) throw apErr;

    const { error: upErr } = await context.supabase
      .from("project_phase_gates")
      .update({ status: "in_review", approval_instance_id: inst.id })
      .eq("id", gate.id);
    if (upErr) throw upErr;

    const { error: auErr } = await context.supabase.rpc("write_audit_log", {
      p_action: "gate.transition_requested",
      p_entity: "project_phase_gates",
      p_entity_id: gate.id,
      p_metadata: {
        project_id: gate.project_id,
        phase: gate.phase,
        approval_instance_id: inst.id,
      },
    });
    if (auErr) throw auErr;

    return { ok: true, approval_instance_id: inst.id };
  });

// ---------------------------------------------------------------------------
// decideGateTransition
// ---------------------------------------------------------------------------
const decideInput = z.object({
  approval_id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().max(2000).optional(),
});

export const decideGateTransition = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => decideInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);

    const { data: approval, error: apErr } = await context.supabase
      .from("approvals")
      .select("id, instance_id, approver_id, status, company_id")
      .eq("id", data.approval_id)
      .maybeSingle();
    if (apErr) throw apErr;
    if (!approval) httpError(404, "approval_not_found");
    if (approval.approver_id !== context.user.id) httpError(403, "not_your_approval");
    if (approval.status !== "pending") httpError(409, "already_decided");

    const { data: instance, error: iErr } = await context.supabase
      .from("approval_instances")
      .select("id, entity_id, status, metadata")
      .eq("id", approval.instance_id)
      .maybeSingle();
    if (iErr) throw iErr;
    if (!instance) httpError(404, "instance_not_found");
    if (instance.status !== "pending") httpError(409, "instance_decided");

    const gateId = instance.entity_id as string;
    const { data: gate, error: gErr } = await context.supabase
      .from("project_phase_gates")
      .select("id, project_id, company_id, phase, status, sort_order")
      .eq("id", gateId)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!gate) httpError(404, "gate_not_found");

    const nowIso = new Date().toISOString();

    // Record the approver's decision.
    const { error: updApErr } = await context.supabase
      .from("approvals")
      .update({
        status: data.decision === "approve" ? "approved" : "rejected",
        comment: data.comment ?? null,
        decided_at: nowIso,
      })
      .eq("id", approval.id);
    if (updApErr) throw updApErr;

    if (data.decision === "approve") {
      // Single-approver model until P-111.
      const { error: instErr } = await context.supabase
        .from("approval_instances")
        .update({
          status: "approved",
          decided_by: context.user.id,
          decided_at: nowIso,
        })
        .eq("id", instance.id);
      if (instErr) throw instErr;

      const { error: gUpErr } = await context.supabase
        .from("project_phase_gates")
        .update({
          status: "approved",
          approved_by: context.user.id,
          approved_at: nowIso,
        })
        .eq("id", gate.id);
      if (gUpErr) throw gUpErr;

      // Advance project phase.
      const idx = PHASE_ORDER.indexOf(gate.phase as Phase);
      const nextPhase = idx >= 0 && idx < PHASE_ORDER.length - 1
        ? PHASE_ORDER[idx + 1]
        : null;
      const projUpdate: { phase?: Phase; status?: string } = {};
      if (nextPhase) projUpdate.phase = nextPhase;
      if (gate.phase === "handover") projUpdate.status = "completed";
      if (Object.keys(projUpdate).length > 0) {
        const { error: pErr } = await context.supabase
          .from("projects")
          .update(projUpdate as any)
          .eq("id", gate.project_id);
        if (pErr) throw pErr;
      }


      // Open the next gate by sort order.
      const { data: nextGate } = await context.supabase
        .from("project_phase_gates")
        .select("id")
        .eq("project_id", gate.project_id)
        .eq("sort_order", gate.sort_order + 1)
        .maybeSingle();
      if (nextGate?.id) {
        await context.supabase
          .from("project_phase_gates")
          .update({ status: "open" })
          .eq("id", nextGate.id);
      }

      const { error: auErr } = await context.supabase.rpc("write_audit_log", {
        p_action: "gate.transition_approved",
        p_entity: "project_phase_gates",
        p_entity_id: gate.id,
        p_metadata: {
          project_id: gate.project_id,
          phase: gate.phase,
          next_phase: nextPhase,
          approval_instance_id: instance.id,
          comment: data.comment ?? null,
        },
      });
      if (auErr) throw auErr;
    } else {
      const { error: instErr } = await context.supabase
        .from("approval_instances")
        .update({
          status: "rejected",
          decided_by: context.user.id,
          decided_at: nowIso,
        })
        .eq("id", instance.id);
      if (instErr) throw instErr;

      const { error: gUpErr } = await context.supabase
        .from("project_phase_gates")
        .update({ status: "open", approval_instance_id: null })
        .eq("id", gate.id);
      if (gUpErr) throw gUpErr;

      const { error: auErr } = await context.supabase.rpc("write_audit_log", {
        p_action: "gate.transition_rejected",
        p_entity: "project_phase_gates",
        p_entity_id: gate.id,
        p_metadata: {
          project_id: gate.project_id,
          phase: gate.phase,
          approval_instance_id: instance.id,
          comment: data.comment ?? null,
        },
      });
      if (auErr) throw auErr;
    }

    return { ok: true };
  });
