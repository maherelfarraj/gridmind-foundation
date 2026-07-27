// P-208 — GL export pure rules: schemas, mapping resolution, journal line
// emission, balancing and CSV shaping. No I/O — fully unit testable.
import { z } from "zod";

export const GL_WRITE_ROLES = ["finance_admin", "company_admin"] as const;

export const GL_EVENT_TYPES = [
  "invoice_receivable_issued",
  "invoice_payable_received",
  "payment_received",
  "payment_made",
  "retention_withheld",
  "change_order_approved",
  "debit_note_issued",
] as const;

export type GlEventType = (typeof GL_EVENT_TYPES)[number];

export const GL_EVENT_LABELS: Record<GlEventType, string> = {
  invoice_receivable_issued: "Receivable invoice issued",
  invoice_payable_received: "Payable invoice received",
  payment_received: "Payment received",
  payment_made: "Payment made",
  retention_withheld: "Retention withheld",
  change_order_approved: "Change order approved",
  debit_note_issued: "Debit note issued",
};

export const SOURCE_TABLE: Record<GlEventType, string> = {
  invoice_receivable_issued: "invoice",
  invoice_payable_received: "invoice",
  payment_received: "payment",
  payment_made: "payment",
  retention_withheld: "pay_application",
  change_order_approved: "change_order",
  debit_note_issued: "debit_note",
};

/** Statuses that make a source eligible for the ledger. */
export const RECEIVABLE_INVOICE_STATUSES = [
  "approved",
  "sent",
  "partially_paid",
  "paid",
] as const;
export const PAYABLE_INVOICE_STATUSES = ["approved"] as const;
export const PAYMENT_RECORD_STATUSES = ["recorded"] as const;
export const PAY_APP_STATUSES = ["approved"] as const;
export const CHANGE_ORDER_STATUSES = ["approved"] as const;
export const DEBIT_NOTE_STATUSES = ["issued"] as const;

export const ACCOUNT_CODE_RE = /^[A-Za-z0-9]{4,10}$/;

const accountCode = z
  .string()
  .trim()
  .regex(ACCOUNT_CODE_RE, "Account codes must be 4–10 alphanumeric characters.");
const accountName = z.string().trim().min(2).max(120);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date (YYYY-MM-DD).");

export const GenerateGlExportSchema = z
  .object({
    company_id: z.string().uuid().optional(),
    period_from: isoDate,
    period_to: isoDate,
  })
  .refine((v) => v.period_to >= v.period_from, {
    message: "period_to must be on or after period_from",
    path: ["period_to"],
  });
export type GenerateGlExportInput = z.infer<typeof GenerateGlExportSchema>;

export const UpdateGlMappingSchema = z.object({
  event_type: z.enum(GL_EVENT_TYPES),
  debit_account_code: accountCode,
  debit_account_name: accountName,
  credit_account_code: accountCode,
  credit_account_name: accountName,
  enabled: z.boolean(),
});
export type UpdateGlMappingInput = z.infer<typeof UpdateGlMappingSchema>;

export const RunIdSchema = z.object({ run_id: z.string().uuid() });

// ---------------------------------------------------------------- types

export interface GlMapping {
  id?: string;
  event_type: GlEventType;
  debit_account_code: string;
  debit_account_name: string;
  credit_account_code: string;
  credit_account_name: string;
  enabled: boolean;
}

/** One economic event, already normalised and converted to base currency. */
export interface GlSourceEvent {
  event_type: GlEventType;
  source_type: string;
  source_id: string;
  source_number: string;
  counterparty: string | null;
  detail: string | null;
  entry_date: string;
  amount_base: number;
  currency_code: string;
  project_id: string | null;
}

export interface GlLine {
  line_no: number;
  entry_date: string;
  event_type: GlEventType;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  currency_code: string;
  memo: string;
  source_type: string;
  source_id: string;
  source_number: string;
  project_id: string | null;
}

export interface GlUnbalancedSource {
  source_number: string;
  source_type: string;
  event_type: GlEventType;
  reason: string;
}

