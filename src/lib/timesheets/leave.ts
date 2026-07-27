// P-230 — Leave management pure helpers. PURE module: no React, no Supabase.
import { TIMESHEET_POLICY, type TimesheetActivity } from "@/lib/timesheets/policy";
import { isoDayOfWeek } from "@/lib/timesheets/week";

const DAY_MS = 24 * 60 * 60 * 1000;

export type LeaveType = "annual" | "sick" | "unpaid" | "travel";

export const LEAVE_TYPES: readonly LeaveType[] = ["annual", "sick", "unpaid", "travel"];

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  unpaid: "Unpaid leave",
  travel: "Travel",
};

/** Activity written onto the auto-created timesheet entries. */
export const LEAVE_ACTIVITY: Record<LeaveType, TimesheetActivity> = {
  annual: "leave_annual",
  sick: "leave_sick",
  unpaid: "leave_unpaid",
  travel: "travel",
};

/** Only annual and sick draw down a balance; unpaid and travel do not. */
export function balanceColumnFor(type: LeaveType): "annual_used_days" | "sick_used_days" | null {
  if (type === "annual") return "annual_used_days";
  if (type === "sick") return "sick_used_days";
  return null;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The actual workday dates covered by an inclusive range, excluding the
 * configured weekend (ISO day-of-week; Jordan Friday/Saturday by default).
 */
export function workingDaysInRange(
  dateFrom: string,
  dateTo: string,
  weekendDays: readonly number[] = TIMESHEET_POLICY.weekendDays,
): string[] {
  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateTo < dateFrom) return [];
  const out: string[] = [];
  let cursor = new Date(`${dateFrom}T00:00:00Z`).getTime();
  const end = new Date(`${dateTo}T00:00:00Z`).getTime();
  // Hard stop so a pathological range can never spin the server.
  for (let guard = 0; cursor <= end && guard < 1000; guard += 1) {
    const iso = new Date(cursor).toISOString().slice(0, 10);
    if (!weekendDays.includes(isoDayOfWeek(iso))) out.push(iso);
    cursor += DAY_MS;
  }
  return out;
}

/** Inclusive weekday count for a range, weekends excluded. */
export function countWorkingDays(
  dateFrom: string,
  dateTo: string,
  weekendDays: readonly number[] = TIMESHEET_POLICY.weekendDays,
): number {
  return workingDaysInRange(dateFrom, dateTo, weekendDays).length;
}

/** Inclusive overlap test on two ISO date ranges — `[]` bounds, like Postgres daterange. */
export function rangesOverlap(
  aFrom: string,
  aTo: string,
  bFrom: string,
  bTo: string,
): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}

export function describeWorkingDays(days: number): string {
  return `${days} working ${days === 1 ? "day" : "days"}, weekends excluded`;
}

/** Strip anything that could escape the company storage prefix. */
export function safeLeaveFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.slice(0, 180) || "file";
}

/** Company-UUID-first path inside the shared `documents` bucket. */
export function leaveAttachmentPath(
  companyId: string,
  userId: string,
  leaveRequestId: string,
  filename: string,
): string {
  return `${companyId}/leave/${userId}/${leaveRequestId}/${safeLeaveFileName(filename)}`;
}

export function isInsideLeavePrefix(path: string, companyId: string): boolean {
  const prefix = `${companyId}/leave/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).includes("..");
}

export const LEAVE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
export const LEAVE_ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export function validateLeaveFile(file: { size: number; type: string }): string | null {
  if (!file.size) return "file_required";
  if (file.size > LEAVE_UPLOAD_MAX_BYTES) return "file_too_large";
  if (!(LEAVE_ALLOWED_MIME as readonly string[]).includes(file.type)) return "invalid_mime";
  return null;
}

export interface BalanceSummary {
  entitlement: number;
  annualUsed: number;
  remaining: number;
  sickUsed: number;
}

export function summariseBalance(row: {
  annual_entitlement_days?: number | null;
  annual_used_days?: number | null;
  sick_used_days?: number | null;
} | null): BalanceSummary {
  const entitlement = Number(
    row?.annual_entitlement_days ?? TIMESHEET_POLICY.defaultAnnualEntitlementDays,
  );
  const annualUsed = Number(row?.annual_used_days ?? 0);
  const sickUsed = Number(row?.sick_used_days ?? 0);
  return {
    entitlement,
    annualUsed,
    remaining: Math.round((entitlement - annualUsed) * 100) / 100,
    sickUsed,
  };
}
