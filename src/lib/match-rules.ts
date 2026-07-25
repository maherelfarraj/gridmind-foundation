// P-067 — Pure three-way match helpers: variance math, status derivation,
// storage path guards, and Zod schemas. No I/O so tests can run headless.
import { z } from "zod";

export const MATCH_STATUSES = [
  "pending",
  "matched",
  "variance_blocked",
  "approved_with_variance",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export interface LineQty {
  po_line_no: number;
  qty: number;
  unit_price?: number | null;
}

export interface VarianceInputs {
  poTotal: number;
  poLines: LineQty[];
  grnQtyByLine: Map<number, number> | Record<number, number>;
  invoiceAmount: number;
  invoiceLines?: LineQty[]; // optional per-line invoiced qty/price
}

export interface VarianceResult {
  qty_variance_pct: number | null;
  price_variance_pct: number | null;
  amount_variance: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMap(m: Map<number, number> | Record<number, number>): Map<number, number> {
  if (m instanceof Map) return m;
  return new Map(Object.entries(m).map(([k, v]) => [Number(k), Number(v)]));
}

/**
 * Compute the worst-case (max absolute) qty & price variance across lines
 * plus the amount delta between invoice and PO. Qty variance compares
 * invoiced qty to received qty; price variance compares invoiced unit
 * price to PO unit price. When per-line invoice data is not supplied,
 * qty/price variances resolve to null.
 */
export function computeVariances(inputs: VarianceInputs): VarianceResult {
  const grn = toMap(inputs.grnQtyByLine);
  const amount_variance = round2(Number(inputs.invoiceAmount || 0) - Number(inputs.poTotal || 0));

  let qty_variance_pct: number | null = null;
  let price_variance_pct: number | null = null;

  if (inputs.invoiceLines && inputs.invoiceLines.length > 0) {
    const poByNo = new Map(inputs.poLines.map((l) => [l.po_line_no, l]));
    let worstQty = 0;
    let worstPrice = 0;
    let hasQty = false;
    let hasPrice = false;
    for (const inv of inputs.invoiceLines) {
      const received = Number(grn.get(inv.po_line_no) ?? 0);
      if (received > 0) {
        hasQty = true;
        const pct = ((Number(inv.qty || 0) - received) / received) * 100;
        if (Math.abs(pct) > Math.abs(worstQty)) worstQty = pct;
      }
      const po = poByNo.get(inv.po_line_no);
      const poPrice = Number(po?.unit_price ?? 0);
      const invPrice = Number(inv.unit_price ?? 0);
      if (poPrice > 0 && invPrice > 0) {
        hasPrice = true;
        const pct = ((invPrice - poPrice) / poPrice) * 100;
        if (Math.abs(pct) > Math.abs(worstPrice)) worstPrice = pct;
      }
    }
    if (hasQty) qty_variance_pct = round2(worstQty);
    if (hasPrice) price_variance_pct = round2(worstPrice);
  }

  return { qty_variance_pct, price_variance_pct, amount_variance };
}

/** Absolute amount variance as a % of PO total (used by the KPI tile too). */
export function amountVariancePct(amount_variance: number, poTotal: number): number {
  if (!poTotal || poTotal === 0) return 0;
  return round2((Math.abs(amount_variance) / poTotal) * 100);
}

/**
 * Match is `matched` only when every reported variance is within the
 * configured tolerance; otherwise it blocks payment release.
 */
export function deriveMatchStatus(args: {
  variances: VarianceResult;
  poTotal: number;
  thresholdPct: number;
}): Exclude<MatchStatus, "pending" | "approved_with_variance"> {
  const t = Math.abs(Number(args.thresholdPct || 0));
  const amtPct = amountVariancePct(args.variances.amount_variance, args.poTotal);
  const qty = args.variances.qty_variance_pct;
  const price = args.variances.price_variance_pct;
  const outOfTolerance =
    amtPct > t + 1e-6 ||
    (qty != null && Math.abs(qty) > t + 1e-6) ||
    (price != null && Math.abs(price) > t + 1e-6);
  return outOfTolerance ? "variance_blocked" : "matched";
}

/** Enforce that a storage path is scoped to `{company_id}/invoices/{match_id}/…`. */
export function assertInvoicePath(path: string, companyId: string, matchId: string): void {
  const prefix = `${companyId}/invoices/${matchId}/`;
  if (!path.startsWith(prefix)) throw new Error(`invalid_invoice_path:${path}`);
  if (path.includes("..")) throw new Error("invalid_invoice_path");
}

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
export const invoiceLineSchema = z.object({
  po_line_no: z.number().int().min(1).max(9999),
  qty: z.number().min(0),
  unit_price: z.number().min(0).nullable().optional(),
});

export const matchCreatePayload = z.object({
  poId: z.string().uuid(),
  goodsReceiptId: z.string().uuid().nullable().optional(),
  vendor_invoice_number: z.string().trim().min(1).max(120),
  invoice_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  invoice_amount: z.number().positive(),
  invoice_currency_code: z.string().trim().min(3).max(8).optional(),
  variance_threshold_pct: z.number().min(0).max(100).optional(),
  invoice_lines: z.array(invoiceLineSchema).max(500).optional(),
});
export type MatchCreatePayload = z.infer<typeof matchCreatePayload>;

export const matchOverridePayload = z.object({
  matchId: z.string().uuid(),
  resolution_note: z.string().trim().min(5).max(2000),
});
export type MatchOverridePayload = z.infer<typeof matchOverridePayload>;

export const matchThresholdPayload = z.object({
  matchId: z.string().uuid(),
  variance_threshold_pct: z.number().min(0).max(100),
});
