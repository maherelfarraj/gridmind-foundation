// P-218 — Pure math + copy for the ESG dashboard. No React, no Supabase.
import {
  computeEmissions,
  netEmissions,
  scopeOf,
  type CarbonActivity,
  type CarbonFactor,
  type ComputedRow,
  type EmissionTotals,
  type EsgScope,
} from "@/lib/esg/carbon";

export const ESG_DASHBOARD_EMPTY =
  "No ESG data yet — record activity in /esg/activity and compute a report.";

export const ESG_TOOLTIP = {
  scope_1: "Σ activity × factor, fuel categories (esg_activities × esg_emission_factors)",
  scope_2:
    "Σ activity × factor, purchased electricity (esg_activities × esg_emission_factors)",
  scope_3:
    "Σ activity × factor, transport / materials / waste (esg_activities × esg_emission_factors)",
  avoided: "Avoided = metered kWh × grid factor (scada_telemetry × esg_emission_factors)",
  net: "Net = scopes 1+2+3 − avoided",
  intensity:
    "Intensity = (scope 1+2+3 kg CO2e) ÷ MWh generated, where MWh = Σ scada_telemetry.energy_kwh ÷ 1000",
  donut: "Share of gross emissions per scope = scope kg ÷ (s1+s2+s3)",
  trend: "Monthly Σ activity × factor per scope; dashed line = avoided (metered kWh × grid factor)",
  category: "Σ activity × factor grouped by esg_factor_category",
  total_ghg: "Total GHG = (scope 1 + scope 2 + scope 3) ÷ 1000 tCO2e",
  avoided_t: "Avoided = (metered kWh × grid factor) ÷ 1000 tCO2e",
  renewable: "Renewable generation = Σ scada_telemetry.energy_kwh ÷ 1000 MWh",
  renewable_share:
    "% renewable = project renewable MWh ÷ total portfolio generation MWh (scada_telemetry)",
  water: "Water usage is not tracked — no water metric exists in environmental_monitoring",
  diversion: "Diversion rate = recyclable kg ÷ total waste kg (waste_tracking) in period",
  trir: "TRIR = (OSHA recordable incidents × 200,000) ÷ manpower hours (hse_incidents, manpower_logs)",
} as const;

export const NA = "n/a" as const;

export type NaReason =
  | "no_metered_data"
  | "table_missing"
  | "single_project"
  | "not_tracked"
  | "no_hours"
  | "no_waste_data";

export const NA_REASON_LABEL: Record<NaReason, string> = {
  no_metered_data: "n/a — no metered data",
  table_missing: "n/a — source data unavailable",
  single_project: "n/a — single project in scope",
  not_tracked: "not tracked",
  no_hours: "n/a — no manpower hours logged",
  no_waste_data: "n/a — no waste logged in period",
};

export type MonthPoint = {
  month: string;
  scope_1_kg: number;
  scope_2_kg: number;
  scope_3_kg: number;
  avoided_kg: number | null;
};

export type CategoryPoint = { category: string; kg: number };

export type ScopeSharePoint = { scope: EsgScope; kg: number; share: number };

/** Month keys (YYYY-MM) spanned by the period, inclusive. */
export function monthKeysBetween(periodFrom: string, periodTo: string): string[] {
  const [fy, fm] = periodFrom.slice(0, 7).split("-").map(Number);
  const [ty, tm] = periodTo.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function grossKg(totals: EmissionTotals): number {
  return totals.scope_1_kg + totals.scope_2_kg + totals.scope_3_kg;
}

export function scopeShare(totals: EmissionTotals): ScopeSharePoint[] {
  const gross = grossKg(totals);
  return (["scope_1", "scope_2", "scope_3"] as const).map((scope) => {
    const kg = totals[`${scope}_kg` as keyof EmissionTotals];
    return { scope, kg, share: gross > 0 ? kg / gross : 0 };
  });
}

/** Monthly stacked scopes; avoided spread evenly across months with metered data. */
export function monthlySeries(
  rows: readonly ComputedRow[],
  months: readonly string[],
  monthlyAvoidedKg: Readonly<Record<string, number>> | null,
): MonthPoint[] {
  const index = new Map<string, MonthPoint>();
  for (const month of months) {
    index.set(month, {
      month,
      scope_1_kg: 0,
      scope_2_kg: 0,
      scope_3_kg: 0,
      avoided_kg: monthlyAvoidedKg ? (monthlyAvoidedKg[month] ?? 0) : null,
    });
  }
  for (const row of rows) {
    const key = row.period_month.slice(0, 7);
    const point = index.get(key);
    if (!point) continue;
    point[`${row.scope}_kg` as "scope_1_kg"] += row.co2e_kg;
  }
  return months.map((m) => index.get(m)!);
}

export function categoryTotals(rows: readonly ComputedRow[]): CategoryPoint[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.category, (map.get(row.category) ?? 0) + row.co2e_kg);
  }
  return [...map.entries()]
    .map(([category, kg]) => ({ category, kg }))
    .sort((a, b) => b.kg - a.kg);
}

