// P-228 — Server-only helpers for the weekly timesheet grid. Kept out of
// *.functions.ts so the createServerFn split transform can't drop siblings.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { computeWeeklyTotals } from "@/lib/timesheets/split";
import { chooseApprovalRoute, type ApprovalRouteMode } from "@/lib/timesheets/submit-guards";

export type Client = SupabaseClient<Database>;

export const TIMESHEET_ADMIN_ROLES = [
  "foreman",
  "construction_admin",
  "project_admin",
  "company_admin",
] as const;

export const RATE_ADMIN_ROLES = ["project_admin", "company_admin"] as const;

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function currentCompanyId(client: Client, userId: string): Promise<string> {
  const { data, error } = await client
    .from("profiles")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

export async function hasAnyRole(client: Client, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => client.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => r.data === true);
}

export async function writeAuditLog(
  client: Client,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await client.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: (entityId ?? null) as unknown as string,
      p_metadata: metadata as never,
    });
  } catch {
    // audit must never fail the request
  }
}

export interface ClockDay {
  start: string | null;
  end: string | null;
}

export interface TimesheetMetadata {
  clock?: Record<string, ClockDay>;
}

export interface TimesheetRow {
  id: string;
  company_id: string;
  timesheet_number: string | null;
  user_id: string;
  project_id: string | null;
  week_start: string;
  status: string;
  total_regular_hours: number;
  total_overtime_hours: number;
  submitted_at: string | null;
  approval_instance_id: string | null;
  metadata: TimesheetMetadata | null;
}

export interface EntryRow {
  id: string;
  work_date: string;
  project_id: string | null;
  cwp_id: string | null;
  activity: string;
  hours: number;
  hourly_rate: number | null;
  notes: string | null;
}

const TIMESHEET_COLS =
  "id, company_id, timesheet_number, user_id, project_id, week_start, status, total_regular_hours, total_overtime_hours, submitted_at, approval_instance_id, metadata";
const ENTRY_COLS = "id, work_date, project_id, cwp_id, activity, hours, hourly_rate, notes";

/** Idempotent per (user, week): returns the existing sheet or creates a draft. */
export async function getOrCreateWeek(
  client: Client,
  userId: string,
  companyId: string,
  weekStart: string,
): Promise<TimesheetRow> {
  const existing = await client
    .from("timesheets")
    .select(TIMESHEET_COLS)
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data as unknown as TimesheetRow;

  const created = await client
    .from("timesheets")
    .insert({
      company_id: companyId,
      user_id: userId,
      week_start: weekStart,
      status: "draft",
      created_by: userId,
    })
    .select(TIMESHEET_COLS)
    .single();

  // Lost the race with a concurrent create → read the winner back.
  if (created.error) {
    const retry = await client
      .from("timesheets")
      .select(TIMESHEET_COLS)
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (retry.error || !retry.data) throw created.error;
    return retry.data as unknown as TimesheetRow;
  }
  return created.data as unknown as TimesheetRow;
}

