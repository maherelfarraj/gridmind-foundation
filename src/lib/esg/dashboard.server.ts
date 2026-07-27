// P-218 — Server-only IO for the ESG dashboard. Every dependency table that is
// missing (42P01) degrades its widget to "n/a" instead of failing the page.
import type { Client } from "@/lib/cwp.server";
import { isMissingRelation } from "@/lib/esg/activity.server";
import {
  DEFAULT_GRID_FACTOR_KG_PER_KWH,
  resolveFactor,
  type CarbonActivity,
  type CarbonFactor,
} from "@/lib/esg/carbon";
import { computeTrir } from "@/lib/hse.rules";

export type ProjectRef = { id: string; name: string; code: string | null };

export async function listCompanyProjects(
  client: Client,
  companyId: string,
): Promise<ProjectRef[]> {
  const { data, error } = await client
    .from("projects")
    .select("id, name, code")
    .eq("company_id", companyId)
    .order("name", { ascending: true })
    .limit(500);
  if (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
  return (data ?? []) as ProjectRef[];
}

export async function loadDashboardActivities(
  client: Client,
  companyId: string,
  projectId: string | null,
  periodFrom: string,
  periodTo: string,
): Promise<{ available: boolean; rows: CarbonActivity[] }> {
  let q = client
    .from("esg_activities")
    .select("id, act_number, category, quantity, unit, period_month, source")
    .eq("company_id", companyId)
    .gte("period_month", periodFrom)
    .lte("period_month", periodTo)
    .limit(10000);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return { available: false, rows: [] };
    throw error;
  }
  return { available: true, rows: (data ?? []) as unknown as CarbonActivity[] };
}

/** Metered kWh per YYYY-MM; null when telemetry is missing or has no rows. */
export async function monthlyMeteredKwh(
  client: Client,
  projectIds: readonly string[] | null,
  periodFrom: string,
  periodTo: string,
): Promise<Record<string, number> | null> {
  let q = client
    .from("scada_telemetry")
    .select("ts, value")
    .eq("metric", "energy_kwh")
    .gte("ts", `${periodFrom}T00:00:00Z`)
    .lte("ts", `${periodTo}T23:59:59Z`)
    .limit(50000);
  if (projectIds) {
    if (projectIds.length === 0) return null;
    q = q.in("project_id", projectIds);
  }
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  const rows = (data ?? []) as Array<{ ts: string; value: number | null }>;
  if (rows.length === 0) return null;
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = String(r.ts).slice(0, 7);
    out[key] = (out[key] ?? 0) + Number(r.value ?? 0);
  }
  return out;
}

/** Avoided kg per month = metered kWh × grid factor valid that month. */
export function monthlyAvoidedKg(
  monthlyKwh: Record<string, number> | null,
  factors: readonly CarbonFactor[],
): Record<string, number> | null {
  if (!monthlyKwh) return null;
  const out: Record<string, number> = {};
  for (const [month, kwh] of Object.entries(monthlyKwh)) {
    const factor = resolveFactor("electricity_grid", `${month}-01`, factors);
    out[month] = kwh * (factor?.kg_co2e_per_unit ?? DEFAULT_GRID_FACTOR_KG_PER_KWH);
  }
  return out;
}

export type WasteSummary = {
  available: boolean;
  recyclable_kg: number;
  total_kg: number;
};

export async function loadWasteSummary(
  client: Client,
  companyId: string,
  projectId: string | null,
  periodFrom: string,
  periodTo: string,
): Promise<WasteSummary> {
  let q = client
    .from("waste_tracking")
    .select("waste_type, qty, uom")
    .eq("company_id", companyId)
    .gte("disposal_date", periodFrom)
    .lte("disposal_date", periodTo)
    .limit(5000);
  if (projectId) q = q.eq("project_id", projectId);
  const { data, error } = await q;
  if (error) {
    if (isMissingRelation(error)) return { available: false, recyclable_kg: 0, total_kg: 0 };
    throw error;
  }
  const rows = (data ?? []) as Array<{ waste_type: string; qty: number | null; uom: string }>;
  let recyclable = 0;
  let total = 0;
  for (const r of rows) {
    const kg = toKg(Number(r.qty ?? 0), r.uom);
    total += kg;
    if (String(r.waste_type).toLowerCase().includes("recycl")) recyclable += kg;
  }
  return { available: true, recyclable_kg: recyclable, total_kg: total };
}

export function toKg(qty: number, uom: string): number {
  const u = String(uom ?? "").toLowerCase();
  if (u === "t" || u === "ton" || u === "tonne" || u === "tonnes") return qty * 1000;
  return qty;
}

export type TrirSummary = {
  available: boolean;
  trir: number | null;
  recordables: number;
  hours: number;
};

export async function loadTrir(
  client: Client,
  companyId: string,
  projectId: string | null,
  periodFrom: string,
  periodTo: string,
): Promise<TrirSummary> {
  let incQ = client
    .from("hse_incidents")
    .select("osha_recordable")
    .eq("company_id", companyId)
    .gte("occurred_at", `${periodFrom}T00:00:00Z`)
    .lte("occurred_at", `${periodTo}T23:59:59Z`)
    .limit(5000);
  if (projectId) incQ = incQ.eq("project_id", projectId);

  let mpQ = client
    .from("manpower_logs")
    .select("hours, construction_daily_reports!inner(project_id, report_date, company_id)")
    .eq("construction_daily_reports.company_id", companyId)
    .gte("construction_daily_reports.report_date", periodFrom)
    .lte("construction_daily_reports.report_date", periodTo)
    .limit(20000);
  if (projectId) mpQ = mpQ.eq("construction_daily_reports.project_id", projectId);

  const [inc, mp] = await Promise.all([incQ, mpQ]);
  if (inc.error && !isMissingRelation(inc.error)) throw inc.error;
  if (mp.error && !isMissingRelation(mp.error)) throw mp.error;
  if (inc.error || mp.error) {
    return { available: false, trir: null, recordables: 0, hours: 0 };
  }
  const recordables = ((inc.data ?? []) as Array<{ osha_recordable: boolean | null }>).filter(
    (r) => r.osha_recordable,
  ).length;
  const hours = ((mp.data ?? []) as Array<{ hours: number | null }>).reduce(
    (sum, r) => sum + Number(r.hours ?? 0),
    0,
  );
  return { available: true, trir: computeTrir(recordables, hours), recordables, hours };
}
