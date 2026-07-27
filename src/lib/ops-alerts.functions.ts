// Ops alerts — super-admin cross-tenant watchdog inbox + rule configuration.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertSuperAdmin,
  OPS_ALERT_SEVERITIES,
  OPS_ALERT_STATUSES,
  type OpsAlertRow,
  type OpsAlertRuleRow,
} from "@/lib/ops-alerts.server";

const ListOpsAlertsSchema = z.object({
  status: z.enum(["open", "acknowledged", "dismissed", "all"]).default("open"),
  rule_type: z.string().default("all"),
  severity: z.enum(["info", "warning", "critical", "all"]).default("all"),
});

const AlertActionSchema = z.object({
  alert_id: z.string().uuid(),
  action: z.enum(["acknowledge", "dismiss"]),
});

const SaveOpsAlertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  rule_type: z.string().min(1),
  threshold: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
  notify_role: z.string().min(1),
  company_id: z.string().uuid().nullable().optional(),
});

export const getOpsAlerts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => ListOpsAlertsSchema.parse(input ?? {}))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ alerts: OpsAlertRow[]; rules: OpsAlertRuleRow[]; canWrite: boolean }> => {
      requireSupabaseAuth(context);
      await assertSuperAdmin(context);

      // Cross-tenant view requires bypassing RLS. Load admin client inside the
      // handler (never at module scope of a .functions.ts file).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      let alertsQuery = supabaseAdmin
        .from("ops_alerts")
        .select("*, ops_alert_rules(rule_type)")
        .order("alert_date", { ascending: false })
        .limit(500);
      if (data.status !== "all") alertsQuery = alertsQuery.eq("status", data.status);
      if (data.severity !== "all") alertsQuery = alertsQuery.eq("severity", data.severity);

      const [{ data: alertRows, error: alertErr }, { data: ruleRows, error: ruleErr }] =
        await Promise.all([
          alertsQuery,
          supabaseAdmin.from("ops_alert_rules").select("*").order("rule_type"),
        ]);
      if (alertErr) throw alertErr;
      if (ruleErr) throw ruleErr;

      let alerts = ((alertRows ?? []) as Array<OpsAlertRow & { ops_alert_rules?: { rule_type: string } | null }>).map(
        (r) => {
          const { ops_alert_rules, ...rest } = r;
          return { ...rest, rule_type: ops_alert_rules?.rule_type ?? null } as OpsAlertRow & {
            rule_type: string | null;
          };
        },
      );
      if (data.rule_type !== "all") {
        alerts = alerts.filter((a) => a.rule_type === data.rule_type);
      }

      return { alerts, rules: (ruleRows ?? []) as OpsAlertRuleRow[], canWrite: true };
    },
  );

export const actOnOpsAlert = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => AlertActionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const status = data.action === "acknowledge" ? "acknowledged" : "dismissed";
    const { data: existing, error: readErr } = await supabaseAdmin
      .from("ops_alerts")
      .select("id")
      .eq("id", data.alert_id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!existing) {
      throw Object.assign(new Error("not_found"), {
        statusCode: 404,
        body: JSON.stringify({ error: "not_found" }),
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    const { error } = await supabaseAdmin
      .from("ops_alerts")
      .update({
        status,
        acknowledged_by: context.user.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", data.alert_id);
    if (error) throw error;

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.user.id,
      action: `ops_alert.${data.action}`,
      entity_type: "ops_alerts",
      entity_id: data.alert_id,
      metadata: { to: status },
    });

    return { status };
  });

export const saveOpsAlertRule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => SaveOpsAlertRuleSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    await assertSuperAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      ...(data.id ? { id: data.id } : {}),
      rule_type: data.rule_type,
      threshold: data.threshold,
      enabled: data.enabled,
      notify_role: data.notify_role,
      company_id: data.company_id ?? null,
      created_by: context.user.id,
    };

    const { data: row, error } = await supabaseAdmin
      .from("ops_alert_rules")
      .upsert(payload, data.id ? { onConflict: "id" } : undefined)
      .select("id")
      .single();
    if (error) throw error;

    const id = (row as { id: string }).id;
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.user.id,
      action: "ops_alert_rule.save",
      entity_type: "ops_alert_rules",
      entity_id: id,
      metadata: { rule_type: data.rule_type, enabled: data.enabled, notify_role: data.notify_role },
    });

    return { id };
  });

export { OPS_ALERT_STATUSES, OPS_ALERT_SEVERITIES };