export async function listEntries(client: Client, timesheetId: string): Promise<EntryRow[]> {
  const { data, error } = await client
    .from("timesheet_entries")
    .select(ENTRY_COLS)
    .eq("timesheet_id", timesheetId)
    .order("work_date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as EntryRow[];
}

export async function loadTimesheet(client: Client, timesheetId: string): Promise<TimesheetRow> {
  const { data, error } = await client
    .from("timesheets")
    .select(TIMESHEET_COLS)
    .eq("id", timesheetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "timesheet_not_found");
  return data as unknown as TimesheetRow;
}

/** Owner or one of the timesheet admin roles; throws 403 otherwise. */
export async function assertCanEdit(
  client: Client,
  sheet: TimesheetRow,
  userId: string,
): Promise<void> {
  if (sheet.user_id === userId) return;
  if (await hasAnyRole(client, TIMESHEET_ADMIN_ROLES)) return;
  httpError(403, "forbidden");
}

export function assertDraft(sheet: TimesheetRow): void {
  if (sheet.status !== "draft") {
    httpError(409, "timesheet_locked", `Timesheet is ${sheet.status} and can no longer be edited.`);
  }
}

export interface CellInput {
  work_date: string;
  project_id: string | null;
  cwp_id: string | null;
  activity: string;
  hours: number;
  notes?: string | null;
}

function cellKey(c: { work_date: string; project_id: string | null; activity: string }): string {
  return `${c.work_date}|${c.project_id ?? "-"}|${c.activity}`;
}

/**
 * Apply a batch of cell edits, then recompute the sheet totals SERVER-SIDE from
 * the persisted rows (client totals are never trusted).
 */
export async function applyCells(
  client: Client,
  sheet: TimesheetRow,
  cells: readonly CellInput[],
): Promise<{ entries: EntryRow[]; regular: number; overtime: number }> {
  const existing = await listEntries(client, sheet.id);
  const byKey = new Map(existing.map((e) => [cellKey(e), e]));

  for (const cell of cells) {
    const found = byKey.get(cellKey(cell));
    if (cell.hours <= 0 && !cell.notes) {
      if (found) {
        const { error } = await client.from("timesheet_entries").delete().eq("id", found.id);
        if (error) throw error;
      }
      continue;
    }
    if (found) {
      const { error } = await client
        .from("timesheet_entries")
        .update({
          hours: cell.hours,
          cwp_id: cell.cwp_id,
          notes: cell.notes ?? found.notes ?? null,
        })
        .eq("id", found.id);
      if (error) throw error;
    } else {
      const { error } = await client.from("timesheet_entries").insert({
        company_id: sheet.company_id,
        timesheet_id: sheet.id,
        work_date: cell.work_date,
        project_id: cell.project_id,
        cwp_id: cell.cwp_id,
        activity: cell.activity as never,
        hours: cell.hours,
        notes: cell.notes ?? null,
      });
      if (error) throw error;
    }
  }

  const entries = await listEntries(client, sheet.id);
  const totals = computeWeeklyTotals(entries);
  const { error: updErr } = await client
    .from("timesheets")
    .update({
      total_regular_hours: totals.regular,
      total_overtime_hours: totals.overtime,
    })
    .eq("id", sheet.id);
  if (updErr) throw updErr;

  return { entries, regular: totals.regular, overtime: totals.overtime };
}

/** construction_work_packages may not exist yet (Batch 21) — 42P01 guard. */
export async function listCwpsSafe(
  client: Client,
  projectId: string,
): Promise<{ available: boolean; rows: Array<{ id: string; cwp_number: string; title: string }> }> {
  const { data, error } = await client
    .from("construction_work_packages")
    .select("id, cwp_number, title")
    .eq("project_id", projectId)
    .order("cwp_number", { ascending: true });
  if (error) {
    if ((error as { code?: string }).code === "42P01") return { available: false, rows: [] };
    throw error;
  }
  return {
    available: true,
    rows: (data ?? []) as Array<{ id: string; cwp_number: string; title: string }>,
  };
}

// ── P-229 — approval routing, decision watcher and lock enforcement ─────────

export const TIMESHEET_RULE_KEY = "timesheet_approval";
export const TIMESHEET_ENTITY = "timesheet";

const STEP1_POOL_ROLES = ["foreman", "construction_admin"] as const;

async function roleHolders(
  client: Client,
  companyId: string,
  role: string,
): Promise<Array<{ user_id: string }>> {
  const { data, error } = await client
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", role as never);
  if (error) throw error;
  return (data ?? []) as Array<{ user_id: string }>;
}

export interface ApprovalRoutingResult {
  instanceId: string | null;
  mode: ApprovalRouteMode;
}

/**
 * Open (or reuse) the P-111 instance for this timesheet.
 *  - foreman holders exist            → engine handles step 1 as-is
 *  - construction_admin holders only  → re-point step-1 approvals to them
 *  - neither role has a holder        → inline instance opened at step 2
 */
export async function routeTimesheetApproval(
  client: Client,
  sheet: TimesheetRow,
  totals: { regular: number; overtime: number },
  requestedBy: string,
): Promise<ApprovalRoutingResult> {
  const [foremen, constructionAdmins] = await Promise.all(
    STEP1_POOL_ROLES.map((r) => roleHolders(client, sheet.company_id, r)),
  );
  const mode = chooseApprovalRoute({
    foreman: foremen.length,
    construction_admin: constructionAdmins.length,
  });

  const metadata = {
    timesheet_number: sheet.timesheet_number,
    user_id: sheet.user_id,
    week_start: sheet.week_start,
    total_regular_hours: totals.regular,
    total_overtime_hours: totals.overtime,
  };

  if (mode !== "inline_step2") {
    const { data, error } = await client.rpc("start_approval_instance", {
      p_rule_key: TIMESHEET_RULE_KEY,
      p_entity_type: TIMESHEET_ENTITY,
      p_entity_id: sheet.id,
      p_amount: null as never,
      p_metadata: metadata as never,
    });
    if (error) throw error;
    const instanceId = (data as string | null) ?? null;
    if (instanceId && mode === "construction_admin") {
      await repointStepOne(client, sheet.company_id, instanceId, constructionAdmins);
    }
    return { instanceId, mode };
  }

  return { instanceId: await inlineStepTwoInstance(client, sheet, metadata, requestedBy), mode };
}

/**
 * The engine falls back to company_admin when the step's role has no holder.
 * For a construction_admin-only company we swap those rows for the real pool.
 */
async function repointStepOne(
  client: Client,
  companyId: string,
  instanceId: string,
  holders: Array<{ user_id: string }>,
): Promise<void> {
  const { data: rows, error } = await client
    .from("approvals")
    .select("id, step_id, step_order, due_at, status")
    .eq("instance_id", instanceId)
    .eq("step_order", 1);
  if (error) throw error;
  const existing = (rows ?? []) as Array<{
    id: string;
    step_id: string | null;
    step_order: number;
    due_at: string | null;
    status: string;
  }>;
  // Only re-point a freshly created, undecided step.
  if (existing.length === 0 || existing.some((r) => r.status !== "pending")) return;
  const template = existing[0];
  const wanted = new Set(holders.map((h) => h.user_id));
  const current = new Set<string>();
  const { data: currentRows } = await client
    .from("approvals")
    .select("approver_id")
    .eq("instance_id", instanceId)
    .eq("step_order", 1);
  for (const r of (currentRows ?? []) as Array<{ approver_id: string }>) current.add(r.approver_id);
  if (wanted.size === current.size && [...wanted].every((u) => current.has(u))) return;

  const del = await client.from("approvals").delete().eq("instance_id", instanceId).eq(
    "step_order",
    1,
  );
  if (del.error) throw del.error;
  const insert = await client.from("approvals").insert(
    holders.map((h) => ({
      company_id: companyId,
      instance_id: instanceId,
      approver_id: h.user_id,
      step_id: template.step_id,
      step_order: 1,
      status: "pending",
      due_at: template.due_at,
    })),
  );
  if (insert.error) throw insert.error;
}

/** Mirror the engine's row shape, but open the instance straight at step 2. */
async function inlineStepTwoInstance(
  client: Client,
  sheet: TimesheetRow,
  metadata: Record<string, unknown>,
  requestedBy: string,
): Promise<string | null> {
  const open = await client
    .from("approval_instances")
    .select("id")
    .eq("company_id", sheet.company_id)
    .eq("entity_type", TIMESHEET_ENTITY)
    .eq("entity_id", sheet.id)
    .in("status", ["pending", "in_progress"])
    .maybeSingle();
  if (open.error) throw open.error;
  if (open.data) return (open.data as { id: string }).id;

  const rule = await client
    .from("approval_rules")
    .select("id, sla_hours")
    .eq("company_id", sheet.company_id)
    .eq("rule_key", TIMESHEET_RULE_KEY)
    .maybeSingle();
  if (rule.error) throw rule.error;
  const ruleRow = rule.data as { id: string; sla_hours: number | null } | null;
  if (!ruleRow) return null;

  const step = await client
    .from("approval_chain_steps")
    .select("id, step_order, role, sla_hours")
    .eq("rule_id", ruleRow.id)
    .eq("step_order", 2)
    .maybeSingle();
  if (step.error) throw step.error;
  const stepRow = step.data as {
    id: string;
    step_order: number;
    role: string;
    sla_hours: number | null;
  } | null;
  if (!stepRow) return null;

  const slaHours = stepRow.sla_hours ?? ruleRow.sla_hours ?? 48;
  const slaDue = new Date(Date.now() + slaHours * 3600_000).toISOString();

  const created = await client
    .from("approval_instances")
    .insert({
      company_id: sheet.company_id,
      entity: TIMESHEET_ENTITY,
      entity_type: TIMESHEET_ENTITY,
      entity_id: sheet.id,
      rule_id: ruleRow.id,
      rule_key: TIMESHEET_RULE_KEY,
      status: "pending",
      current_step: 2,
      amount: null,
      requested_by: requestedBy,
      sla_due_at: slaDue,
      metadata: metadata as never,
    })
    .select("id")
    .single();
  if (created.error) throw created.error;
  const instanceId = (created.data as { id: string }).id;

  let holders = await roleHolders(client, sheet.company_id, stepRow.role);
  if (holders.length === 0) holders = await roleHolders(client, sheet.company_id, "company_admin");
  if (holders.length > 0) {
    const insert = await client.from("approvals").insert(
      holders.map((h) => ({
        company_id: sheet.company_id,
        instance_id: instanceId,
        approver_id: h.user_id,
        step_id: stepRow.id,
        step_order: 2,
        status: "pending",
        due_at: slaDue,
      })),
    );
    if (insert.error) throw insert.error;
  }
  return instanceId;
}

export interface InstanceState {
  id: string;
  status: string;
  current_step: number;
  comment: string | null;
}

/** Latest decision comment on the instance, newest first. */
export async function loadInstanceState(
  client: Client,
  instanceId: string,
): Promise<InstanceState | null> {
  const { data, error } = await client
    .from("approval_instances")
    .select("id, status, current_step")
    .eq("id", instanceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const inst = data as { id: string; status: string; current_step: number };
  const { data: rows } = await client
    .from("approvals")
    .select("comment, decided_at, status")
    .eq("instance_id", instanceId)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(1);
  const latest = ((rows ?? []) as Array<{ comment: string | null }>)[0] ?? null;
  return { ...inst, comment: latest?.comment ?? null };
}

/** Sync the timesheet status with its approval instance. Idempotent. */
export async function syncTimesheetDecision(
  client: Client,
  sheet: TimesheetRow,
): Promise<{ status: string; comment: string | null; changed: boolean }> {
  if (!sheet.approval_instance_id) {
    return { status: sheet.status, comment: null, changed: false };
  }
  const state = await loadInstanceState(client, sheet.approval_instance_id);
  if (!state) return { status: sheet.status, comment: null, changed: false };

  const target =
    state.status === "approved" ? "approved" : state.status === "rejected" ? "rejected" : null;
  if (!target || sheet.status === target) {
    return { status: sheet.status, comment: state.comment, changed: false };
  }

  const { error } = await client
    .from("timesheets")
    .update({ status: target as never })
    .eq("id", sheet.id)
    .neq("status", target as never);
  if (error) throw error;
  await writeAuditLog(client, `timesheet.${target}`, "timesheets", sheet.id, {
    week_start: sheet.week_start,
    approval_instance_id: sheet.approval_instance_id,
    comment: state.comment,
  });
  return { status: target, comment: state.comment, changed: true };
}
