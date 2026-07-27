// P-231 — Server-only reporting/labor helpers. Kept out of *.functions.ts so
// the createServerFn split transform can never drop a runtime sibling.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { assertExportAllowed, type ExportType } from "@/lib/export-guard";
import {
  aggregateLaborActuals,
  type RateContext,
  type ReportEntry,
  yearRange,
} from "@/lib/timesheets/reports";

export type Client = SupabaseClient<Database>;

const MISSING_OBJECT = new Set(["42P01", "42883", "42703"]);

export function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return !!code && MISSING_OBJECT.has(code);
}

/** Fail-open wrapper: missing DB objects log and return the fallback. */
export async function guarded<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isMissingObject(err)) {
      console.warn(
        JSON.stringify({ scope: "timesheet-reports", label, degraded: true, code: (err as { code?: string }).code }),
      );
      return fallback;
    }
    throw err;
  }
}

export interface ReportFilters {
  from: string;
  to: string;
  project_id?: string | null;
  user_id?: string | null;
  statuses?: readonly string[];
}

/** Approved-by-default entry load. Every filter is applied server-side. */
export async function loadReportEntries(
  client: Client,
  filters: ReportFilters,
): Promise<ReportEntry[]> {
  const statuses = filters.statuses ?? ["approved"];
  let sheetQuery = client
    .from("timesheets")
    .select("id, user_id, week_start, status")
    .in("status", statuses as unknown as never[]);
  if (filters.user_id) sheetQuery = sheetQuery.eq("user_id", filters.user_id);
  const sheets = await sheetQuery.limit(5000);
  if (sheets.error) throw sheets.error;
  const sheetRows = (sheets.data ?? []) as Array<{
    id: string;
    user_id: string;
    week_start: string;
    status: string;
  }>;
  if (sheetRows.length === 0) return [];
  const byId = new Map(sheetRows.map((s) => [s.id, s]));

  const out: ReportEntry[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    let q = client
      .from("timesheet_entries")
      .select("timesheet_id, work_date, project_id, cwp_id, activity, hours, hourly_rate")
      .in("timesheet_id", ids.slice(i, i + 200))
      .gte("work_date", filters.from)
      .lte("work_date", filters.to);
    if (filters.project_id) q = q.eq("project_id", filters.project_id);
    const { data, error } = await q.limit(20000);
    if (error) throw error;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const sheet = byId.get(row.timesheet_id as string);
      if (!sheet) continue;
      out.push({
        timesheet_id: row.timesheet_id as string,
        user_id: sheet.user_id,
        week_start: sheet.week_start,
        status: sheet.status,
        work_date: row.work_date as string,
        project_id: (row.project_id as string | null) ?? null,
        cwp_id: (row.cwp_id as string | null) ?? null,
        activity: row.activity as string,
        hours: Number(row.hours ?? 0),
        hourly_rate: row.hourly_rate == null ? null : Number(row.hourly_rate),
      });
    }
  }
  return out;
}

export async function loadRateContext(
  client: Client,
  entries: ReportEntry[],
): Promise<RateContext & { people: Record<string, string> }> {
  const userIds = [...new Set(entries.map((e) => e.user_id))];
  const cwpIds = [...new Set(entries.map((e) => e.cwp_id).filter(Boolean))] as string[];

  const defaultRates: Record<string, number | null> = {};
  const people: Record<string, string> = {};
  if (userIds.length) {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, default_hourly_rate")
      .in("id", userIds);
    if (error) throw error;
    for (const p of (data ?? []) as Array<{
      id: string;
      full_name: string | null;
      default_hourly_rate: number | null;
    }>) {
      defaultRates[p.id] = p.default_hourly_rate == null ? null : Number(p.default_hourly_rate);
      people[p.id] = p.full_name?.trim() || "Team member";
    }
  }

  // CWP discipline lookup is 42P01-guarded → everything collapses to general.
  const disciplines = await guarded<Record<string, string | null>>(
    "cwp_disciplines",
    async () => {
      if (!cwpIds.length) return {};
      const { data, error } = await client
        .from("construction_work_packages")
        .select("id, discipline")
        .in("id", cwpIds);
      if (error) throw error;
      const map: Record<string, string | null> = {};
      for (const c of (data ?? []) as Array<{ id: string; discipline: string | null }>) {
        map[c.id] = c.discipline;
      }
      return map;
    },
    {},
  );

  return { defaultRates, disciplines, people };
}

export async function loadProjectNames(
  client: Client,
  projectIds: string[],
): Promise<Record<string, string>> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await client
    .from("projects")
    .select("id, name, code")
    .in("id", ids);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{
    id: string;
    name: string | null;
    code: string | null;
  }>) {
    map[p.id] = p.name?.trim() || p.code || p.id;
  }
  return map;
}

export async function countBacklog(client: Client, projectId?: string | null): Promise<number> {
  let q = client.from("timesheets").select("id", { count: "exact", head: true }).eq("status", "in_review");
  if (projectId) q = q.eq("project_id", projectId);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

export async function leaveDaysYtd(client: Client, today = new Date()): Promise<number> {
  const { from, to } = yearRange(today);
  return guarded(
    "leave_ytd",
    async () => {
      const { data, error } = await client
        .from("leave_requests")
        .select("days")
        .eq("status", "approved")
        .gte("date_from", from)
        .lte("date_from", to)
        .limit(5000);
      if (error) throw error;
      return (data ?? []).reduce(
        (s: number, r: { days: number | null }) => s + (Number(r.days) || 0),
        0,
      );
    },
    0,
  );
}

/**
 * Batch export-lock check. Each project is asserted individually; a 423 from
 * any project propagates. Missing lock tables fail open inside
 * assertExportAllowed itself.
 */
export async function assertProjectsExportable(
  client: Client,
  projectIds: (string | null)[],
  exportType: ExportType,
): Promise<void> {
  const ids = [...new Set(projectIds.filter(Boolean))] as string[];
  for (const id of ids) {
    await assertExportAllowed(client as unknown as SupabaseClient, id, exportType);
  }
}

/**
 * P-231 — Preferred labor actuals source: approved timesheet entries.
 * Returns null when the timesheet tables are absent (42P01) or when there are
 * zero approved rows, so callers can fall back to their legacy path unchanged.
 */
export async function loadTimesheetLaborCost(
  client: Client,
  projectId: string,
  range?: { from: string; to: string },
): Promise<number | null> {
  return guarded<number | null>(
    "labor_cost",
    async () => {
      const entries = await loadReportEntries(client, {
        from: range?.from ?? "1900-01-01",
        to: range?.to ?? "2999-12-31",
        project_id: projectId,
        statuses: ["approved"],
      });
      if (entries.length === 0) return null;
      const ctx = await loadRateContext(client, entries);
      const { labor_cost } = aggregateLaborActuals(projectId, "", entries, ctx);
      return labor_cost > 0 ? labor_cost : null;
    },
    null,
  );
}
