// P-078 — Contracts & obligations shared rules and schemas.
import { z } from "zod";

export const CONTRACT_TYPES = [
  "epc",
  "ppa",
  "supply",
  "service",
  "consulting",
  "lease",
  "other",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = [
  "draft",
  "negotiation",
  "signed",
  "active",
  "completed",
  "terminated",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const OBLIGATION_STATUSES = ["open", "in_progress", "fulfilled", "breached"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const SIGNED_STATUSES: ReadonlyArray<ContractStatus> = [
  "signed",
  "active",
  "completed",
  "terminated",
];

export const SovLineSchema = z.object({
  line_no: z.number().int().min(1),
  description: z.string().min(1).max(500),
  scheduled_amount: z.number().finite().nonnegative(),
});
export type SovLine = z.infer<typeof SovLineSchema>;

export const ContractUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  project_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(300),
  contract_type: z.enum(CONTRACT_TYPES),
  counterparty: z.string().min(1).max(300),
  status: z.enum(CONTRACT_STATUSES).optional(),
  value: z.number().finite().nonnegative().nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  effective_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  expiry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type ContractUpsertInput = z.infer<typeof ContractUpsertSchema>;

export const ObligationUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  contract_id: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(4000).nullable().optional(),
  clause_ref: z.string().max(120).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  status: z.enum(OBLIGATION_STATUSES).optional(),
  owner_id: z.string().uuid().nullable().optional(),
});
export type ObligationUpsertInput = z.infer<typeof ObligationUpsertSchema>;

export const ExtractedObligationSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional().nullable(),
  clause_ref: z.string().max(120).optional().nullable(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});
export type ExtractedObligation = z.infer<typeof ExtractedObligationSchema>;

export class SovMismatchError extends Error {
  constructor(
    public value: number,
    public total: number,
  ) {
    super(
      `Schedule of Values total ${total.toFixed(2)} does not match contract value ${value.toFixed(2)}`,
    );
    this.name = "SovMismatchError";
  }
}

/** Sum SOV lines with basic rounding to 2 decimals to dodge float drift. */
export function sovTotal(lines: readonly SovLine[]): number {
  const cents = lines.reduce((acc, l) => acc + Math.round(Number(l.scheduled_amount) * 100), 0);
  return cents / 100;
}

export function assertSovMatchesValue(
  value: number | null | undefined,
  lines: readonly SovLine[],
  tolerance = 0.01,
): void {
  if (value == null) return; // no value set → nothing to enforce
  if (lines.length === 0) return; // empty SOV allowed
  const total = sovTotal(lines);
  if (Math.abs(total - value) > tolerance) {
    throw new SovMismatchError(value, total);
  }
}

/** Return ISO date (yyyy-mm-dd) for signedAt + 7 years, month/day preserved. */
export function computeRetentionUntil(signedAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(signedAt);
  if (!m) throw new Error(`Invalid date: ${signedAt}`);
  const y = Number(m[1]);
  return `${y + 7}-${m[2]}-${m[3]}`;
}

/** An obligation is overdue when it has a due date in the past and is not resolved. */
export function isObligationOverdue(
  dueDate: string | null | undefined,
  status: ObligationStatus,
  today: Date = new Date(),
): boolean {
  if (!dueDate) return false;
  if (status === "fulfilled") return false;
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(dueMs)) return false;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return dueMs < todayMs;
}

export function contractLabelForType(t: ContractType): string {
  return {
    epc: "EPC",
    ppa: "PPA",
    supply: "Supply",
    service: "Service",
    consulting: "Consulting",
    lease: "Lease",
    other: "Other",
  }[t];
}

export function contractStatusLabel(s: ContractStatus): string {
  return {
    draft: "Draft",
    negotiation: "Negotiation",
    signed: "Signed",
    active: "Active",
    completed: "Completed",
    terminated: "Terminated",
  }[s];
}

export interface ContractRow {
  id: string;
  company_id: string;
  project_id: string | null;
  contract_number: string;
  title: string;
  contract_type: ContractType;
  counterparty: string;
  status: ContractStatus;
  value: number | null;
  currency_code: string | null;
  schedule_of_values: SovLine[];
  signed_at: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  file_path: string | null;
  retention_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ObligationRow {
  id: string;
  company_id: string;
  contract_id: string;
  title: string;
  description: string | null;
  clause_ref: string | null;
  due_date: string | null;
  status: ObligationStatus;
  owner_id: string | null;
  extracted_by_ai: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
