// P-213 — Pure estimate-vs-actuals math. No server imports: safe for
// components and offline unit tests.
import { ESTIMATE_RATE_TYPES, round2, type EstimateRateType } from "@/lib/estimating.rules";

export type ComparisonType = EstimateRateType;

export const COMPARISON_TYPES = ESTIMATE_RATE_TYPES;

/** Formulas surfaced in the card tooltip — single source of truth. */
export const COMPARISON_FORMULAS = [
  "Estimated = Σ estimate line amounts per line type",
  "Committed = Σ purchase-order totals (excluding draft and cancelled) attributed per type from the PO line categories",
  "Actuals = Σ matched/approved three-way-match invoice amounts, plus completed work-order labour (hours × rate) attributed to labour",
  "Variance % = (actuals − estimated) ÷ estimated × 100",
] as const;

export type MoneyByType = Record<ComparisonType, number>;

export function emptyByType(): MoneyByType {
  return { material: 0, labor: 0, plant: 0, subcontract: 0, other: 0 };
}

/* ------------------------------------------------------- PO attribution */

export interface PoLineLike {
  category?: string | null;
  description?: string | null;
  spec?: string | null;
  amount?: number | string | null;
}

const MATERIAL_WORDS = [
  "module",
  "panel",
  "inverter",
  "bos",
  "cable",
  "conductor",
  "structure",
  "tracker",
  "mounting rail",
  "transformer",
  "switchgear",
  "battery",
  "combiner",
  "material",
];

const SUBCONTRACT_WORDS = [
  "installation",
  "install",
  "electrical work",
  "electrical subcontract",
  "civil",
  "erection",
  "subcontract",
  "earthworks",
  "trenching",
  "commissioning service",
];

const PLANT_WORDS = ["crane", "excavator", "plant hire", "equipment hire", "rental"];
const LABOR_WORDS = ["labour", "labor", "manpower", "crew"];

/**
 * Map a PO line onto an estimate line type from its category (preferred) or
 * its description/spec text. Unmappable lines fall through to `other`.
 */
export function classifyPoLine(line: PoLineLike): ComparisonType {
  const haystack = [line.category, line.description, line.spec]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return "other";
  const hit = (words: string[]) => words.some((w) => haystack.includes(w));
  if (hit(SUBCONTRACT_WORDS)) return "subcontract";
  if (hit(LABOR_WORDS)) return "labor";
  if (hit(PLANT_WORDS)) return "plant";
  if (hit(MATERIAL_WORDS)) return "material";
  return "other";
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Share of a PO's value per line type (sums to 1). POs with no usable lines
 * attribute entirely to `other`.
 */
export function poTypeShares(lines: readonly PoLineLike[]): MoneyByType {
  const totals = emptyByType();
  let sum = 0;
  for (const line of lines) {
    const amount = num(line.amount);
    if (amount <= 0) continue;
    totals[classifyPoLine(line)] += amount;
    sum += amount;
  }
  if (sum <= 0) return { ...emptyByType(), other: 1 };
  for (const t of COMPARISON_TYPES) totals[t] = totals[t] / sum;
  return totals;
}

export interface PoForComparison {
  id: string;
  total: number;
  lines: PoLineLike[];
}

/** Σ PO totals attributed per line type. */
export function committedByType(pos: readonly PoForComparison[]): MoneyByType {
  const out = emptyByType();
  for (const po of pos) {
    const shares = poTypeShares(po.lines);
    for (const t of COMPARISON_TYPES) out[t] += num(po.total) * shares[t];
  }
  for (const t of COMPARISON_TYPES) out[t] = round2(out[t]);
  return out;
}

/** Σ invoiced amounts attributed with the same PO split, plus labour actuals. */
export function actualsByType(
  pos: readonly PoForComparison[],
  invoicedByPo: Readonly<Record<string, number>>,
  laborActual = 0,
): MoneyByType {
  const out = emptyByType();
  for (const po of pos) {
    const invoiced = num(invoicedByPo[po.id]);
    if (invoiced === 0) continue;
    const shares = poTypeShares(po.lines);
    for (const t of COMPARISON_TYPES) out[t] += invoiced * shares[t];
  }
  out.labor += num(laborActual);
  for (const t of COMPARISON_TYPES) out[t] = round2(out[t]);
  return out;
}

/* ------------------------------------------------------------ variance */

export type VarianceTone = "neutral" | "warning" | "destructive";

/** (actuals − estimated) / estimated × 100. Null when not computable. */
export function variancePct(estimated: number, actuals: number | null): number | null {
  if (actuals == null) return null;
  const e = num(estimated);
  if (e === 0) return null;
  return round2(((num(actuals) - e) / e) * 100);
}

/** ≤ 5% neutral · > 5% amber · > 10% destructive (absolute value). */
export function varianceTone(pct: number | null): VarianceTone {
  if (pct == null) return "neutral";
  const abs = Math.abs(pct);
  if (abs > 10) return "destructive";
  if (abs > 5) return "warning";
  return "neutral";
}

/* --------------------------------------------------------------- rows */

export interface ComparisonRow {
  line_type: ComparisonType | "total";
  estimated: number;
  committed: number | null;
  actuals: number | null;
  variance_pct: number | null;
  tone: VarianceTone;
}

export interface ComparisonInput {
  /** Σ estimate_lines.amount per line type. */
  estimated: MoneyByType;
  /** Null when the purchase_orders source is unavailable → renders "n/a". */
  committed: MoneyByType | null;
  /** Null when every actuals source is unavailable → renders "n/a". */
  actuals: MoneyByType | null;
}

export function estimatedByType(
  lines: readonly { line_type: string; amount: number | string | null }[],
): MoneyByType {
  const out = emptyByType();
  for (const l of lines) {
    const t = (COMPARISON_TYPES as readonly string[]).includes(l.line_type)
      ? (l.line_type as ComparisonType)
      : "other";
    out[t] += num(l.amount);
  }
  for (const t of COMPARISON_TYPES) out[t] = round2(out[t]);
  return out;
}

/** Per-type rows plus a totals row. Missing sources stay null end to end. */
export function buildComparisonRows(input: ComparisonInput): {
  rows: ComparisonRow[];
  total: ComparisonRow;
} {
  const rows = COMPARISON_TYPES.map((t) => {
    const estimated = round2(input.estimated[t] ?? 0);
    const committed = input.committed ? round2(input.committed[t] ?? 0) : null;
    const actuals = input.actuals ? round2(input.actuals[t] ?? 0) : null;
    const pct = variancePct(estimated, actuals);
    return {
      line_type: t,
      estimated,
      committed,
      actuals,
      variance_pct: pct,
      tone: varianceTone(pct),
    } satisfies ComparisonRow;
  });

  const sum = (pick: (r: ComparisonRow) => number | null): number | null =>
    rows.some((r) => pick(r) == null) ? null : round2(rows.reduce((s, r) => s + (pick(r) ?? 0), 0));

  const estimated = round2(rows.reduce((s, r) => s + r.estimated, 0));
  const actuals = sum((r) => r.actuals);
  const pct = variancePct(estimated, actuals);
  const total: ComparisonRow = {
    line_type: "total",
    estimated,
    committed: sum((r) => r.committed),
    actuals,
    variance_pct: pct,
    tone: varianceTone(pct),
  };
  return { rows, total };
}

/** Mean absolute variance % across priced estimates that have actuals. */
export function meanAbsoluteVariance(values: readonly (number | null)[]): number | null {
  const usable = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (usable.length === 0) return null;
  return round2(usable.reduce((s, v) => s + Math.abs(v), 0) / usable.length);
}
