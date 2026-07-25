// P-077 — Cash-flow rules: period normalization, pivot, cumulative, KPIs.
import { z } from "zod";

export const CASH_FLOW_CATEGORIES = [
  "milestone_billing",
  "po_payment",
  "payroll",
  "equipment",
  "other",
] as const;
export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];

export const CASH_FLOW_DIRECTIONS = ["inflow", "outflow"] as const;
export type CashFlowDirection = (typeof CASH_FLOW_DIRECTIONS)[number];

export const CASH_FLOW_KINDS = ["forecast", "actual"] as const;
export type CashFlowKind = (typeof CASH_FLOW_KINDS)[number];

export const CASH_FLOW_REFERENCE_TYPES = [
  "invoice",
  "purchase_order",
  "pay_application",
  "manual",
] as const;

/** Normalize any yyyy-mm-dd date to the first day of its month (UTC-safe). */
export function normalizePeriod(input: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(input);
  if (!m) throw new Error(`Invalid date: ${input}`);
  return `${m[1]}-${m[2]}-01`;
}

export function addMonths(period: string, delta: number): string {
  const [y, mo] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthRange(startPeriod: string, endPeriod: string): string[] {
  const out: string[] = [];
  let cur = normalizePeriod(startPeriod);
  const end = normalizePeriod(endPeriod);
  while (cur <= end) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const createCashFlowSchema = z.object({
  projectId: z.string().uuid(),
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-mm-dd"),
  direction: z.enum(CASH_FLOW_DIRECTIONS),
  kind: z.enum(CASH_FLOW_KINDS),
  category: z.enum(CASH_FLOW_CATEGORIES),
  amount: z.number().nonnegative().finite(),
  currencyCode: z.string().min(3).max(8),
  referenceType: z.enum(CASH_FLOW_REFERENCE_TYPES).optional(),
  referenceId: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).optional().nullable(),
});
export type CreateCashFlowInput = z.infer<typeof createCashFlowSchema>;

export const listCashFlowsSchema = z.object({
  projectId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  includeVoided: z.boolean().optional(),
});
export type ListCashFlowsInput = z.infer<typeof listCashFlowsSchema>;

export const voidCashFlowSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------
export interface CashFlowRow {
  id: string;
  company_id: string;
  project_id: string;
  period: string;
  direction: CashFlowDirection;
  kind: CashFlowKind;
  category: string;
  amount: number;
  currency_code: string;
  fx_rate_to_base: number | null;
  amount_base: number | null;
  base_currency_code: string | null;
  reference_type: string | null;
  reference_id: string | null;
  voided: boolean;
  voided_at: string | null;
  voided_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PivotCell {
  forecast: number;
  actual: number;
}

export interface PivotRow {
  category: CashFlowCategory;
  direction: CashFlowDirection;
  cells: Record<string, PivotCell>; // key = period
  totalForecast: number;
  totalActual: number;
}

export interface PivotResult {
  months: string[];
  rows: PivotRow[];
  columnTotals: Record<string, PivotCell>;
  netCumulative: Array<{
    period: string;
    forecastNet: number;
    actualNet: number;
    forecastCum: number;
    actualCum: number;
    combinedCum: number;
  }>;
  peakFundingRequirement: number; // most-negative combined cumulative
  peakFundingPeriod: string | null;
}

/** Build a pivot of rows (category × direction) over months, in BASE currency. */
export function buildPivot(
  rows: CashFlowRow[],
  months: string[],
): PivotResult {
  const active = rows.filter((r) => !r.voided);
  const pivot = new Map<string, PivotRow>();

  const key = (cat: string, dir: string) => `${cat}::${dir}`;

  for (const r of active) {
    const p = normalizePeriod(r.period);
    if (!months.includes(p)) continue;
    const cat = r.category as CashFlowCategory;
    const dir = r.direction;
    const k = key(cat, dir);
    let pr = pivot.get(k);
    if (!pr) {
      pr = {
        category: cat,
        direction: dir,
        cells: {},
        totalForecast: 0,
        totalActual: 0,
      };
      for (const m of months) pr.cells[m] = { forecast: 0, actual: 0 };
      pivot.set(k, pr);
    }
    const amt = Number(r.amount_base ?? 0);
    if (r.kind === "forecast") {
      pr.cells[p].forecast += amt;
      pr.totalForecast += amt;
    } else {
      pr.cells[p].actual += amt;
      pr.totalActual += amt;
    }
  }

  const columnTotals: Record<string, PivotCell> = {};
  for (const m of months) columnTotals[m] = { forecast: 0, actual: 0 };
  for (const pr of pivot.values()) {
    for (const m of months) {
      columnTotals[m].forecast += pr.cells[m].forecast;
      columnTotals[m].actual += pr.cells[m].actual;
    }
  }

  // Cumulative net by month: inflow − outflow.
  const sortedRows = Array.from(pivot.values()).sort((a, b) =>
    a.category === b.category
      ? a.direction.localeCompare(b.direction)
      : a.category.localeCompare(b.category),
  );

  let forecastCum = 0;
  let actualCum = 0;
  let combinedCum = 0;
  let peak = 0;
  let peakPeriod: string | null = null;
  const netCumulative = months.map((m) => {
    let fcstIn = 0;
    let fcstOut = 0;
    let actIn = 0;
    let actOut = 0;
    for (const pr of pivot.values()) {
      const c = pr.cells[m];
      if (pr.direction === "inflow") {
        fcstIn += c.forecast;
        actIn += c.actual;
      } else {
        fcstOut += c.forecast;
        actOut += c.actual;
      }
    }
    const forecastNet = fcstIn - fcstOut;
    const actualNet = actIn - actOut;
    forecastCum += forecastNet;
    actualCum += actualNet;
    combinedCum += forecastNet + actualNet;
    if (combinedCum < peak) {
      peak = combinedCum;
      peakPeriod = m;
    }
    return {
      period: m,
      forecastNet,
      actualNet,
      forecastCum,
      actualCum,
      combinedCum,
    };
  });

  return {
    months,
    rows: sortedRows,
    columnTotals,
    netCumulative,
    peakFundingRequirement: peak,
    peakFundingPeriod: peakPeriod,
  };
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  return d.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export const CATEGORY_LABELS: Record<CashFlowCategory, string> = {
  milestone_billing: "Milestone billing",
  po_payment: "PO payment",
  payroll: "Payroll",
  equipment: "Equipment",
  other: "Other",
};
