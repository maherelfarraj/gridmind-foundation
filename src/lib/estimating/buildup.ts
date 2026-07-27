// P-211 — Pure cost build-up engine. No React, no Supabase, no I/O: shared by
// the margin editor, the server functions and the offline unit fixtures.
import { z } from "zod";

export type BuildupLineInput = { qty: number; unit_rate: number };

export type MarginInput = {
  escalation_pct: number;
  contingency_pct: number;
  overhead_pct: number;
  profit_pct: number;
};

export type BuildupStageKey = "direct" | "escalation" | "contingency" | "overhead" | "profit";

export type BuildupStage = {
  key: BuildupStageKey;
  label: string;
  /** Amount the percentage was applied to (running total entering the stage). */
  base: number;
  /** Percentage applied, or null for the direct-cost stage. */
  pct: number | null;
  amount: number;
  running_total: number;
  /** Human-readable derivation, shown in tooltips. */
  formula: string;
};

export type BuildupResult = {
  direct_cost: number;
  stages: BuildupStage[];
  /** Cost before profit — the running total after overhead. */
  subtotal: number;
  total_price: number;
  warnings: string[];
};

/** Combined margin percentage above which we flag competitiveness. */
export const MARGIN_WARNING_THRESHOLD = 40;
export const MARGIN_WARNING_MESSAGE =
  "Combined margins exceed 40% of cost — verify competitiveness";

export const STAGE_LABELS: Record<BuildupStageKey, string> = {
  direct: "Direct cost",
  escalation: "Escalation",
  contingency: "Contingency",
  overhead: "Overhead",
  profit: "Profit",
};

/** Half-up rounding to 2dp on the positive money domain. */
function round2(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** 102000 -> "102,000.00"; matches the tooltip/table formatting. */
function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 5 -> "5.000%" (three decimals, mirroring numeric(6,3) in the database). */
function pctLabel(pct: number): string {
  return `${pct.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`;
}

export const estimateMarginsSchema = z.object({
  escalation_pct: z.number().min(0).max(50),
  contingency_pct: z.number().min(0).max(50),
  overhead_pct: z.number().min(0).max(50),
  profit_pct: z.number().min(0).max(50),
});

export const ZERO_MARGINS: MarginInput = {
  escalation_pct: 0,
  contingency_pct: 0,
  overhead_pct: 0,
  profit_pct: 0,
};

/** Σ round2(qty × unit_rate) — same per-line rounding the line grid persists. */
export function directCostOf(lines: readonly BuildupLineInput[]): number {
  return round2(
    (lines ?? []).reduce((acc, l) => acc + round2(num(l.qty) * num(l.unit_rate)), 0),
  );
}

/**
 * Compounding staged waterfall: escalation, contingency and overhead each apply
 * to the running total, giving the cost subtotal; profit applies to that
 * subtotal and produces the bid price. Every stage is rounded to 2dp.
 */
export function computeEstimate(
  lines: readonly BuildupLineInput[],
  margins: MarginInput,
): BuildupResult {
  const direct = directCostOf(lines);
  const pcts = {
    escalation_pct: num(margins?.escalation_pct),
    contingency_pct: num(margins?.contingency_pct),
    overhead_pct: num(margins?.overhead_pct),
    profit_pct: num(margins?.profit_pct),
  };

  const stages: BuildupStage[] = [
    {
      key: "direct",
      label: STAGE_LABELS.direct,
      base: direct,
      pct: null,
      amount: direct,
      running_total: direct,
      formula: `Σ qty × unit_rate over ${lines?.length ?? 0} lines`,
    },
  ];

  let running = direct;
  const costStages: Array<[Exclude<BuildupStageKey, "direct" | "profit">, number]> = [
    ["escalation", pcts.escalation_pct],
    ["contingency", pcts.contingency_pct],
    ["overhead", pcts.overhead_pct],
  ];

  for (const [key, pct] of costStages) {
    const base = running;
    const amount = round2((base * pct) / 100);
    running = round2(base + amount);
    stages.push({
      key,
      label: STAGE_LABELS[key],
      base,
      pct,
      amount,
      running_total: running,
      formula: `${fmt(base)} × ${pctLabel(pct)} = ${fmt(amount)}`,
    });
  }

  const subtotal = running;
  const profitAmount = round2((subtotal * pcts.profit_pct) / 100);
  const totalPrice = round2(subtotal + profitAmount);
  stages.push({
    key: "profit",
    label: STAGE_LABELS.profit,
    base: subtotal,
    pct: pcts.profit_pct,
    amount: profitAmount,
    running_total: totalPrice,
    formula: `${fmt(subtotal)} × ${pctLabel(pcts.profit_pct)} = ${fmt(profitAmount)}`,
  });

  const combined =
    pcts.escalation_pct + pcts.contingency_pct + pcts.overhead_pct + pcts.profit_pct;
  const warnings: string[] = [];
  if (combined > MARGIN_WARNING_THRESHOLD) warnings.push(MARGIN_WARNING_MESSAGE);

  return { direct_cost: direct, stages, subtotal, total_price: totalPrice, warnings };
}

/** Sum of the four margin percentages — used for the amber warning chip. */
export function combinedMarginPct(margins: MarginInput): number {
  return round2(
    num(margins.escalation_pct) +
      num(margins.contingency_pct) +
      num(margins.overhead_pct) +
      num(margins.profit_pct),
  );
}

export type PricingLineIssue = { line_id: string; description: string; reason: string };

/**
 * Pricing readiness for "Save as priced": every line needs a positive qty and a
 * non-negative rate, and the recomputed bid price must be greater than zero.
 */
export function validateForPricing(
  lines: readonly (BuildupLineInput & { id: string; description: string })[],
  margins: MarginInput,
): { ok: boolean; issues: PricingLineIssue[]; result: BuildupResult } {
  const issues: PricingLineIssue[] = [];
  for (const line of lines) {
    if (!(num(line.qty) > 0)) {
      issues.push({
        line_id: line.id,
        description: line.description,
        reason: "Quantity must be greater than zero",
      });
    } else if (num(line.unit_rate) < 0) {
      issues.push({
        line_id: line.id,
        description: line.description,
        reason: "Unit rate cannot be negative",
      });
    }
  }
  const result = computeEstimate(lines, margins);
  if (lines.length === 0) {
    issues.push({
      line_id: "",
      description: "Estimate",
      reason: "Add at least one line before pricing",
    });
  }
  return { ok: issues.length === 0 && result.total_price > 0, issues, result };
}
