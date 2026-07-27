// P-217 — Pure carbon computation engine.
// NO React, NO Supabase imports: this module must stay offline-testable.

export type EsgScope = "scope_1" | "scope_2" | "scope_3";

export const ESG_METHODOLOGY_NOTE =
  "Computed from recorded activity data and stated emission factors; not a verified third-party GHG audit.";

export const ESG_FORMULA_TOOLTIP = {
  emissions: "CO2e = activity quantity × emission factor (source shown per row)",
  avoided: "Avoided = metered kWh × grid emission factor",
  net: "Net = scopes 1+2+3 − avoided",
} as const;

/** Jordan grid default, company-overridable via an electricity_grid factor. */
export const DEFAULT_GRID_FACTOR_KG_PER_KWH = 0.55;

/** Mirrors the esg_emission_factors_scope_matches_category CHECK constraint. */
export const CATEGORY_SCOPE: Record<string, EsgScope> = {
  fuel_diesel: "scope_1",
  fuel_petrol: "scope_1",
  fuel_lpg: "scope_1",
  electricity_grid: "scope_2",
  electricity_generator: "scope_3",
  transport_road: "scope_3",
  transport_air: "scope_3",
  transport_sea: "scope_3",
  materials_concrete: "scope_3",
  materials_steel: "scope_3",
  materials_cable: "scope_3",
  waste_general: "scope_3",
  waste_hazardous: "scope_3",
  waste_recyclable: "scope_3",
  other: "scope_3",
};

export function scopeOf(category: string): EsgScope {
  return CATEGORY_SCOPE[category] ?? "scope_3";
}

export type CarbonFactor = {
  id: string;
  company_id: string | null;
  category: string;
  unit: string;
  kg_co2e_per_unit: number;
  factor_code: string;
  factor_source: string;
  valid_from: string;
  valid_to: string | null;
};

export type CarbonActivity = {
  id: string;
  act_number?: string;
  category: string;
  quantity: number;
  unit: string;
  period_month: string;
  source?: string;
};

export type ComputedRow = CarbonActivity & {
  co2e_kg: number;
  scope: EsgScope;
  factor_code: string;
  factor_source: string;
  factor_unit: string;
  kg_co2e_per_unit: number;
};

export type UnfactoredRow = CarbonActivity & { reason: "no_factor" };

export type EmissionTotals = {
  scope_1_kg: number;
  scope_2_kg: number;
  scope_3_kg: number;
};

/**
 * Pick the factor covering `date`: company override beats global, latest
 * valid_from wins ties. An expired company factor falls back to a still-valid
 * global one. Returns null when nothing matches (never silently zero).
 */
export function resolveFactor(
  category: string,
  date: string,
  factors: readonly CarbonFactor[],
): CarbonFactor | null {
  const day = date.slice(0, 10);
  const candidates = factors.filter(
    (f) =>
      f.category === category &&
      f.valid_from.slice(0, 10) <= day &&
      (f.valid_to === null || f.valid_to.slice(0, 10) > day),
  );
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const scope = Number(Boolean(b.company_id)) - Number(Boolean(a.company_id));
    if (scope !== 0) return scope;
    return b.valid_from.slice(0, 10).localeCompare(a.valid_from.slice(0, 10));
  });
  return ranked[0];
}

export function computeEmissions(
  activityRows: readonly CarbonActivity[],
  factors: readonly CarbonFactor[],
): {
  rows: ComputedRow[];
  totals: EmissionTotals;
  unfactored: UnfactoredRow[];
} {
  const rows: ComputedRow[] = [];
  const unfactored: UnfactoredRow[] = [];
  const totals: EmissionTotals = { scope_1_kg: 0, scope_2_kg: 0, scope_3_kg: 0 };

  for (const row of activityRows) {
    const factor = resolveFactor(row.category, row.period_month, factors);
    if (!factor) {
      unfactored.push({ ...row, reason: "no_factor" });
      continue;
    }
    const scope = scopeOf(row.category);
    const co2e = Number(row.quantity) * Number(factor.kg_co2e_per_unit);
    rows.push({
      ...row,
      co2e_kg: co2e,
      scope,
      factor_code: factor.factor_code,
      factor_source: factor.factor_source,
      factor_unit: factor.unit,
      kg_co2e_per_unit: Number(factor.kg_co2e_per_unit),
    });
    totals[`${scope}_kg` as keyof EmissionTotals] += co2e;
  }

  return { rows, totals, unfactored };
}

export function computeAvoided(
  energyKwh: number,
  gridFactorKgPerKwh: number = DEFAULT_GRID_FACTOR_KG_PER_KWH,
): { avoided_kg: number } {
  return { avoided_kg: Number(energyKwh) * Number(gridFactorKgPerKwh) };
}

export function netEmissions(
  totals: EmissionTotals,
  avoidedKg: number | null,
): { net_kg: number; net_negative: boolean } {
  const gross = totals.scope_1_kg + totals.scope_2_kg + totals.scope_3_kg;
  const net = gross - (avoidedKg ?? 0);
  return { net_kg: net, net_negative: net < 0 };
}

export type ReportTotals = EmissionTotals & {
  avoided_kg: number | null;
  net_kg: number;
  net_negative: boolean;
  unfactored_count: number;
  note?: "no_metered_data";
};

export function buildReportTotals(args: {
  totals: EmissionTotals;
  avoidedKg: number | null;
  unfactoredCount: number;
}): ReportTotals {
  const net = netEmissions(args.totals, args.avoidedKg);
  return {
    ...args.totals,
    avoided_kg: args.avoidedKg,
    net_kg: net.net_kg,
    net_negative: net.net_negative,
    unfactored_count: args.unfactoredCount,
    ...(args.avoidedKg === null ? { note: "no_metered_data" as const } : {}),
  };
}

export function formatKgCo2e(kg: number): string {
  if (Math.abs(kg) >= 1000) {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(kg / 1000)} tCO2e`;
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(kg)} kgCO2e`;
}
