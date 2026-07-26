// P-176 — Thin server-function wrappers for SCADA action rules and the action log.
import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { writeAuditLog } from "@/lib/civil.server";
import {
  assertRuleWriter,
  canManageRules,
  currentCompanyId,
  evaluateEventById,
  listActionLogRows,
  listRules,
} from "@/lib/scada-actions.server";
import { actionRequiresApproval, actionRuleFormSchema } from "@/lib/scada/action-rules";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const listActionRules = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const [rules, canManage] = await Promise.all([listRules(context), canManageRules(context)]);
    return { rules, canManage };
  });

export const listActionLog = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return { rows: await listActionLogRows(context, 200) };
  });

export const saveActionRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({ id: z.string().uuid().nullable().optional(), values: z.unknown() })
      .transform((v) => ({ id: v.id ?? null, values: actionRuleFormSchema.parse(v.values) }))
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRuleWriter(context);
    const companyId = await currentCompanyId(context);
    const v = data.values;
    // Governance floor re-applied server-side — the frontend is never authority.
    const requiresApproval = actionRequiresApproval(v.action_type, v.requires_approval);

    const payload = {
      company_id: companyId,
      project_id: v.project_id ?? null,
      name: v.name,
      event_type: v.event_type,
      min_severity: v.min_severity,
      match: v.match as never,
      action_type: v.action_type,
      action_config: v.action_config as never,
      requires_approval: requiresApproval,
      approval_rule_key: v.approval_rule_key,
      ai_assist: v.ai_assist,
      enabled: v.enabled,
    };

    if (data.id) {
      const { error } = await context.supabase
        .from("event_action_rules")
        .update(payload as never)
        .eq("id", data.id)
        .eq("company_id", companyId);
      if (error) throw error;
      await writeAuditLog(context, "scada.action_rule.update", "event_action_rules", data.id, {
        name: v.name,
        action_type: v.action_type,
        requires_approval: requiresApproval,
      });
      return { id: data.id };
    }

    const { data: row, error } = await context.supabase
      .from("event_action_rules")
      .insert({ ...payload, created_by: context.user!.id } as never)
      .select("id")
      .single();
    if (error) throw error;
    const id = (row as { id: string }).id;
    await writeAuditLog(context, "scada.action_rule.create", "event_action_rules", id, {
      name: v.name,
      action_type: v.action_type,
      requires_approval: requiresApproval,
    });
    return { id };
  });

export const toggleActionRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRuleWriter(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("event_action_rules")
      .update({ enabled: data.enabled } as never)
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await writeAuditLog(context, "scada.action_rule.toggle", "event_action_rules", data.id, {
      enabled: data.enabled,
    });
    return { ok: true };
  });

export const deleteActionRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRuleWriter(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("event_action_rules")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await writeAuditLog(context, "scada.action_rule.delete", "event_action_rules", data.id, {});
    return { ok: true };
  });

/** Manual (idempotent) re-evaluation of one event against the rule set. */
export const evaluateEvent = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ eventId: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const result = await evaluateEventById(context, data.eventId);
    await writeAuditLog(context, "scada.event_action_evaluate", "scada_events", data.eventId, {
      ...result,
    });
    return result;
  });
