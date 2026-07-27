// P-219 — Pure rules for the ESG report approval + PDF flow (no IO, unit-tested).
import type { ComputedRow, EmissionTotals } from "@/lib/esg/carbon";

export const ESG_REPORT_RULE_KEY = "esg_report" as const;
export const ESG_REPORT_ENTITY = "esg_report" as const;
export const ESG_REPORT_EXPORT_TYPE = "esg_report" as const;

/** hse_admin then company_admin (matches the seeded chain in 0088). */
export const ESG_APPROVAL_CHAIN = ["hse_admin", "company_admin"] as const;
export const ESG_GENERATE_ROLES = ["hse_admin", "company_admin"] as const;
export const ESG_PUBLISH_ROLES = ["company_admin"] as const;

export const ESG_RULE_MISSING_MESSAGE = "ESG report approval rule is not configured";

export type EsgReportStatus = "draft" | "approved" | "published";

/** Storage location contract: {company_id}/esg/{report_id}.pdf */
export function esgReportPdfPath(companyId: string, reportId: string): string {
  return `${companyId}/esg/${reportId}.pdf`;
}

export function esgReportFilename(
  reportNumber: string | null,
  periodFrom: string,
  periodTo: string,
): string {
  const base = reportNumber ?? "ESG-report";
  return `${base}_${periodFrom}_${periodTo}.pdf`;
}

/** Human label for the pending approval step (1-based). */
export function approvalStageLabel(currentStep: number | null): string {
  const role = ESG_APPROVAL_CHAIN[Math.max(0, (currentStep ?? 1) - 1)];
  const pretty = role === "hse_admin" ? "HSE Admin" : "Company Admin";
  return `Pending approval — HSE then Company Admin (awaiting ${pretty})`;
}

export function canGenerate(status: EsgReportStatus, hasOpenInstance: boolean): boolean {
  return status === "draft" && !hasOpenInstance;
}

export function canPublish(status: EsgReportStatus, isCompanyAdmin: boolean): boolean {
  return status === "approved" && isCompanyAdmin;
}

export interface ScopeTableRow {
  category: string;
  quantity: string;
  unit: string;
  factor_code: string;
  factor_source: string;
  co2e_kg: number;
}

const num = (v: number, digits = 2): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(v);

/** One table per scope, each activity row carrying its factor citation. */
export function scopeTableRows(rows: readonly ComputedRow[], scope: string): ScopeTableRow[] {
  return rows
    .filter((r) => r.scope === scope)
    .map((r) => ({
      category: r.category,
      quantity: num(Number(r.quantity), 3),
      unit: r.unit,
      factor_code: r.factor_code,
      factor_source: r.factor_source,
      co2e_kg: r.co2e_kg,
    }));
}

export function scopeSubtotalKg(rows: readonly ScopeTableRow[]): number {
  return rows.reduce((s, r) => s + r.co2e_kg, 0);
}

export interface LenderIndicatorRow {
  indicator: string;
  value: string;
  formula: string;
}

export interface LenderIndicatorInput {
  totals: EmissionTotals;
  avoidedKg: number | null;
  netKg: number;
  meteredMwh: number | null;
  intensity: number | null;
  diversionPct: number | null;
  trir: number | null;
}

const NA = "n/a";
const t = (kg: number | null): string => (kg == null ? NA : `${num(kg / 1000)} t CO2e`);

/** The seven P-218 lender KPIs, each with its formula, for the PDF table. */
export function lenderIndicatorRows(i: LenderIndicatorInput): LenderIndicatorRow[] {
  const gross = i.totals.scope_1_kg + i.totals.scope_2_kg + i.totals.scope_3_kg;
  return [
    { indicator: "Gross emissions", value: t(gross), formula: "scope 1 + scope 2 + scope 3" },
    {
      indicator: "Scope 1 (direct)",
      value: t(i.totals.scope_1_kg),
      formula: "Σ quantity × factor",
    },
    {
      indicator: "Scope 2 (purchased energy)",
      value: t(i.totals.scope_2_kg),
      formula: "Σ quantity × factor",
    },
    {
      indicator: "Scope 3 (value chain)",
      value: t(i.totals.scope_3_kg),
      formula: "Σ quantity × factor",
    },
    {
      indicator: "Avoided emissions",
      value: t(i.avoidedKg),
      formula: "metered MWh × 1000 × grid factor",
    },
    { indicator: "Net emissions", value: t(i.netKg), formula: "gross − avoided" },
    {
      indicator: "Carbon intensity",
      value: i.intensity == null ? NA : `${num(i.intensity, 3)} kg CO2e/MWh`,
      formula: "gross kg ÷ metered MWh",
    },
    {
      indicator: "Renewable generation",
      value: i.meteredMwh == null ? NA : `${num(i.meteredMwh)} MWh`,
      formula: "Σ metered energy telemetry",
    },
    {
      indicator: "Waste diversion",
      value: i.diversionPct == null ? NA : `${num(i.diversionPct, 1)} %`,
      formula: "recyclable kg ÷ total waste kg",
    },
    {
      indicator: "TRIR",
      value: i.trir == null ? NA : num(i.trir, 2),
      formula: "recordables × 200,000 ÷ hours worked",
    },
  ];
}
