// P-212 — Pure estimate → proposal mapping. No React, no Supabase: shared by
// the conversion server function and the offline unit fixtures.
import type { BuildupResult } from "@/lib/estimating/buildup";

export type ProposalCategory =
  | "equipment"
  | "installation"
  | "civil"
  | "electrical"
  | "engineering"
  | "contingency"
  | "other";

/** Estimate line type → proposal line-item category (P-046 conventions). */
export const LINE_TYPE_CATEGORY: Record<string, ProposalCategory> = {
  material: "equipment",
  labor: "installation",
  plant: "equipment",
  subcontract: "other",
  other: "other",
};

export const LINE_TYPE_LABEL: Record<string, string> = {
  material: "Materials & equipment",
  labor: "Labour & installation",
  plant: "Plant & equipment hire",
  subcontract: "Subcontracted works",
  other: "Other direct costs",
};

/** Preserve a stable, human order in the generated proposal. */
const LINE_TYPE_ORDER = ["material", "labor", "plant", "subcontract", "other"] as const;

export interface EstimateLineForConversion {
  line_type: string;
  amount: number;
}

export interface ProposalLineDraft {
  sort_order: number;
  category: ProposalCategory;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  line_total: number;
}

function round2(n: number): number {
  const v = Number.isFinite(n) ? n : 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Build the proposal line items for a converted estimate: one lot line per
 * estimate line type present, then the escalation / overhead / contingency
 * margin stages. Σ line_total always equals the build-up subtotal.
 */
export function proposalLinesFromEstimate(
  lines: readonly EstimateLineForConversion[],
  buildup: BuildupResult,
): ProposalLineDraft[] {
  const grouped = new Map<string, number>();
  for (const line of lines) {
    const key = LINE_TYPE_CATEGORY[line.line_type] ? line.line_type : "other";
    grouped.set(key, round2((grouped.get(key) ?? 0) + (Number(line.amount) || 0)));
  }

  const drafts: ProposalLineDraft[] = [];
  const push = (category: ProposalCategory, description: string, amount: number) => {
    const total = round2(amount);
    if (total === 0) return;
    drafts.push({
      sort_order: drafts.length,
      category,
      description,
      qty: 1,
      unit: "lot",
      unit_price: total,
      line_total: total,
    });
  };

  for (const type of LINE_TYPE_ORDER) {
    const amount = grouped.get(type) ?? 0;
    push(LINE_TYPE_CATEGORY[type], LINE_TYPE_LABEL[type], amount);
  }

  const stage = (key: string) => buildup.stages.find((s) => s.key === key)?.amount ?? 0;
  push("other", "Escalation", stage("escalation"));
  push("contingency", "Contingency", stage("contingency"));
  push("other", "Overhead & indirect costs", stage("overhead"));

  return drafts;
}

export function sumLineTotals(lines: readonly ProposalLineDraft[]): number {
  return round2(lines.reduce((acc, l) => acc + l.line_total, 0));
}
