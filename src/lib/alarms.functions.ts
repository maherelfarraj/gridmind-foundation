// P-105 — Alarm rules + alarm listing / acknowledge server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  acknowledgeInputSchema,
  alarmRuleInputSchema,
  ALARM_SEVERITIES,
  ALARM_STATUSES,
  type AlarmSeverity,
  type AlarmStatus,
  type NotifyRole,
} from "@/lib/alarms.rules";

// ---- helpers ---------------------------------------------------------------
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

async function assertWriter(context: AuthContext): Promise<void> {
  const roles = ["om_admin", "scada_admin", "company_admin"] as const;
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r })),
  );
  if (!results.some((r) => r.data === true)) httpError(403, "forbidden_role");
}

async function audit(
  context: AuthContext,
  action: string,
  entity: "alarm_rules" | "scada_alarms",
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
    /* best-effort */
  }
}

// ---- types -----------------------------------------------------------------
export interface AlarmRuleRow {
  id: string;
  company_id: string;
  project_id: string | null;
  name: string;
  metric: string;
  condition: string;
  threshold: number;
  dead_band: number;
  duration_seconds: number;
  severity: AlarmSeverity;
  escalation_route: Array<{ after_minutes: number; notify_role: NotifyRole }>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlarmRow {
  id: string;
  company_id: string;
  project_id: string;
  scada_asset_id: string | null;
  rule_id: string | null;
  severity: AlarmSeverity;
  message: string;
  value: number | null;
  status: AlarmStatus;
  raised_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  acknowledge_note: string | null;
  cleared_at: string | null;
  escalation_level: number;
  project_name?: string | null;
  asset_key?: string | null;
  rule_name?: string | null;
}

// ---- rules CRUD ------------------------------------------------------------
export const listAlarmRules = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator(
    (raw: unknown) =>
      z
        .object({ project_id: z.string().uuid().nullable().optional() })
        .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("alarm_rules")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (data.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []) as unknown as AlarmRuleRow[];
  });

export const upsertAlarmRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => alarmRuleInputSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const payload = {
      company_id: companyId,
      project_id: data.project_id ?? null,
      name: data.name,
      metric: data.metric,
      condition: data.condition,
      threshold: data.threshold,
      dead_band: data.dead_band,
      duration_seconds: data.duration_seconds,
      severity: data.severity,
      escalation_route: data.escalation_route,
      enabled: data.enabled,
      created_by: context.user!.id,
    };
    let row: AlarmRuleRow;
    if (data.id) {
      const { data: updated, error } = await context.supabase
        .from("alarm_rules")
        .update(payload as never)
        .eq("id", data.id)
        .eq("company_id", companyId)
        .select("*")
        .single();
      if (error) throw error;
      row = updated as unknown as AlarmRuleRow;
      await audit(context, "alarm_rule.updated", "alarm_rules", row.id, {
        name: row.name,
      });
    } else {
      const { data: inserted, error } = await context.supabase
        .from("alarm_rules")
        .insert(payload as never)
        .select("*")
        .single();
      if (error) throw error;
      row = inserted as unknown as AlarmRuleRow;
      await audit(context, "alarm_rule.created", "alarm_rules", row.id, {
        name: row.name,
      });
    }
    return row;
  });

export const deleteAlarmRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("alarm_rules")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    await audit(context, "alarm_rule.deleted", "alarm_rules", data.id, {});
    return { ok: true };
  });

// ---- alarms listing + acknowledge -----------------------------------------
export const listAlarms = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        status: z.enum(ALARM_STATUSES).optional(),
        severity: z.enum(ALARM_SEVERITIES).optional(),
        project_id: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("scada_alarms")
      .select(
        "*, project:projects(name), asset:scada_assets(asset_key), rule:alarm_rules(name)",
      )
      .eq("company_id", companyId)
      .order("raised_at", { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    if (data.severity) q = q.eq("severity", data.severity);
    if (data.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    return ((rows ?? []) as unknown[]).map((r) => {
      const row = r as AlarmRow & {
        project?: { name: string } | null;
        asset?: { asset_key: string } | null;
        rule?: { name: string } | null;
      };
      return {
        ...row,
        project_name: row.project?.name ?? null,
        asset_key: row.asset?.asset_key ?? null,
        rule_name: row.rule?.name ?? null,
      } as AlarmRow;
    });
  });

export const acknowledgeAlarm = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => acknowledgeInputSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);
    const { data: updated, error } = await context.supabase
      .from("scada_alarms")
      .update({
        status: "acknowledged",
        acknowledged_by: context.user!.id,
        acknowledged_at: new Date().toISOString(),
        acknowledge_note: data.note,
      } as never)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("id")
      .single();
    if (error) throw error;
    await audit(context, "alarm.acknowledge", "scada_alarms", data.id, {
      note: data.note,
    });
    return updated as { id: string };
  });
