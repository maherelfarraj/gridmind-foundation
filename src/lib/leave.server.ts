// P-230 — Server-only helpers for leave management. Kept out of *.functions.ts
// so the createServerFn split transform can't drop siblings.
import { computeWeeklyTotals } from "@/lib/timesheets/split";
import {
  balanceColumnFor,
  countWorkingDays,
  LEAVE_ACTIVITY,
  LEAVE_TYPE_LABELS,
  rangesOverlap,
  workingDaysInRange,
  type LeaveType,
} from "@/lib/timesheets/leave";
import { TIMESHEET_POLICY } from "@/lib/timesheets/policy";
import { weekStartOf } from "@/lib/timesheets/week";
import type { Client } from "@/lib/timesheets.server";
import { httpError, listEntries } from "@/lib/timesheets.server";

export const LEAVE_APPROVER_ROLES = [
  "foreman",
  "construction_admin",
  "project_admin",
  "company_admin",
] as const;

/** Roles allowed to unwind an approved request (and its auto-created entries). */
export const LEAVE_UNWIND_ROLES = ["project_admin", "company_admin"] as const;

export interface LeaveRow {
  id: string;
  company_id: string;
  request_number: string | null;
  user_id: string;
  leave_type: LeaveType;
  date_from: string;
  date_to: string;
  days: number;
  reason: string | null;
  status: string;
  approver_id: string | null;
  decided_at: string | null;
  decision_comment: string | null;
  attachment_path: string | null;
  created_at: string;
}

export const LEAVE_COLS =
  "id, company_id, request_number, user_id, leave_type, date_from, date_to, days, reason, status, approver_id, decided_at, decision_comment, attachment_path, created_at";

export async function loadLeave(client: Client, id: string): Promise<LeaveRow> {
  const { data, error } = await client.from("leave_requests").select(LEAVE_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "leave_not_found", "That leave request no longer exists.");
  return data as unknown as LeaveRow;
}

/**
 * Approved-leave overlap detection. Pending overlaps are returned separately —
 * they warn on the client but never block the request.
 */
export async function findOverlaps(
  client: Client,
  userId: string,
  dateFrom: string,
  dateTo: string,
  excludeId?: string,
): Promise<{ approved: LeaveRow | null; pending: LeaveRow[] }> {
  const { data, error } = await client
    .from("leave_requests")
    .select(LEAVE_COLS)
    .eq("user_id", userId)
    .in("status", ["pending", "approved"])
    .lte("date_from", dateTo)
    .gte("date_to", dateFrom);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as LeaveRow[]).filter(
    (r) => r.id !== excludeId && rangesOverlap(dateFrom, dateTo, r.date_from, r.date_to),
  );
  return {
    approved: rows.find((r) => r.status === "approved") ?? null,
    pending: rows.filter((r) => r.status === "pending"),
  };
}

export interface BalanceRow {
  id: string;
  company_id: string;
  user_id: string;
  annual_entitlement_days: number;
  annual_used_days: number;
  sick_used_days: number;
}

const BALANCE_COLS =
  "id, company_id, user_id, annual_entitlement_days, annual_used_days, sick_used_days";

export async function readBalance(
  client: Client,
  companyId: string,
  userId: string,
): Promise<BalanceRow | null> {
  const { data, error } = await client
    .from("leave_balances")
    .select(BALANCE_COLS)
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as BalanceRow | null;
}

/**
 * Upsert the balance row (auto-created on first approval with the policy
 * entitlement) and increment the counter that matches the leave type.
 * Travel and unpaid leave consume no balance.
 */
export async function applyBalance(
  client: Client,
  companyId: string,
  userId: string,
  type: LeaveType,
  days: number,
): Promise<BalanceRow | null> {
  const column = balanceColumnFor(type);
  const existing = await readBalance(client, companyId, userId);
  if (!column) return existing;

  if (!existing) {
    const { data, error } = await client
      .from("leave_balances")
      .insert({
        company_id: companyId,
        user_id: userId,
        annual_entitlement_days: TIMESHEET_POLICY.defaultAnnualEntitlementDays,
        annual_used_days: column === "annual_used_days" ? days : 0,
        sick_used_days: column === "sick_used_days" ? days : 0,
      })
      .select(BALANCE_COLS)
      .single();
    if (error) throw error;
    return data as unknown as BalanceRow;
  }

  const next = Math.round((Number(existing[column]) + days) * 100) / 100;
  const patch =
    column === "annual_used_days" ? { annual_used_days: next } : { sick_used_days: next };
  const { data, error } = await client
    .from("leave_balances")
    .update(patch)
    .eq("id", existing.id)
    .select(BALANCE_COLS)
    .single();
  if (error) throw error;
  return data as unknown as BalanceRow;
}

export interface AutoEntryResult {
  created: number;
  skipped_weeks: string[];
}

