// P-079 — Pay applications: shared rules, schemas, reconciliation.
import { z } from "zod";

export const PAY_APP_STATUSES = [
  "draft",
  "submitted",
  "certified",
  "approved",
  "rejected",
  "invoiced",
] as const;
export type PayAppStatus = (typeof PAY_APP_STATUSES)[number];

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

/** Cents-integer arithmetic to dodge float drift on money math. */
const toCents = (n: number) => Math.round(Number(n || 0) * 100);
const fromCents = (c: number) => c / 100;

export const PayAppLineSchema = z.object({
  sov_line_no: z.number().int().min(1),
  description: z.string().min(1).max(500),
  scheduled_amount: z.number().finite().nonnegative(),
  prev_certified: z.number().finite().nonnegative().default(0),
  this_period: z.number().finite().nonnegative().default(0),
  total_certified: z.number().finite().nonnegative().default(0),
  pct_complete: z.number().finite().min(0).max(1000).default(0),
});
export type PayAppLine = z.infer<typeof PayAppLineSchema>;

export const PayAppCreateSchema = z.object({
  project_id: z.string().uuid(),
  contract_id: z.string().uuid(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  retention_pct: z.number().finite().min(0).max(100).optional(),
});
export type PayAppCreateInput = z.infer<typeof PayAppCreateSchema>;

export const PayAppUpdateSchema = z.object({
  id: z.string().uuid(),
  this_period_by_line_no: z.record(z.string(), z.number().finite().nonnegative()),
  retention_pct: z.number().finite().min(0).max(100).optional(),
});
export type PayAppUpdateInput = z.infer<typeof PayAppUpdateSchema>;

export interface PayAppTotals {
  total_scheduled: number;
  total_certified: number;
  retention_amount: number;
  net_amount: number;
  lines: PayAppLine[];
}

export function computePayAppTotals(
  linesIn: readonly PayAppLine[],
  retentionPct: number,
): PayAppTotals {
  const rp = Math.max(0, Math.min(100, Number(retentionPct || 0)));
  let schedCents = 0;
  let certCents = 0;
  const lines: PayAppLine[] = linesIn.map((raw) => {
    const scheduled = Number(raw.scheduled_amount || 0);
    const prev = Number(raw.prev_certified || 0);
    const thisP = Number(raw.this_period || 0);
    const totalCents = toCents(prev) + toCents(thisP);
    const total = fromCents(totalCents);
    schedCents += toCents(scheduled);
    certCents += totalCents;
    const pct =
      scheduled > 0 ? Math.round((total / scheduled) * 10000) / 100 : 0;
    return {
      sov_line_no: raw.sov_line_no,
      description: raw.description,
      scheduled_amount: scheduled,
      prev_certified: prev,
      this_period: thisP,
      total_certified: total,
      pct_complete: pct,
    };
  });
  const retentionCents = Math.round((certCents * rp) / 100);
  const netCents = certCents - retentionCents;
  return {
    total_scheduled: fromCents(schedCents),
    total_certified: fromCents(certCents),
    retention_amount: fromCents(retentionCents),
    net_amount: fromCents(netCents),
    lines,
  };
}

export class PayAppLineValidationError extends Error {
  constructor(
    public failures: {
      sov_line_no: number;
      reason: "negative" | "overrun";
      detail?: string;
    }[],
  ) {
    super(
      `Pay-app lines invalid: ${failures.map((f) => `#${f.sov_line_no} ${f.reason}`).join(", ")}`,
    );
    this.name = "PayAppLineValidationError";
  }
}

/** Throws when any this_period < 0 or prev + this_period > scheduled. */
export function validateCertifyInput(lines: readonly PayAppLine[]): void {
  const failures: { sov_line_no: number; reason: "negative" | "overrun"; detail?: string }[] = [];
  for (const l of lines) {
    if (Number(l.this_period) < 0) {
      failures.push({ sov_line_no: l.sov_line_no, reason: "negative" });
      continue;
    }
    const totalCents = toCents(l.prev_certified) + toCents(l.this_period);
    if (totalCents > toCents(l.scheduled_amount)) {
      failures.push({
        sov_line_no: l.sov_line_no,
        reason: "overrun",
        detail: `${fromCents(totalCents).toFixed(2)} > scheduled ${l.scheduled_amount.toFixed(2)}`,
      });
    }
  }
  if (failures.length) throw new PayAppLineValidationError(failures);
}

export type ReconciliationFailure =
  | { rule: "contract_status"; detail: string }
  | { rule: "line_overrun"; sov_line_nos: number[] }
  | { rule: "contract_value_overrun"; detail: string }
  | { rule: "totals_integrity"; detail: string };

export interface ReconciliationResult {
  ok: boolean;
  checked_at: string;
  contract_status: string;
  failures: ReconciliationFailure[];
}

export function reconcilePayApp(input: {
  contract_status: string;
  contract_value: number | null;
  lines: readonly PayAppLine[];
  totals: Pick<PayAppTotals, "total_certified">;
  now?: Date;
}): ReconciliationResult {
  const failures: ReconciliationFailure[] = [];
  const signed = ["signed", "active"];
  if (!signed.includes(input.contract_status)) {
    failures.push({
      rule: "contract_status",
      detail: `contract status is ${input.contract_status}; must be signed or active`,
    });
  }
  const overruns: number[] = [];
  let sumCents = 0;
  for (const l of input.lines) {
    const totalCents = toCents(l.prev_certified) + toCents(l.this_period);
    sumCents += totalCents;
    if (totalCents > toCents(l.scheduled_amount)) overruns.push(l.sov_line_no);
  }
  if (overruns.length) failures.push({ rule: "line_overrun", sov_line_nos: overruns });

  if (input.contract_value != null) {
    if (sumCents > toCents(input.contract_value)) {
      failures.push({
        rule: "contract_value_overrun",
        detail: `total certified ${fromCents(sumCents).toFixed(2)} exceeds contract value ${input.contract_value.toFixed(2)}`,
      });
    }
  }
  if (Math.abs(sumCents - toCents(input.totals.total_certified)) > 1) {
    failures.push({
      rule: "totals_integrity",
      detail: `line sum ${fromCents(sumCents).toFixed(2)} != totals.total_certified ${input.totals.total_certified.toFixed(2)}`,
    });
  }
  return {
    ok: failures.length === 0,
    checked_at: (input.now ?? new Date()).toISOString(),
    contract_status: input.contract_status,
    failures,
  };
}

/** Next INV-#### number per company, given all existing invoice_numbers for that company. */
export function nextInvoiceNumber(existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^INV-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

export function nextPayAppNumber(existingForContract: readonly number[]): number {
  return existingForContract.length === 0 ? 1 : Math.max(...existingForContract) + 1;
}

export interface PayAppRow {
  id: string;
  company_id: string;
  project_id: string;
  contract_id: string;
  application_number: number;
  period_start: string;
  period_end: string;
  status: PayAppStatus;
  lines: PayAppLine[];
  total_scheduled: number;
  total_certified: number;
  retention_pct: number;
  retention_amount: number;
  net_amount: number;
  reconciliation: ReconciliationResult | Record<string, never>;
  certified_by: string | null;
  certified_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_note: string | null;
  invoice_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function payAppStatusLabel(s: PayAppStatus): string {
  return {
    draft: "Draft",
    submitted: "Submitted",
    certified: "Certified",
    approved: "Approved",
    rejected: "Rejected",
    invoiced: "Invoiced",
  }[s];
}
