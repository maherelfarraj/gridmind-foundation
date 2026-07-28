// P-258 — Subcontract claims: shared schemas + pure money/percent math.
// Mirrors the SQL derivations in 0098/0099 so the UI can pre-validate before the
// database guards fire (SOV reconciliation, 0..100 cumulative clamp, retention).
import { z } from "zod";

export const SUBCONTRACT_STATUSES = ["draft", "active", "complete", "terminated"] as const;
export type SubcontractStatus = (typeof SUBCONTRACT_STATUSES)[number];

export const SUBCONTRACT_CLAIM_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "certified",
  "rejected",
] as const;
export type SubcontractClaimStatus = (typeof SUBCONTRACT_CLAIM_STATUSES)[number];

export const SUBCONTRACT_CLAIM_RULE_KEY = "subcontract_claim_certify";
export const SUBCONTRACT_CLAIM_ENTITY_TYPE = "subcontract_claim";

/** Vendor categories that make a vendor eligible to hold a subcontract. */
export const SUBCONTRACTOR_CATEGORIES = [
  "subcontractor",
  "sub-contractor",
  "civil",
  "electrical",
  "mechanical",
  "installation",
  "construction",
  "epc",
  "labour",
  "labor",
] as const;

/** Cents-integer arithmetic — same rounding the SQL layer applies. */
const toCents = (n: number) => Math.round(Number(n || 0) * 100);
const fromCents = (c: number) => c / 100;
export const round2 = (n: number) => fromCents(toCents(n));

export function isSubcontractorCapable(categories: readonly string[] | null | undefined): boolean {
  if (!categories || categories.length === 0) return false;
  const set = new Set(categories.map((c) => String(c).trim().toLowerCase()));
  return SUBCONTRACTOR_CATEGORIES.some((c) => set.has(c));
}

// ---------------------------------------------------------------------------
// Schedule of values
// ---------------------------------------------------------------------------
export const SovLineSchema = z.object({
  id: z.string().uuid().optional(),
  line_no: z.number().int().min(1),
  description: z.string().trim().min(1).max(500),
  uom: z.string().trim().max(24).nullable().optional(),
  qty: z.number().finite().nonnegative(),
  unit_price: z.number().finite().nonnegative(),
  wbs_item_id: z.string().uuid().nullable().optional(),
});
export type SovLineInput = z.infer<typeof SovLineSchema>;

export function sovLineAmount(line: Pick<SovLineInput, "qty" | "unit_price">): number {
  return round2(Number(line.qty || 0) * Number(line.unit_price || 0));
}

export function sovTotal(lines: readonly Pick<SovLineInput, "qty" | "unit_price">[]): number {
  return fromCents(lines.reduce((acc, l) => acc + toCents(sovLineAmount(l)), 0));
}

export interface SovReconciliation {
  total: number;
  contractValue: number;
  variance: number;
  reconciled: boolean;
}

/** Contract value must equal the SOV total to the cent — mismatch blocks save. */
export function reconcileSov(
  lines: readonly Pick<SovLineInput, "qty" | "unit_price">[],
  contractValue: number,
): SovReconciliation {
  const total = sovTotal(lines);
  const variance = fromCents(toCents(total) - toCents(contractValue));
  return {
    total,
    contractValue: round2(contractValue),
    variance,
    reconciled: Math.abs(variance) < 0.005,
  };
}

// ---------------------------------------------------------------------------
// Claim math
// ---------------------------------------------------------------------------
export interface ClaimLineMathInput {
  line_amount: number;
  previous_pct: number;
  this_period_pct: number;
}

export interface ClaimLineMath {
  previous_pct: number;
  this_period_pct: number;
  cumulative_pct: number;
  line_amount: number;
  previous_amount: number;
  this_period_amount: number;
  inRange: boolean;
}

const round3 = (n: number) => Math.round(Number(n || 0) * 1000) / 1000;

