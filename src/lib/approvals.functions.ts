// P-111 — Approval engine server functions.
// Thin RPC wrappers + company_admin-only CRUD for rules and chain steps.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  requireSupabaseAuth as requireSupabaseAuthMiddleware,
} from "@/integrations/supabase/auth-middleware";
import {
  approvalRuleInputSchema,
  cancelInstanceSchema,
  decideApprovalSchema,
  startApprovalSchema,
  toggleRuleSchema,
} from "@/lib/approvals.rules";
import { settleEntityForApproval } from "@/lib/approval-settle.server";
import { settlePoAfterDecision } from "@/lib/po-approval.server";
import { settleAfterDecision } from "@/lib/scada-actions.server";
import { decideHandoverGate, isHandoverGateApproval } from "@/lib/project-status.server";

function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function assertCompanyAdmin(context: AuthContext): Promise<void> {
  const { data, error } = await context.supabase.rpc("has_company_role", {
    p_role: "company_admin",
  });
  if (error) throw error;
  if (data !== true) httpError(403, "forbidden_role");
}

async function audit(
  context: AuthContext,
  action: string,
  entity: "approval_rules" | "approval_chain_steps",
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* audit failures never break primary op */
  }
}

// ---- Rules listing ---------------------------------------------------------
export interface ApprovalRuleRow {
  id: string;
  company_id: string;
  rule_key: string;
  name: string;
  description: string | null;
  entity_type: string;
  threshold_amount: number | null;
  threshold_currency: string;
  sla_hours: number;
  escalation_role: string | null;
  blocks_export: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  steps: {
    id: string;
    step_order: number;
    role: string;
    sla_hours: number | null;
  }[];
}

export const listApprovalRules = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const [{ data: rules, error: rulesErr }, { data: steps, error: stepsErr }] = await Promise.all([
      context.supabase
        .from("approval_rules")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
      context.supabase
        .from("approval_chain_steps")
        .select("id, rule_id, step_order, role, sla_hours")
        .eq("company_id", companyId)
        .order("step_order", { ascending: true }),
    ]);
    if (rulesErr) throw rulesErr;
    if (stepsErr) throw stepsErr;
    const stepsByRule = new Map<string, ApprovalRuleRow["steps"]>();
    for (const s of (steps ?? []) as Array<{
      id: string;
      rule_id: string;
      step_order: number;
      role: string;
      sla_hours: number | null;
    }>) {
      const list = stepsByRule.get(s.rule_id) ?? [];
      list.push({
        id: s.id,
        step_order: s.step_order,
        role: s.role,
        sla_hours: s.sla_hours,
      });
      stepsByRule.set(s.rule_id, list);
    }
    return ((rules ?? []) as unknown as Omit<ApprovalRuleRow, "steps">[]).map((r) => ({
      ...r,
      steps: stepsByRule.get(r.id) ?? [],
    }));
  });

// ---- Rule create / update --------------------------------------------------
export const upsertApprovalRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => approvalRuleInputSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);

    // Enforce unique step_order client-side too
    const orders = new Set(data.steps.map((s) => s.step_order));
    if (orders.size !== data.steps.length) {
      httpError(400, "duplicate_step_order");
    }

    const payload = {
      company_id: companyId,
      rule_key: data.rule_key,
      name: data.name,
      description: data.description ?? null,
      entity_type: data.entity_type,
      threshold_amount: data.threshold_amount ?? null,
      threshold_currency: data.threshold_currency,
      sla_hours: data.sla_hours,
      escalation_role: data.escalation_role ?? null,
      blocks_export: data.blocks_export,
      is_active: data.is_active,
      created_by: context.user!.id,
    };

    let ruleId: string;
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("approval_rules")
        .update(payload as never)
        .eq("id", data.id)
        .eq("company_id", companyId)
        .select("id")
        .single();
      if (error) throw error;
      ruleId = (updated as { id: string }).id;
    } else {
      const { data: inserted, error } = await context.supabase
        .from("approval_rules")
        .insert(payload as never)
        .select("id")
        .single();
      if (error) throw error;
      ruleId = (inserted as { id: string }).id;
    }

    // Replace chain steps atomically (delete + insert).
    const { error: delErr } = await context.supabase
      .from("approval_chain_steps")
      .delete()
      .eq("rule_id", ruleId);
    if (delErr) throw delErr;

    const rows = data.steps.map((s) => ({
      company_id: companyId,
      rule_id: ruleId,
      step_order: s.step_order,
      role: s.role,
      sla_hours: s.sla_hours ?? null,
    }));
    const { error: insErr } = await context.supabase
      .from("approval_chain_steps")
      .insert(rows as never);
    if (insErr) throw insErr;

    await audit(
      context,
      data.id ? "approval_rule.updated" : "approval_rule.created",
      "approval_rules",
      ruleId,
      { rule_key: data.rule_key, steps: data.steps.length },
    );
    return { id: ruleId };
  });

export const toggleApprovalRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => toggleRuleSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("approval_rules")
      .update({ is_active: data.is_active } as never)
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await audit(context, "approval_rule.toggled", "approval_rules", data.id, {
      is_active: data.is_active,
    });
    return { ok: true };
  });

export const deleteApprovalRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertCompanyAdmin(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("approval_rules")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await audit(context, "approval_rule.deleted", "approval_rules", data.id, {});
    return { ok: true };
  });

// ---- Engine RPC wrappers ---------------------------------------------------
export const startApprovalInstance = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => startApprovalSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: instanceId, error } = await context.supabase.rpc("start_approval_instance", {
      p_rule_key: data.rule_key,
      p_entity_type: data.entity_type,
      p_entity_id: data.entity_id,
      p_amount: data.amount ?? undefined,
      p_metadata: (data.metadata ?? {}) as never,
    });
    if (error) throw error;
    return { instance_id: (instanceId as string | null) ?? null };
  });

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuthMiddleware])
  .inputValidator((raw: unknown) => decideApprovalSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);

    // Final handover approval owns project completion and must settle the
    // approval, gate, and project in one database transaction. The database
    // also rejects direct use of decide_approval for this entity class.
    if (await isHandoverGateApproval(context, data.approval_id)) {
      await decideHandoverGate(
        context,
        data.approval_id,
        data.decision === "approved" ? "approve" : "reject",
        data.comment,
      );
      return { ok: true };
    }

    const { error } = await context.supabase.rpc("decide_approval", {
      p_approval_id: data.approval_id,
      p_decision: data.decision,
      p_comment: data.comment ?? undefined,
    });
    if (error) throw error;
    // P-176 — settle any SCADA event action bound to this approval instance.
    await settleAfterDecision(context, data.approval_id);
    // Day 2 — settle any purchase order bound to this approval instance.
    await settlePoAfterDecision(context, data.approval_id);
    // P-248 — engine-owned settlement for estimates / ESG reports / proposals /
    // pay applications bound to this instance.
    await settleEntityForApproval(context.supabase, data.approval_id);
    return { ok: true };
  });

export const cancelApprovalInstance = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => cancelInstanceSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { error } = await context.supabase.rpc("cancel_approval_instance", {
      p_instance_id: data.instance_id,
    });
    if (error) throw error;
    return { ok: true };
  });

// ---- Permission probe for UI gate -----------------------------------------
export const canManageApprovalRules = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const { data, error } = await context.supabase.rpc("has_company_role", {
      p_role: "company_admin",
    });
    if (error) throw error;
    return { allowed: data === true };
  });