/** kg CO2e per MWh generated; null when there is no metered energy. */
export function carbonIntensity(
  totals: EmissionTotals,
  meteredKwh: number | null,
): number | null {
  if (meteredKwh === null) return null;
  const mwh = meteredKwh / 1000;
  if (mwh <= 0) return null;
  return grossKg(totals) / mwh;
}

export function kwhToMwh(kwh: number | null): number | null {
  return kwh === null ? null : kwh / 1000;
}

export function diversionRate(
  recyclableKg: number,
  totalKg: number,
): { pct: number | null; reason?: NaReason } {
  if (totalKg <= 0) return { pct: null, reason: "no_waste_data" };
  return { pct: (recyclableKg / totalKg) * 100 };
}

export function renewableShare(
  projectMwh: number | null,
  portfolioMwh: number | null,
  projectCount: number,
): { pct: number | null; reason?: NaReason } {
  if (projectMwh === null || portfolioMwh === null) {
    return { pct: null, reason: "no_metered_data" };
  }
  if (projectCount <= 1) return { pct: null, reason: "single_project" };
  if (portfolioMwh <= 0) return { pct: null, reason: "no_metered_data" };
  return { pct: (projectMwh / portfolioMwh) * 100 };
}

// ---------------------------------------------------------------------------
// Formatting — Intl only, kg with 0 decimals, tonnes with 1.
// ---------------------------------------------------------------------------
const KG_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const T_FMT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const PCT_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export function fmtKg(kg: number | null, reason: NaReason = "no_metered_data"): string {
  if (kg === null) return NA_REASON_LABEL[reason];
  return `${KG_FMT.format(kg)} kg CO2e`;
}

export function fmtTonnes(kg: number | null, reason: NaReason = "no_metered_data"): string {
  if (kg === null) return NA_REASON_LABEL[reason];
  return `${T_FMT.format(kg / 1000)} t CO2e`;
}

export function fmtMwh(mwh: number | null, reason: NaReason = "no_metered_data"): string {
  if (mwh === null) return NA_REASON_LABEL[reason];
  return `${T_FMT.format(mwh)} MWh`;
}

export function fmtPct(pct: number | null, reason: NaReason = "no_metered_data"): string {
  if (pct === null) return NA_REASON_LABEL[reason];
  return `${PCT_FMT.format(pct)}%`;
}

export function fmtIntensity(value: number | null, reason: NaReason = "no_metered_data"): string {
  if (value === null) return NA_REASON_LABEL[reason];
  return `${KG_FMT.format(value)} kg CO2e/MWh`;
}

export function fmtTrir(trir: number | null, reason: NaReason = "no_hours"): string {
  if (trir === null) return NA_REASON_LABEL[reason];
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(trir);
}

/** Convenience wrapper used by the server fn so the shape stays testable. */
export function buildDashboard(args: {
  activities: readonly CarbonActivity[];
  factors: readonly CarbonFactor[];
  months: readonly string[];
  monthlyAvoidedKg: Record<string, number> | null;
  meteredKwh: number | null;
}) {
  const emissions = computeEmissions(args.activities, args.factors);
  const avoided =
    args.monthlyAvoidedKg === null
      ? null
      : Object.values(args.monthlyAvoidedKg).reduce((s, v) => s + v, 0);
  const net = netEmissions(emissions.totals, avoided);
  return {
    totals: emissions.totals,
    gross_kg: grossKg(emissions.totals),
    avoided_kg: avoided,
    net_kg: net.net_kg,
    net_negative: net.net_negative,
    unfactored_count: emissions.unfactored.length,
    activity_count: emissions.rows.length + emissions.unfactored.length,
    scope_share: scopeShare(emissions.totals),
    monthly: monthlySeries(emissions.rows, args.months, args.monthlyAvoidedKg),
    by_category: categoryTotals(emissions.rows),
    intensity: carbonIntensity(emissions.totals, args.meteredKwh),
  };
}

export { scopeOf };
export type { EmissionTotals, EsgScope };
