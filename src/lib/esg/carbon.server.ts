// P-217 — Server-only IO for the carbon engine. Kept out of *.functions.ts so
// the server-fn split transform cannot drop siblings.
import type { Client } from "@/lib/cwp.server";
import { httpError } from "@/lib/cwp.server";
import { isMissingRelation } from "@/lib/esg/activity.server";
import type { CarbonActivity, CarbonFactor, ReportTotals } from "@/lib/esg/carbon";

export async function loadCarbonFactors(
  client: Client,
  companyId: string,
): Promise<CarbonFactor[]> {
  const { data, error } = await client
    .from("esg_emission_factors")
    .select(
      "id, company_id, category, unit, kg_co2e_per_unit, factor_code, factor_source, valid_from, valid_to",
    )
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as unknown as CarbonFactor[];
}

export async function loadPeriodActivities(
  client: Client,
  projectId: string,
  periodFrom: string,
  periodTo: string,
): Promise<CarbonActivity[]> {
  const { data, error } = await client
    .from("esg_activities")
    .select("id, act_number, category, quantity, unit, period_month, source")
    .eq("project_id", projectId)
    .gte("period_month", periodFrom)
    .lte("period_month", periodTo)
    .order("period_month", { ascending: true })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as unknown as CarbonActivity[];
}

/** Metered renewable energy for the period; null when telemetry is absent. */
export async function sumMeteredEnergyKwh(
  client: Client,
  projectId: string,
  periodFrom: string,
  periodTo: string,
): Promise<number | null> {
  const { data, error } = await client
    .from("scada_telemetry")
    .select("value")
    .eq("project_id", projectId)
    .eq("metric", "energy_kwh")
    .gte("ts", `${periodFrom}T00:00:00Z`)
    .lt("ts", `${periodTo}T00:00:00Z`)
    .limit(50000);
  if (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
  const rows = (data ?? []) as Array<{ value: number | null }>;
  if (rows.length === 0) return null;
  return rows.reduce((sum, r) => sum + Number(r.value ?? 0), 0);
}

export type EsgReportRow = {
  id: string;
  company_id: string;
  project_id: string;
  period_from: string;
  period_to: string;
  status: "draft" | "approved" | "published";
  totals: ReportTotals;
  row_count: number;
  methodology_note: string | null;
  generated_at: string;
};

export async function findReport(
  client: Client,
  companyId: string,
  projectId: string,
  periodFrom: string,
  periodTo: string,
): Promise<EsgReportRow | null> {
  const { data, error } = await client
    .from("esg_reports")
    .select("*")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("period_from", periodFrom)
    .eq("period_to", periodTo)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as EsgReportRow) ?? null;
}

export function assertRecomputable(report: EsgReportRow | null): void {
  if (report && report.status !== "draft") {
    httpError(
      409,
      "report_locked",
      `Report is ${report.status} — regenerate requires a new report`,
    );
  }
}

export async function upsertDraftReport(
  client: Client,
  args: {
    existingId: string | null;
    companyId: string;
    projectId: string;
    periodFrom: string;
    periodTo: string;
    totals: ReportTotals;
    rowCount: number;
    methodologyNote: string;
    userId: string;
  },
): Promise<EsgReportRow> {
  const payload = {
    company_id: args.companyId,
    project_id: args.projectId,
    period_from: args.periodFrom,
    period_to: args.periodTo,
    status: "draft",
    totals: args.totals,
    row_count: args.rowCount,
    methodology_note: args.methodologyNote,
    generated_by: args.userId,
    generated_at: new Date().toISOString(),
  };
  const query = args.existingId
    ? client
        .from("esg_reports")
        .update(payload as never)
        .eq("id", args.existingId)
    : client.from("esg_reports").insert(payload as never);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw error;
  return data as unknown as EsgReportRow;
}
