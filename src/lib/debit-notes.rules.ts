// P-080 — Debit notes shared rules and schemas.
import { z } from "zod";

export const DEBIT_NOTE_STATUSES = ["draft", "issued", "settled", "cancelled"] as const;
export type DebitNoteStatus = (typeof DEBIT_NOTE_STATUSES)[number];

export const DEBIT_NOTE_REASONS = [
  "backcharge",
  "defect_rectification",
  "delay_damages",
  "other",
] as const;
export type DebitNoteReason = (typeof DEBIT_NOTE_REASONS)[number];

export function debitNoteReasonLabel(r: string): string {
  const map: Record<string, string> = {
    backcharge: "Backcharge",
    defect_rectification: "Defect rectification",
    delay_damages: "Delay damages",
    other: "Other",
  };
  return map[r] ?? r;
}

export function debitNoteStatusLabel(s: DebitNoteStatus): string {
  return { draft: "Draft", issued: "Issued", settled: "Settled", cancelled: "Cancelled" }[s];
}

export const DebitNoteUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    project_id: z.string().uuid().nullable().optional(),
    contract_id: z.string().uuid().nullable().optional(),
    invoice_id: z.string().uuid().nullable().optional(),
    reason: z.enum(DEBIT_NOTE_REASONS),
    amount: z.number().finite().nonnegative(),
    currency_code: z.string().length(3),
    notes: z.string().max(2000).nullable().optional(),
  })
  .refine((d) => d.contract_id || d.invoice_id, {
    message: "A debit note must be linked to a contract or an invoice.",
    path: ["contract_id"],
  });
export type DebitNoteUpsertInput = z.infer<typeof DebitNoteUpsertSchema>;

export const DebitNoteIdSchema = z.object({ id: z.string().uuid() });

/** Next DN-#### number for the company. */
export function nextDebitNoteNumber(existing: readonly string[]): string {
  let max = 0;
  for (const n of existing) {
    const m = /^DN-(\d+)$/.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `DN-${String(max + 1).padStart(4, "0")}`;
}

export interface DebitNoteRow {
  id: string;
  company_id: string;
  project_id: string | null;
  contract_id: string | null;
  invoice_id: string | null;
  note_number: string;
  status: DebitNoteStatus;
  reason: string;
  amount: number;
  currency_code: string;
  issued_at: string | null;
  settled_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
