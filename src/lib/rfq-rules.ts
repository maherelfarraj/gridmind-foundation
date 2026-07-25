// P-063 — Pure RFQ helpers: schemas, RFQ-#### generator, TCO leveling.
import { z } from "zod";

// ---------------------------------------------------------------------------
// enums
// ---------------------------------------------------------------------------
export const RFQ_STATUSES = ["draft", "issued", "closed", "awarded", "cancelled"] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];

export const RFQ_BID_STATUSES = [
  "invited",
  "submitted",
  "under_review",
  "awarded",
  "rejected",
  "withdrawn",
] as const;
export type RfqBidStatus = (typeof RFQ_BID_STATUSES)[number];

// ---------------------------------------------------------------------------
// line schemas
// ---------------------------------------------------------------------------
export const rfqLineSchema = z.object({
  line_no: z.number().int().min(1).max(9999),
  description: z.string().trim().min(1).max(500),
  spec: z.string().trim().max(2000).nullable().optional(),
  qty: z.number().positive(),
  uom: z.string().trim().min(1).max(20),
  target_price: z.number().nonnegative().nullable().optional(),
  site_need_date: z.string().nullable().optional(),
});
export type RfqLine = z.infer<typeof rfqLineSchema>;

export const rfqLinesSchema = z
  .array(rfqLineSchema)
  .max(500)
  .superRefine((lines, ctx) => {
    const seen = new Set<number>();
    for (const [i, l] of lines.entries()) {
      if (seen.has(l.line_no)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, "line_no"],
          message: `Duplicate line_no ${l.line_no}`,
        });
      }
      seen.add(l.line_no);
    }
  });

export const bidLineSchema = z.object({
  line_no: z.number().int().min(1).max(9999),
  unit_price: z.number().nonnegative(),
  qty: z.number().positive(),
  lead_time_days: z.number().int().min(0).max(1000).nullable().optional(),
  exceptions: z.string().trim().max(2000).nullable().optional(),
});
export type BidLine = z.infer<typeof bidLineSchema>;

export const bidLinesSchema = z.array(bidLineSchema).max(500);

export const bidAttachmentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  file_path: z.string().trim().min(1).max(500),
});
export type BidAttachment = z.infer<typeof bidAttachmentSchema>;

// ---------------------------------------------------------------------------
// RFQ-#### generator (per-company sequence). Callers wrap in one-retry loop
// around the unique(company_id, rfq_number) constraint.
// ---------------------------------------------------------------------------
export function formatRfqNumber(n: number): string {
  return `RFQ-${String(n).padStart(4, "0")}`;
}