export interface GlGenerationResult {
  lines: GlLine[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  unbalanced: GlUnbalancedSource[];
  missing_mappings: GlEventType[];
  disabled_mappings: GlEventType[];
  source_counts: Record<string, number>;
}

// ------------------------------------------------------------- helpers

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Human-readable memo: "INV-0042 · NEPCO · milestone 3". */
export function buildMemo(event: GlSourceEvent): string {
  return [event.source_number, event.counterparty, event.detail]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(" · ");
}

export function resolveMapping(
  mappings: readonly GlMapping[],
  eventType: GlEventType,
): GlMapping | null {
  const found = mappings.find((m) => m.event_type === eventType);
  if (!found || !found.enabled) return null;
  return found;
}

/**
 * Emit exactly two lines (one debit, one credit) per source event, in base
 * currency. Sources without an enabled mapping are reported, never guessed.
 */
export function buildJournal(
  events: readonly GlSourceEvent[],
  mappings: readonly GlMapping[],
  baseCurrency: string,
): GlGenerationResult {
  const lines: GlLine[] = [];
  const unbalanced: GlUnbalancedSource[] = [];
  const missing = new Set<GlEventType>();
  const disabled = new Set<GlEventType>();
  const counts: Record<string, number> = {};

  let lineNo = 0;
  for (const event of events) {
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    const mapping = resolveMapping(mappings, event.event_type);
    if (!mapping) {
      const declared = mappings.find((m) => m.event_type === event.event_type);
      if (declared) disabled.add(event.event_type);
      else missing.add(event.event_type);
      unbalanced.push({
        source_number: event.source_number,
        source_type: event.source_type,
        event_type: event.event_type,
        reason: declared
          ? `Mapping for ${GL_EVENT_LABELS[event.event_type]} is disabled.`
          : `No account mapping for ${GL_EVENT_LABELS[event.event_type]}.`,
      });
      continue;
    }

    const amount = round2(event.amount_base);
    if (!Number.isFinite(amount) || amount <= 0) {
      unbalanced.push({
        source_number: event.source_number,
        source_type: event.source_type,
        event_type: event.event_type,
        reason: "Amount in base currency is zero or unavailable.",
      });
      continue;
    }

    const memo = buildMemo(event);
    const shared = {
      entry_date: event.entry_date,
      event_type: event.event_type,
      currency_code: baseCurrency,
      memo,
      source_type: event.source_type,
      source_id: event.source_id,
      source_number: event.source_number,
      project_id: event.project_id,
    };
    lineNo += 1;
    lines.push({
      ...shared,
      line_no: lineNo,
      account_code: mapping.debit_account_code,
      account_name: mapping.debit_account_name,
      debit: amount,
      credit: 0,
    });
    lineNo += 1;
    lines.push({
      ...shared,
      line_no: lineNo,
      account_code: mapping.credit_account_code,
      account_name: mapping.credit_account_name,
      debit: 0,
      credit: amount,
    });
  }

  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  const balanced = unbalanced.length === 0 && Math.abs(totalDebit - totalCredit) <= 0.01;

  return {
    lines,
    total_debit: totalDebit,
    total_credit: totalCredit,
    balanced,
    unbalanced,
    missing_mappings: [...missing],
    disabled_mappings: [...disabled],
    source_counts: counts,
  };
}

// ----------------------------------------------------------------- CSV

export const GL_CSV_HEADERS = [
  "entry_date",
  "account_code",
  "account_name",
  "debit",
  "credit",
  "currency",
  "memo",
  "source_type",
  "source_id",
] as const;

export function glCsvRows(lines: readonly GlLine[]): (readonly unknown[])[] {
  return lines.map((l) => [
    l.entry_date,
    l.account_code,
    l.account_name,
    l.debit ? l.debit.toFixed(2) : "",
    l.credit ? l.credit.toFixed(2) : "",
    l.currency_code,
    l.memo,
    l.source_type,
    l.source_id,
  ]);
}

export function glExportPath(companyId: string, runNumber: string): string {
  return `${companyId}/gl-exports/${runNumber}.csv`;
}

/** First day of the month before `today`, i.e. the usual last closed period. */
export function defaultPeriod(today: string): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const last = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${prevYear}-${pad(prevMonth)}-01`,
    to: `${prevYear}-${pad(prevMonth)}-${pad(last)}`,
  };
}
