// P-080 — Invoices shared rules + milestone billing helper.
import { z } from "zod";

export const INVOICE_DIRECTIONS = ["receivable", "payable"] as const;
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

export const INVOICE_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "paid",
  "disputed",
  "cancelled",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export function invoiceStatusLabel(s: InvoiceStatus): string {
  return {
    draft: "Draft",
    submitted: "Submitted",
    under_review: "Under review",
    approved: "Approved",
    paid: "Paid",
    disputed: "Disputed",
    cancelled: "Cancelled",
  }[s];
}

const toCents = (n: number) => Math.round(Number(n || 0) * 100);
const fromCents = (c: number) => c / 100;

export const MilestoneBillSchema = z.object({
  contract_id: z.string().uuid(),
  sov_line_no: z.number().int().min(1),
  pct_to_bill: z.number().finite().gt(0).lte(100),
});
export type MilestoneBillInput = z.infer<typeof MilestoneBillSchema>;

export const MarkInvoicePaidSchema = z.object({
  id: z.string().uuid(),
  paid_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export interface MilestoneComputation {
  amount: number;
  cappedPct: number;
  remainingBefore: number;
  remainingAfter: number;
  hitCap: boolean;
}

/**
 * Compute the amount for a milestone bill against one SOV line.
 * Caps to remaining unbilled; throws if remaining <= 0 (fully billed).
 * Cents-integer math so 0.1 + 0.2 doesn't drift.
 */
export function computeMilestoneBill(
  scheduledAmount: number,
  prevBilledForLine: number,
  pctToBill: number,
): MilestoneComputation {
  if (pctToBill <= 0 || pctToBill > 100) {
    throw new Error("pct_to_bill must be between 0 (exclusive) and 100");
  }
  const schedCents = toCents(scheduledAmount);
  const prevCents = toCents(prevBilledForLine);
  const remCentsBefore = Math.max(0, schedCents - prevCents);
  if (remCentsBefore <= 0) {
    throw new Error("This SOV line has been fully billed.");
  }
  const requestedCents = Math.round((schedCents * pctToBill) / 100);
  const hitCap = requestedCents > remCentsBefore;
  const finalCents = hitCap ? remCentsBefore : requestedCents;
  const cappedPct =
    schedCents > 0
      ? Math.round((finalCents / schedCents) * 10000) / 100
      : 0;
  return {
    amount: fromCents(finalCents),
    cappedPct,
    remainingBefore: fromCents(remCentsBefore),
    remainingAfter: fromCents(remCentsBefore - finalCents),
    hitCap,
  };
}

/**
 * Parses `SOV #<n>...` prefix out of a milestone_label. Used to attribute
 * a prior invoice's amount back to a SOV line.
 */
export function extractSovLineNoFromLabel(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /^SOV\s*#\s*(\d+)/i.exec(label.trim());
  return m ? Number(m[1]) : null;
}

/** Sum prior receivable amounts per SOV line across a set of invoices. */
export function sumPriorBilledPerLine(
  invoices: readonly { milestone_label: string | null; amount: number; status: string }[],
): Map<number, number> {
  const out = new Map<number, number>();
  for (const i of invoices) {
    if (i.status === "cancelled") continue;
    const lineNo = extractSovLineNoFromLabel(i.milestone_label);
    if (lineNo == null) continue;
    out.set(lineNo, (out.get(lineNo) ?? 0) + Number(i.amount || 0));
  }
  return out;
}

export function milestoneLabelFor(
  sovLineNo: number,
  description: string,
  cappedPct: number,
): string {
  const clean = description.length > 60 ? `${description.slice(0, 57)}…` : description;
  return `SOV #${sovLineNo} — ${clean} @${cappedPct}%`;
}
