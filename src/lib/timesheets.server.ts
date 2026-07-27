// P-228 — Server-only helpers for the weekly timesheet grid. Kept out of
// *.functions.ts so the createServerFn split transform can't drop siblings.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { computeWeeklyTotals } from "@/lib/timesheets/split";

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
  metadata: Record<string, unknown> | null;
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
  "id, company_id, timesheet_number, user_id, project_id, week_start, status, total_regular_hours, total_overtime_hours, submitted_at, metadata";
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
