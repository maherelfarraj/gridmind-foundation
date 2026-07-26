// P-174 — Alarm console server helpers (assignment, RCA workflow, console KPIs).
// Kept out of the *.functions.ts wrapper so serverFn splitting cannot drop them.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  countBySeverity,
  countUnacknowledgedCritical,
  meanTimeToAcknowledgeMinutes,
  validateRcaTransition,
  type AssignAlarmInput,
  type RcaStatus,
  type RcaUpdateInput,
  type SeverityCount,
} from "@/lib/scada/alarm-workflow";
import { ALARM_SEVERITIES } from "@/lib/alarms.rules";

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) httpError(400, "no_company");
  return cid as string;
}

export async function assertAlarmWriter(context: AuthContext): Promise<void> {
  const roles = ["om_admin", "scada_admin", "company_admin"] as const;
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r })),
  );
  if (!results.some((r) => r.data === true)) httpError(403, "forbidden_role");
}

export async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "scada_alarms",
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

export interface AssignableMember {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  roles: string[];
}

const ASSIGNABLE_ROLES = ["om_admin", "scada_admin", "field_technician"] as const;

export async function listAssignableMembers(context: AuthContext): Promise<AssignableMember[]> {
  const companyId = await currentCompanyId(context);
  const { data: roleRows, error: roleErr } = await context.supabase
    .from("user_roles")
    .select("user_id, role")
    .eq("company_id", companyId)
    .in("role", [...ASSIGNABLE_ROLES]);
  if (roleErr) throw roleErr;

  const byUser = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { user_id: string; role: string }[]) {
    byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
  }
  const ids = Array.from(byUser.keys());
  if (ids.length === 0) return [];

  const { data: profiles, error: pErr } = await context.supabase
    .from("profiles")
    .select("id, full_name, email, avatar_url")
    .in("id", ids);
  if (pErr) throw pErr;

  return ((profiles ?? []) as AssignableMember[])
    .map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }))
    .sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
}

export interface ConsoleKpis {
  unacknowledgedCritical: number;
  mttaMinutes: number | null;
  bySeverity: SeverityCount[];
  total: number;
}

export function computeConsoleKpis(
  rows: { severity: string; status: string; raised_at: string; acknowledged_at: string | null }[],
): ConsoleKpis {
  return {
    unacknowledgedCritical: countUnacknowledgedCritical(rows),
    mttaMinutes: meanTimeToAcknowledgeMinutes(rows),
    bySeverity: countBySeverity(rows, ALARM_SEVERITIES),
    total: rows.length,
  };
}

export async function assignAlarm(context: AuthContext, data: AssignAlarmInput) {
  await assertAlarmWriter(context);
  const companyId = await currentCompanyId(context);

  if (data.assigned_to) {
    const members = await listAssignableMembers(context);
    if (!members.some((m) => m.id === data.assigned_to)) {
      httpError(400, "invalid_assignee", "That member cannot be assigned SCADA alarms.");
    }
  }

  const { data: updated, error } = await context.supabase
    .from("scada_alarms")
    .update({ assigned_to: data.assigned_to } as never)
    .eq("id", data.id)
    .eq("company_id", companyId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) httpError(404, "not_found");

  await audit(context, "alarm.assign", data.id, { assigned_to: data.assigned_to });
  return { id: data.id, assigned_to: data.assigned_to };
}

export async function updateAlarmRca(context: AuthContext, data: RcaUpdateInput) {
  await assertAlarmWriter(context);
  const companyId = await currentCompanyId(context);

  const { data: existing, error: exErr } = await context.supabase
    .from("scada_alarms")
    .select("id, status, rca_status, root_cause")
    .eq("id", data.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (exErr) throw exErr;
  if (!existing) httpError(404, "not_found");

  const row = existing as { status: string; rca_status: string | null; root_cause: string | null };
  const from = (row.rca_status ?? "open") as RcaStatus;
  const rootCause = data.root_cause ?? row.root_cause ?? null;

  const check = validateRcaTransition({
    from,
    to: data.rca_status,
    rootCause,
    alarmStatus: row.status,
  });
  if (!check.ok) httpError(422, check.code, check.message);

  const patch: Record<string, unknown> = { rca_status: data.rca_status };
  if (data.root_cause !== undefined) patch.root_cause = data.root_cause;
  if (data.rca_notes !== undefined) patch.rca_notes = data.rca_notes;

  const { error } = await context.supabase
    .from("scada_alarms")
    .update(patch as never)
    .eq("id", data.id)
    .eq("company_id", companyId);
  if (error) throw error;

  await audit(context, "alarm.rca_update", data.id, {
    from,
    to: data.rca_status,
    has_root_cause: !!rootCause,
  });
  return { id: data.id, rca_status: data.rca_status };
}
