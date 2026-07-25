// P-074 — Pure rules + zod schemas for the risk register.
import { z } from "zod";
import { differenceInCalendarDays, parseISO } from "date-fns";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const RISK_CATEGORIES = [
  "schedule",
  "cost",
  "technical",
  "hse",
  "commercial",
  "regulatory",
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_CATEGORY_LABEL: Record<RiskCategory, string> = {
  schedule: "Schedule",
  cost: "Cost",
  technical: "Technical",
  hse: "HSE",
  commercial: "Commercial",
  regulatory: "Regulatory",
};

export const RISK_STATUSES = ["open", "mitigating", "realized", "closed"] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];

export const RISK_STATUS_LABEL: Record<RiskStatus, string> = {
  open: "Open",
  mitigating: "Mitigating",
  realized: "Realized",
  closed: "Closed",
};

export const PROBABILITY_LABELS: Record<number, string> = {
  1: "Very Low",
  2: "Low",
  3: "Medium",
  4: "High",
  5: "Very High",
};

export const IMPACT_LABELS = PROBABILITY_LABELS;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------
export interface RiskLite {
  id: string;
  title: string;
  probability: number;
  impact: number;
  score: number;
  status: RiskStatus;
  contingency_amount: number | null;
  currency_code: string | null;
  identified_at: string; // ISO date
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use ISO date YYYY-MM-DD");

export const riskWritableSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  category: z.enum(RISK_CATEGORIES),
  probability: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  status: z.enum(RISK_STATUSES),
  owner_id: z.string().uuid().nullable().optional(),
  mitigation: z.string().trim().max(4000).nullable().optional(),
  contingency_amount: z.number().min(0).max(1_000_000_000).nullable().optional(),
  currency_code: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "3-letter ISO code")
    .nullable()
    .optional(),
  target_close_date: isoDate.nullable().optional(),
  identified_at: isoDate.optional(),
});

export const riskCreateSchema = riskWritableSchema.extend({
  projectId: z.string().uuid(),
});

export const riskUpdateSchema = z.object({
  id: z.string().uuid(),
  patch: riskWritableSchema.partial(),
});

export const riskDeleteSchema = z.object({ id: z.string().uuid() });

// ---------------------------------------------------------------------------
// Score / bands
// ---------------------------------------------------------------------------
export function scoreOf(probability: number, impact: number): number {
  return Math.max(1, Math.min(5, probability)) * Math.max(1, Math.min(5, impact));
}

export type ScoreBand = "low" | "medium" | "high" | "critical";

export function bandForScore(score: number): ScoreBand {
  if (score >= 15) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const SCORE_BAND_TEXT: Record<ScoreBand, string> = {
  low: "text-muted-foreground",
  medium: "text-foreground",
  high: "text-warning",
  critical: "text-destructive",
};

// ---------------------------------------------------------------------------
// Heat map cell colouring (semantic tokens only)
// ---------------------------------------------------------------------------
export function heatCellClass(probability: number, impact: number): string {
  const s = scoreOf(probability, impact);
  if (s >= 20) return "bg-destructive/25";
  if (s >= 15) return "bg-destructive/15";
  if (s >= 13) return "bg-warning/25";
  if (s >= 9) return "bg-warning/15";
  if (s >= 5) return "bg-primary/10";
  return "bg-muted/40";
}

// ---------------------------------------------------------------------------
// Matrix bucketing
// ---------------------------------------------------------------------------
export function matrixCells<T extends { probability: number; impact: number }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const key = `${r.probability}-${r.impact}`;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Register age
// ---------------------------------------------------------------------------
export type AgeBand = "ok" | "warning" | "destructive";

export function registerAgeDays(
  rows: { identified_at: string }[],
  today: Date = new Date(),
): number | null {
  if (rows.length === 0) return null;
  let newest: Date | null = null;
  for (const r of rows) {
    const d = parseISO(r.identified_at);
    if (Number.isNaN(d.getTime())) continue;
    if (newest == null || d > newest) newest = d;
  }
  if (newest == null) return null;
  return Math.max(0, differenceInCalendarDays(today, newest));
}

export function bandForAge(days: number | null): AgeBand {
  if (days == null || days <= 14) return "ok";
  if (days <= 30) return "warning";
  return "destructive";
}

export const AGE_BAND_TEXT: Record<AgeBand, string> = {
  ok: "text-primary",
  warning: "text-warning",
  destructive: "text-destructive",
};

// ---------------------------------------------------------------------------
// Contingency exposure — open + mitigating only.
// ---------------------------------------------------------------------------
export function sumContingency<
  T extends {
    status: RiskStatus;
    contingency_amount: number | null;
    currency_code: string | null;
  },
>(
  rows: T[],
): {
  totalsByCurrency: Record<string, number>;
  primary: { code: string; amount: number } | null;
  otherCount: number;
} {
  const totals: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "open" && r.status !== "mitigating") continue;
    const amt = Number(r.contingency_amount ?? 0);
    if (!amt) continue;
    const code = (r.currency_code || "USD").toUpperCase();
    totals[code] = (totals[code] ?? 0) + amt;
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return { totalsByCurrency: totals, primary: null, otherCount: 0 };
  }
  const [code, amount] = entries[0];
  return {
    totalsByCurrency: totals,
    primary: { code, amount },
    otherCount: entries.length - 1,
  };
}

export function formatCurrency(amount: number, code: string | null): string {
  const currency = (code || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------
export function allowedStatusTransitions(current: RiskStatus): RiskStatus[] {
  switch (current) {
    case "open":
      return ["open", "mitigating", "realized", "closed"];
    case "mitigating":
      return ["mitigating", "realized", "closed", "open"];
    case "realized":
      return ["realized", "closed"];
    case "closed":
      return ["closed", "open"];
  }
}

// ---------------------------------------------------------------------------
// Age helper for the register table.
// ---------------------------------------------------------------------------
export function ageOfRow(row: { identified_at: string }, today: Date = new Date()): number {
  const d = parseISO(row.identified_at);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.max(0, differenceInCalendarDays(today, d));
}
