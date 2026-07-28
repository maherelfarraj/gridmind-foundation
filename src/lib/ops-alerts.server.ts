// Ops alerts — thin DB access helpers. Cross-tenant reads use supabaseAdmin,
// loaded lazily inside handlers (never at module scope of a *.functions.ts file).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { Database } from "@/integrations/supabase/types";

export type OpsAlertRow = Database["public"]["Tables"]["ops_alerts"]["Row"];
export type OpsAlertRuleRow = Database["public"]["Tables"]["ops_alert_rules"]["Row"];
export type OpsAlertStatus = Database["public"]["Enums"]["ops_alert_status"];
export type OpsAlertSeverity = Database["public"]["Enums"]["ops_alert_severity"];
export type AppRole = Database["public"]["Enums"]["app_role"];

export const OPS_ALERT_STATUSES: OpsAlertStatus[] = ["open", "acknowledged", "dismissed"];
export const OPS_ALERT_SEVERITIES: OpsAlertSeverity[] = ["info", "warning", "critical"];

export async function assertSuperAdmin(
  ctx: AuthContext & { user: NonNullable<AuthContext["user"]> },
) {
  const { data: isSuper, error } = await ctx.supabase.rpc("has_role", {
    p_user_id: ctx.user.id,
    p_role: "super_admin",
  });
  if (error) throw error;
  if (isSuper !== true) {
    throw Object.assign(new Error("forbidden"), {
      statusCode: 403,
      body: JSON.stringify({ error: "forbidden" }),
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