/** Per-line derivation, byte-for-byte with `subcontract_claim_lines_derive()`. */
export function computeClaimLine(input: ClaimLineMathInput): ClaimLineMath {
  const previous = round3(input.previous_pct);
  const thisPeriod = round3(input.this_period_pct);
  const cumulative = round3(previous + thisPeriod);
  const amount = round2(input.line_amount);
  const previousAmount = round2((amount * previous) / 100);
  const thisAmount = fromCents(toCents((amount * cumulative) / 100) - toCents(previousAmount));
  return {
    previous_pct: previous,
    this_period_pct: thisPeriod,
    cumulative_pct: cumulative,
    line_amount: amount,
    previous_amount: previousAmount,
    this_period_amount: thisAmount,
    inRange: cumulative >= 0 && cumulative <= 100,
  };
}

export interface ClaimTotals {
  previous_certified: number;
  this_period_amount: number;
  gross_to_date: number;
  retention_amount: number;
  net_payable: number;
  lines: ClaimLineMath[];
  outOfRangeLines: number[];
}

/** Header roll-up incl. retention (retention_pct % of the this-period amount). */
export function computeClaimTotals(
  lines: readonly ClaimLineMathInput[],
  retentionPct: number,
): ClaimTotals {
  const rp = Math.max(0, Math.min(100, Number(retentionPct || 0)));
  const computed = lines.map(computeClaimLine);
  const previous = fromCents(computed.reduce((a, l) => a + toCents(l.previous_amount), 0));
  const thisPeriod = fromCents(computed.reduce((a, l) => a + toCents(l.this_period_amount), 0));
  const retention = round2((thisPeriod * rp) / 100);
  return {
    previous_certified: previous,
    this_period_amount: thisPeriod,
    gross_to_date: fromCents(toCents(previous) + toCents(thisPeriod)),
    retention_amount: retention,
    net_payable: fromCents(toCents(thisPeriod) - toCents(retention)),
    lines: computed,
    outOfRangeLines: computed.flatMap((l, i) => (l.inRange ? [] : [i])),
  };
}

/** Progress of certified value against the contract value, clamped to 0..100. */
export function progressPct(certifiedToDate: number, contractValue: number): number {
  if (!contractValue || contractValue <= 0) return 0;
  const pct = (Number(certifiedToDate || 0) / Number(contractValue)) * 100;
  return Math.max(0, Math.min(100, round2(pct)));
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const SubcontractSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(2).max(200),
    vendor_id: z.string().uuid(),
    project_id: z.string().uuid(),
    wbs_item_id: z.string().uuid().nullable().optional(),
    scope_summary: z.string().trim().max(4000).nullable().optional(),
    contract_value: z.number().finite().nonnegative().max(1e12),
    currency_code: z.string().length(3),
    retention_pct: z.number().finite().min(0).max(100),
    start_date: dateStr.nullable().optional(),
    end_date: dateStr.nullable().optional(),
    status: z.enum(SUBCONTRACT_STATUSES).default("draft"),
    notes: z.string().trim().max(4000).nullable().optional(),
    lines: z.array(SovLineSchema).min(1).max(500),
  })
  .refine((v) => reconcileSov(v.lines, v.contract_value).reconciled, {
    message: "sov_mismatch",
    path: ["lines"],
  })
  .refine((v) => !v.end_date || !v.start_date || v.end_date >= v.start_date, {
    message: "dates_out_of_order",
    path: ["end_date"],
  });
export type SubcontractSaveInput = z.infer<typeof SubcontractSaveSchema>;

export const ClaimSaveSchema = z.object({
  id: z.string().uuid().optional(),
  subcontract_id: z.string().uuid(),
  period_start: dateStr,
  period_end: dateStr,
  notes: z.string().trim().max(4000).nullable().optional(),
  lines: z
    .array(
      z.object({
        subcontract_line_id: z.string().uuid(),
        this_period_pct: z.number().finite().min(-100).max(100),
      }),
    )
    .min(1)
    .max(500),
});
export type ClaimSaveInput = z.infer<typeof ClaimSaveSchema>;

export const ClaimDecisionSchema = z
  .object({
    claim_id: z.string().uuid(),
    approval_id: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    comment: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((v) => v.decision !== "rejected" || (v.comment ?? "").trim().length > 0, {
    message: "comment_required_on_reject",
    path: ["comment"],
  });
export type ClaimDecisionInput = z.infer<typeof ClaimDecisionSchema>;
