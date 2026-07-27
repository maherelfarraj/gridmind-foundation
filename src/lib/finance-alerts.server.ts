// P-199 — Finance alerts I/O helpers (kept out of *.functions.ts).
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  FINANCE_ALERT_FULL_ROLES,
  FINANCE_ALERT_READ_ROLES,
  parseThreshold,
  type ThresholdMap,
  type FinanceAlertAccess,
  type ListAlertsInput,
  type SaveAlertRuleInput,
} from "@/lib/finance-alerts.rules";
import { audit, hasAnyRole, httpError } from "@/lib/payments.server";

export interface FinanceAlertRow {
  id: string;
  company_id: string;
  rule_id: string;
  rule_type: string;
  entity_type: string;
  entity_id: string;
  alert_date: string;
  severity: string;
  message: string;
  status: string;
  acknowledged_at: string | null;
  metadata: ThresholdMap;
}

export interface FinanceAlertRuleRow {
  id: string;
  rule_type: string;
  threshold: ThresholdMap;
  enabled: boolean;
  notify_role: string;
  updated_at: string;
}

export async function resolveAlertAccess(ctx: AuthContext): Promise<FinanceAlertAccess> {
  if (await hasAnyRole(ctx, FINANCE_ALERT_FULL_ROLES)) return "full";
  if (await hasAnyRole(ctx, FINANCE_ALERT_READ_ROLES)) return "read";
  return "none";
}

export function assertAlertRead(access: FinanceAlertAccess): void {
  if (access === "none") httpError(403, "forbidden", "You cannot view finance alerts.");
}

export function assertAlertWrite(access: FinanceAlertAccess): void {
  if (access !== "full") {
    httpError(403, "forbidden", "Only finance or company admins can manage finance alerts.");
  }
}

export async function listAlerts(
  ctx: AuthContext,
  filters: ListAlertsInput,
): Promise<FinanceAlertRow[]> {
  let q = ctx.supabase
    .from("finance_alerts")
    .select("*, finance_alert_rules(rule_type)")
    .order("alert_date", { ascending: false })
    .limit(500);
  if (filters.status !== "all") q = q.eq("status", filters.status as never);
  const { data, error } = await q;
  if (error) throw error;
  const rows = ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id as string,
    company_id: r.company_id as string,
    rule_id: r.rule_id as string,
    rule_type: (r.finance_alert_rules?.rule_type ?? "") as string,
    entity_type: r.entity_type as string,
    entity_id: r.entity_id as string,
    alert_date: r.alert_date as string,
    severity: r.severity as string,
    message: r.message as string,
    status: r.status as string,
    acknowledged_at: (r.acknowledged_at ?? null) as string | null,
    metadata: (r.metadata ?? {}) as ThresholdMap,
  }));
  return filters.rule_type === "all"
    ? rows
    : rows.filter((r) => r.rule_type === filters.rule_type);
}

export async function listAlertRules(ctx: AuthContext): Promise<FinanceAlertRuleRow[]> {
  const { data, error } = await ctx.supabase
    .from("finance_alert_rules")
    .select("id, rule_type, threshold, enabled, notify_role, updated_at")
    .order("rule_type");
  if (error) throw error;
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id as string,
    rule_type: r.rule_type as string,
    threshold: (r.threshold ?? {}) as ThresholdMap,
    enabled: Boolean(r.enabled),
    notify_role: r.notify_role as string,
    updated_at: r.updated_at as string,
  }));
}

async function currentCompanyId(ctx: AuthContext): Promise<string> {
  const { data, error } = await ctx.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company", "No active company context.");
  return companyId as string;
}

export async function saveAlertRule(ctx: AuthContext, input: SaveAlertRuleInput): Promise<string> {
  const threshold = parseThreshold(input.rule_type, input.threshold);
  const companyId = await currentCompanyId(ctx);
  const payload = {
    company_id: companyId,
    rule_type: input.rule_type,
    threshold,
    enabled: input.enabled,
    notify_role: input.notify_role,
    created_by: ctx.user!.id,
  };
  const { data, error } = await ctx.supabase
    .from("finance_alert_rules")
    .upsert(payload as never, { onConflict: "company_id,rule_type" })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  await audit(ctx, "alert_rule.save", "finance_alert_rules", id, {
    rule_type: input.rule_type,
    threshold,
    enabled: input.enabled,
    notify_role: input.notify_role,
  });
  return id;
}

export async function transitionAlert(
  ctx: AuthContext,
  alertId: string,
  action: "acknowledge" | "dismiss",
): Promise<string> {
  const { data: existing, error: readErr } = await ctx.supabase
    .from("finance_alerts")
    .select("id, status")
    .eq("id", alertId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!existing) httpError(404, "not_found", "Alert not found.");
  const from = (existing as { status: string }).status;
  const status = action === "acknowledge" ? "acknowledged" : "dismissed";
  const { error } = await ctx.supabase
    .from("finance_alerts")
    .update({
      status,
      acknowledged_by: ctx.user!.id,
      acknowledged_at: new Date().toISOString(),
    } as never)
    .eq("id", alertId);
  if (error) throw error;
  await audit(ctx, `alert.${action}`, "finance_alerts", alertId, { from, to: status });
  return status;
}