export function parseRfqNumber(s: string): number | null {
  const m = /^RFQ-(\d+)$/i.exec(s ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function nextRfqNumber(existing: string[]): string {
  const nums = existing.map(parseRfqNumber).filter((n): n is number => n != null);
  const next = (nums.length === 0 ? 0 : Math.max(...nums)) + 1;
  return formatRfqNumber(next);
}

// ---------------------------------------------------------------------------
// TCO leveling
// ---------------------------------------------------------------------------
export interface TcoConfig {
  delayCostPctPerDay: number; // % of extended price charged per day of delay
  logisticsPct: number;
  defectRiskPct: number;
}

export const DEFAULT_TCO_CONFIG: TcoConfig = {
  delayCostPctPerDay: 0.05,
  logisticsPct: 3,
  defectRiskPct: 1,
};

export interface BidInput {
  bidId: string;
  vendorId: string;
  vendorName: string;
  status: RfqBidStatus;
  validityDate: string | null;
  totalPrice: number | null;
  currencyCode: string | null;
  leadTimeDays: number | null;
  lines: BidLine[];
}

export interface TcoLineCell {
  line_no: number;
  unit_price: number;
  qty: number;
  extended: number;
  lead_time_days: number | null;
  delay_days: number; // days beyond the min lead time across bids for this line
  logistics: number;
  delay_penalty: number;
  defect_risk: number;
  tco: number;
  price_variance_pct: number | null; // vs rfq line target_price
  present: boolean;
}

export type ComplianceIssue =
  | { kind: "missing_line"; line_no: number }
  | { kind: "expired_validity"; validityDate: string }
  | { kind: "invalid_status"; status: RfqBidStatus };

export interface VendorTcoRow {
  bidId: string;
  vendorId: string;
  vendorName: string;
  status: RfqBidStatus;
  cells: Map<number, TcoLineCell>;
  vendorTotalTco: number;
  compliant: boolean;
  issues: ComplianceIssue[];
}

export interface TcoMatrix {
  rows: VendorTcoRow[];
  minLeadByLine: Map<number, number>;
  winnersByLine: Map<number, string | null>; // line_no -> bidId
  overallWinnerBidId: string | null;
  averagePriceVariancePct: number | null;
  nonCompliantCount: number;
}

const NON_COMPLIANT_STATUSES: RfqBidStatus[] = ["invited", "rejected", "withdrawn"];

export function computeTcoMatrix(params: {
  rfqLines: RfqLine[];
  bids: BidInput[];
  config: TcoConfig;
  today?: Date;
}): TcoMatrix {
  const { rfqLines, bids, config } = params;
  const today = params.today ?? new Date();
  today.setHours(0, 0, 0, 0);

  // Filter bids that participate in leveling (submitted / under_review / awarded).
  const activeBids = bids.filter((b) => !NON_COMPLIANT_STATUSES.includes(b.status));

  // Per-line min lead time across active bids that quoted the line.
  const minLeadByLine = new Map<number, number>();
  for (const b of activeBids) {
    for (const l of b.lines) {
      if (l.lead_time_days == null) continue;
      const cur = minLeadByLine.get(l.line_no);
      if (cur == null || l.lead_time_days < cur) {
        minLeadByLine.set(l.line_no, l.lead_time_days);
      }
    }
  }

  const rfqLineByNo = new Map(rfqLines.map((l) => [l.line_no, l]));

  const rows: VendorTcoRow[] = bids.map((b) => {
    const cells = new Map<number, TcoLineCell>();
    const issues: ComplianceIssue[] = [];

    if (NON_COMPLIANT_STATUSES.includes(b.status)) {
      issues.push({ kind: "invalid_status", status: b.status });
    }
    if (b.validityDate) {
      const v = new Date(b.validityDate);
      if (v < today) {
        issues.push({ kind: "expired_validity", validityDate: b.validityDate });
      }
    }

    for (const rfqLine of rfqLines) {
      const bidLine = b.lines.find((x) => x.line_no === rfqLine.line_no);
      if (!bidLine) {
        issues.push({ kind: "missing_line", line_no: rfqLine.line_no });
        continue;
      }
      const extended = bidLine.unit_price * bidLine.qty;
      const minLead = minLeadByLine.get(rfqLine.line_no);
      const delayDays =
        bidLine.lead_time_days != null && minLead != null
          ? Math.max(0, bidLine.lead_time_days - minLead)
          : 0;
      const logistics = extended * (config.logisticsPct / 100);
      const delayPenalty = extended * (config.delayCostPctPerDay / 100) * delayDays;
      const defectRisk = extended * (config.defectRiskPct / 100);
      const tco = extended + logistics + delayPenalty + defectRisk;
      const priceVar =
        rfqLine.target_price != null && rfqLine.target_price > 0
          ? ((bidLine.unit_price - rfqLine.target_price) / rfqLine.target_price) * 100
          : null;
      cells.set(rfqLine.line_no, {
        line_no: rfqLine.line_no,
        unit_price: bidLine.unit_price,
        qty: bidLine.qty,
        extended,
        lead_time_days: bidLine.lead_time_days ?? null,
        delay_days: delayDays,
        logistics,
        delay_penalty: delayPenalty,
        defect_risk: defectRisk,
        tco,
        price_variance_pct: priceVar,
        present: true,
      });
    }

    const vendorTotal = Array.from(cells.values()).reduce((acc, c) => acc + c.tco, 0);

    return {
      bidId: b.bidId,
      vendorId: b.vendorId,
      vendorName: b.vendorName,
      status: b.status,
      cells,
      vendorTotalTco: vendorTotal,
      compliant: issues.length === 0,
      issues,
    };
  });

  // Winner per line: lowest TCO among compliant rows that quoted the line.
  const winnersByLine = new Map<number, string | null>();
  for (const rfqLine of rfqLines) {
    let winner: string | null = null;
    let best = Infinity;
    for (const r of rows) {
      if (!r.compliant) continue;
      const c = r.cells.get(rfqLine.line_no);
      if (!c) continue;
      if (c.tco < best) {
        best = c.tco;
        winner = r.bidId;
      }
    }
    winnersByLine.set(rfqLine.line_no, winner);
  }

  // Overall winner: lowest vendor total across fully compliant rows.
  let overallWinnerBidId: string | null = null;
  let bestVendorTotal = Infinity;
  for (const r of rows) {
    if (!r.compliant) continue;
    if (r.cells.size !== rfqLines.length) continue;
    if (r.vendorTotalTco < bestVendorTotal) {
      bestVendorTotal = r.vendorTotalTco;
      overallWinnerBidId = r.bidId;
    }
  }

  // Average price variance across all present cells with a target.
  const variances: number[] = [];
  for (const r of rows) {
    for (const c of r.cells.values()) {
      if (c.price_variance_pct != null) variances.push(c.price_variance_pct);
    }
  }
  const averagePriceVariancePct =
    variances.length === 0 ? null : variances.reduce((a, b) => a + b, 0) / variances.length;

  const nonCompliantCount = rows.filter((r) => !r.compliant).length;

  return {
    rows,
    minLeadByLine,
    winnersByLine,
    overallWinnerBidId,
    averagePriceVariancePct,
    nonCompliantCount,
  };
}
