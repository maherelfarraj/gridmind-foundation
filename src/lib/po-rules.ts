// P-064 — Pure PO helpers: numbering, line building, totals.
import type { RfqLine } from "@/lib/rfq-rules";

export const PO_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "issued",
  "partially_received",
  "received",
  "closed",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export function formatPoNumber(n: number): string {
  return `PO-${String(n).padStart(4, "0")}`;
}

export function parsePoNumber(s: string): number | null {
  const m = /^PO-(\d+)$/i.exec(s ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function nextPoNumber(existing: string[]): string {
  const nums = existing
    .map(parsePoNumber)
    .filter((n): n is number => n != null);
  const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
  return formatPoNumber(next);
}

export interface AwardForPo {
  line_no: number;
  awarded_qty: number;
  awarded_unit_price: number;
  award_note?: string | null;
}

export interface PoLine {
  line_no: number;
  description: string;
  spec: string | null;
  qty: number;
  uom: string;
  unit_price: number;
  amount: number;
  site_need_date: string | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Merge awards with RFQ line specs; sorts by line_no. */
export function buildPoLinesFromAwards(
  rfqLines: RfqLine[],
  awards: AwardForPo[],
): PoLine[] {
  const byNo = new Map(rfqLines.map((l) => [l.line_no, l]));
  return awards
    .map((a) => {
      const rl = byNo.get(a.line_no);
      const qty = Number(a.awarded_qty);
      const unit = Number(a.awarded_unit_price);
      return {
        line_no: a.line_no,
        description: rl?.description ?? `Line ${a.line_no}`,
        spec: rl?.spec ?? null,
        qty,
        uom: rl?.uom ?? "pcs",
        unit_price: unit,
        amount: round2(qty * unit),
        site_need_date: rl?.site_need_date ?? null,
      } satisfies PoLine;
    })
    .sort((a, b) => a.line_no - b.line_no);
}

export function computePoTotals(
  lines: Array<{ amount: number }>,
  taxPct: number,
): { subtotal: number; tax_amount: number; total_amount: number } {
  const subtotal = round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
  const tax_amount = round2(subtotal * (Number(taxPct || 0) / 100));
  const total_amount = round2(subtotal + tax_amount);
  return { subtotal, tax_amount, total_amount };
}

/** Latest site_need_date across lines (nullable). */
export function maxSiteNeedDate(lines: PoLine[]): string | null {
  const dates = lines
    .map((l) => l.site_need_date)
    .filter((d): d is string => !!d);
  if (dates.length === 0) return null;
  return dates.sort().at(-1) ?? null;
}