async function recomputeTotals(client: Client, timesheetId: string): Promise<void> {
  const entries = await listEntries(client, timesheetId);
  const totals = computeWeeklyTotals(entries);
  await client
    .from("timesheets")
    .update({ total_regular_hours: totals.regular, total_overtime_hours: totals.overtime })
    .eq("id", timesheetId);
}

/**
 * Auto-create one timesheet entry per covered workday. Idempotent: an entry
 * already carrying `source_leave_request_id` for that date is never
 * duplicated. Weeks whose timesheet is locked (submitted/in_review/approved)
 * — or that the approver may not create — are reported as skipped_weeks.
 */
export async function createLeaveEntries(client: Client, leave: LeaveRow): Promise<AutoEntryResult> {
  const days = workingDaysInRange(leave.date_from, leave.date_to);
  const byWeek = new Map<string, string[]>();
  for (const day of days) {
    const week = weekStartOf(day);
    byWeek.set(week, [...(byWeek.get(week) ?? []), day]);
  }

  let created = 0;
  const skipped: string[] = [];

  for (const [weekStart, dates] of byWeek) {
    const found = await client
      .from("timesheets")
      .select("id, status")
      .eq("user_id", leave.user_id)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (found.error) throw found.error;

    let sheet = found.data as { id: string; status: string } | null;
    if (!sheet) {
      const created$ = await client
        .from("timesheets")
        .insert({
          company_id: leave.company_id,
          user_id: leave.user_id,
          week_start: weekStart,
          status: "draft",
        })
        .select("id, status")
        .single();
      if (created$.error || !created$.data) {
        skipped.push(weekStart);
        continue;
      }
      sheet = created$.data as { id: string; status: string };
    }

    if (sheet.status !== "draft") {
      skipped.push(weekStart);
      continue;
    }

    const existing = await client
      .from("timesheet_entries")
      .select("work_date")
      .eq("timesheet_id", sheet.id)
      .eq("source_leave_request_id", leave.id);
    if (existing.error) throw existing.error;
    const covered = new Set(
      ((existing.data ?? []) as Array<{ work_date: string }>).map((r) => r.work_date),
    );

    const rows = dates
      .filter((d) => !covered.has(d))
      .map((d) => ({
        company_id: leave.company_id,
        timesheet_id: sheet!.id,
        work_date: d,
        activity: LEAVE_ACTIVITY[leave.leave_type] as never,
        hours: TIMESHEET_POLICY.standardDailyHours,
        notes: `${LEAVE_TYPE_LABELS[leave.leave_type]} — ${leave.request_number ?? "leave"}`,
        source_leave_request_id: leave.id,
      }));

    if (rows.length) {
      const ins = await client.from("timesheet_entries").insert(rows as never);
      if (ins.error) {
        skipped.push(weekStart);
        continue;
      }
      created += rows.length;
      await recomputeTotals(client, sheet.id);
    }
  }

  return { created, skipped_weeks: skipped };
}

/** Remove auto-created entries for a leave request; locked weeks are reported. */
export async function removeLeaveEntries(
  client: Client,
  leave: LeaveRow,
): Promise<{ removed: number; skipped_weeks: string[] }> {
  const { data, error } = await client
    .from("timesheet_entries")
    .select("id, timesheet_id, timesheets!inner(week_start, status)")
    .eq("source_leave_request_id", leave.id);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    timesheet_id: string;
    timesheets: { week_start: string; status: string };
  }>;

  const skipped = new Set<string>();
  const removable: string[] = [];
  const touched = new Set<string>();
  for (const row of rows) {
    if (row.timesheets.status !== "draft") {
      skipped.add(row.timesheets.week_start);
      continue;
    }
    removable.push(row.id);
    touched.add(row.timesheet_id);
  }

  if (removable.length) {
    const del = await client.from("timesheet_entries").delete().in("id", removable);
    if (del.error) throw del.error;
    for (const id of touched) await recomputeTotals(client, id);
  }

  return { removed: removable.length, skipped_weeks: [...skipped] };
}

export async function roleHolderIds(
  client: Client,
  companyId: string,
  roles: readonly string[],
): Promise<string[]> {
  const { data, error } = await client
    .from("user_roles")
    .select("user_id")
    .eq("company_id", companyId)
    .in("role", roles as never);
  if (error) return [];
  return [...new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id))];
}

export async function notifyUsers(
  client: Client,
  companyId: string,
  userIds: readonly string[],
  payload: { type: string; title: string; body: string; link: string },
): Promise<void> {
  if (!userIds.length) return;
  try {
    await client
      .from("notifications")
      .insert(userIds.map((user_id) => ({ company_id: companyId, user_id, ...payload })) as never);
  } catch {
    // notifications must never fail the mutation
  }
}

/** Server-side day recomputation — the client-supplied count is ignored. */
export function serverDays(dateFrom: string, dateTo: string): number {
  const days = countWorkingDays(dateFrom, dateTo);
  if (days <= 0) {
    httpError(422, "no_working_days", "That range contains no working days.");
  }
  return days;
}
