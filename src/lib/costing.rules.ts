// GC-01 — Pure roll-up rules for the project Costing workspace.
//
// Calculation definitions (single source of truth for the module):
//   committed  = approved POs + active subcontracts + approved (not yet
//                incorporated) change orders. Cancelled/terminated/rejected
//                commitments are excluded. Incorporated change orders are
//                excluded because they are already folded into
//                budgets.approved_changes -> current budget.
//   actual     = payable invoices in a booked status (approved/sent/
//                partially_paid/paid). Draft, cancelled and disputed excluded.
//   accruals   = approved manual accrual entries only (draft/reversed ignored).
//   ETC        = sum of forecast periods when any exist, else the residual
//                max(0, current - actual - accruals).
//   EAC        = actual + accruals + ETC
//   VAC        = current - EAC
//   available  = current - max(committed, actual + accruals)   // no double count
//   paid       = recorded payable payments (voided excluded)
//   outstanding= actual - paid
import { z } from "zod";

import { fxOverrideSchema } from "@/lib/costing.fx";

// ---------------------------------------------------------------------------
// Status sets
// ---------------------------------------------------------------------------
export const COMMITTED_PO_STATUSES = [
  "approved",
  "issued",
  "partially_received",
  "received",
  "closed",
] as const;

export const COMMITTED_SUBCONTRACT_STATUSES = ["active", "complete"] as const;

/** Approved but not yet incorporated into the budget baseline. */
export const COMMITTED_CHANGE_ORDER_STATUSES = ["approved"] as const;

export const BOOKED_INVOICE_STATUSES = ["approved", "sent", "partially_paid", "paid"] as const;

export function isCommittedPo(status: string): boolean {
  return (COMMITTED_PO_STATUSES as readonly string[]).includes(status);
}
export function isCommittedSubcontract(status: string): boolean {
  return (COMMITTED_SUBCONTRACT_STATUSES as readonly string[]).includes(status);
}
export function isCommittedChangeOrder(status: string): boolean {
  return (COMMITTED_CHANGE_ORDER_STATUSES as readonly string[]).includes(status);
}
export function isBookedInvoice(direction: string, status: string): boolean {
  return direction === "payable" && (BOOKED_INVOICE_STATUSES as readonly string[]).includes(status);
}
export function isRecordedPayment(direction: string, recordStatus: string): boolean {
  return direction === "payable" && recordStatus === "recorded";
}
export function isCountedAccrual(status: string): boolean {
  return status === "approved";
}

/** Does this commitment row contribute to committed cost? Single source of truth. */
export function isCommittedCommitment(row: {
  kind: "purchase_order" | "subcontract" | "change_order";
  status: string;
}): boolean {
  if (row.kind === "purchase_order") return isCommittedPo(row.status);
  if (row.kind === "subcontract") return isCommittedSubcontract(row.status);
  return isCommittedChangeOrder(row.status);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------
export interface CostingBudgetInput {
  original_amount: number;
  approved_changes: number;
  current_amount: number;
  currency_code: string;
}
export interface CostingCommitmentInput {
  id: string;
  kind: "purchase_order" | "subcontract" | "change_order";
  reference: string;
  counterparty: string | null;
  status: string;
  amount: number;
  currency_code: string;
}
export interface CostingInvoiceInput {
  id: string;
  direction: string;
  status: string;
  amount: number;
  currency_code: string;
}
export interface CostingPaymentInput {
  id: string;
  direction: string;
  record_status: string;
  amount: number;
  currency_code: string;
}
export interface CostingAccrualInput {
  id: string;
  status: string;
  amount: number;
  currency_code: string;
}
export interface CostingForecastInput {
  id: string;
  etc_amount: number;
  currency_code: string;
}

export interface CostingInput {
  budgets: CostingBudgetInput[];
  commitments: CostingCommitmentInput[];
  invoices: CostingInvoiceInput[];
  payments: CostingPaymentInput[];
  accruals: CostingAccrualInput[];
  forecasts: CostingForecastInput[];
}

export interface CostingRollup {
  currency_code: string;
  original: number;
  approved_changes: number;
  current: number;
  committed: number;
  committed_po: number;
  committed_subcontract: number;
  committed_change_order: number;
  actual: number;
  accruals: number;
  etc: number;
  eac: number;
  variance_at_completion: number;
  available: number;
  paid: number;
  outstanding: number;
  has_forecast: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function num(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/** Dedupe by id so repeated rows can never double-count a measure. */
function dedupe<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function currencies(input: CostingInput): string[] {
  const set = new Set<string>();
  for (const b of input.budgets) set.add(b.currency_code);
  for (const c of input.commitments) set.add(c.currency_code);
  for (const i of input.invoices) set.add(i.currency_code);
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Roll-up
// ---------------------------------------------------------------------------
export function computeCostingRollup(input: CostingInput): CostingRollup[] {
  return currencies(input).map((code) => rollupForCurrency(input, code));
}

function rollupForCurrency(input: CostingInput, code: string): CostingRollup {
  const budgets = input.budgets.filter((b) => b.currency_code === code);
  const commitments = dedupe(input.commitments).filter((c) => c.currency_code === code);
  const invoices = dedupe(input.invoices).filter((i) => i.currency_code === code);
  const payments = dedupe(input.payments).filter((p) => p.currency_code === code);
  const accruals = dedupe(input.accruals).filter((a) => a.currency_code === code);
  const forecasts = dedupe(input.forecasts).filter((f) => f.currency_code === code);

  const original = sum(budgets.map((b) => num(b.original_amount)));
  const approved_changes = sum(budgets.map((b) => num(b.approved_changes)));
  const current = sum(budgets.map((b) => num(b.current_amount)));

  const committed_po = sum(
    commitments.filter((c) => c.kind === "purchase_order" && isCommittedPo(c.status)).map(amt),
  );
  const committed_subcontract = sum(
    commitments
      .filter((c) => c.kind === "subcontract" && isCommittedSubcontract(c.status))
      .map(amt),
  );
  const committed_change_order = sum(
    commitments
      .filter((c) => c.kind === "change_order" && isCommittedChangeOrder(c.status))
      .map(amt),
  );
  const committed = round2(committed_po + committed_subcontract + committed_change_order);

  const actual = sum(invoices.filter((i) => isBookedInvoice(i.direction, i.status)).map(amt));
  const paid = sum(
    payments.filter((p) => isRecordedPayment(p.direction, p.record_status)).map(amt),
  );
  const accrued = sum(accruals.filter((a) => isCountedAccrual(a.status)).map(amt));

  const has_forecast = forecasts.length > 0;
  const etc = has_forecast
    ? sum(forecasts.map((f) => num(f.etc_amount)))
    : round2(Math.max(0, current - actual - accrued));

  const eac = round2(actual + accrued + etc);

  return {
    currency_code: code,
    original: round2(original),
    approved_changes: round2(approved_changes),
    current: round2(current),
    committed,
    committed_po: round2(committed_po),
    committed_subcontract: round2(committed_subcontract),
    committed_change_order: round2(committed_change_order),
    actual: round2(actual),
    accruals: round2(accrued),
    etc: round2(etc),
    eac,
    variance_at_completion: round2(current - eac),
    available: round2(current - Math.max(committed, actual + accrued)),
    paid: round2(paid),
    outstanding: round2(actual - paid),
    has_forecast,
  };
}

function amt(x: { amount: number }): number {
  return num(x.amount);
}
function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------
export type CostingBand = "ok" | "warning" | "destructive";

export function costingBand(value: number, base: number): CostingBand {
  if (base <= 0) return value < 0 ? "destructive" : "ok";
  const ratio = value / base;
  if (ratio < -0.05) return "destructive";
  if (ratio < 0) return "warning";
  return "ok";
}

export function formatCostingMoney(amount: number, code: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code || "USD",
      maximumFractionDigits: 0,
    }).format(num(amount));
  } catch {
    return `${round2(amount)} ${code}`;
  }
}

// ---------------------------------------------------------------------------
// Schemas — forecast + accruals
// ---------------------------------------------------------------------------
const monthPeriod = z
  .string()
  .regex(/^\d{4}-\d{2}-01$/, "Period must be the first day of a month (YYYY-MM-01)");

export const costingProjectSchema = z.object({ projectId: z.string().uuid() });

export const forecastUpsertSchema = z.object({
  projectId: z.string().uuid(),
  cost_code_id: z.string().uuid(),
  period: monthPeriod,
  etc_amount: z.number().nonnegative().max(999_999_999_999),
  currency_code: z.string().trim().length(3),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Controlled manual FX override; requires a reason and is audited. */
  fx_override: fxOverrideSchema,
});

export const forecastDeleteSchema = z.object({ id: z.string().uuid() });

export const accrualCreateSchema = z.object({
  projectId: z.string().uuid(),
  cost_code_id: z.string().uuid(),
  period: monthPeriod,
  amount: z.number().positive().max(999_999_999_999),
  currency_code: z.string().trim().length(3),
  description: z.string().trim().max(1000).nullable().optional(),
  /** Controlled manual FX override; requires a reason and is audited. */
  fx_override: fxOverrideSchema,
});

export const accrualTransitionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reverse"]),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ForecastUpsertInput = z.infer<typeof forecastUpsertSchema>;
export type AccrualCreateInput = z.infer<typeof accrualCreateSchema>;
export type AccrualTransitionInput = z.infer<typeof accrualTransitionSchema>;

export type AccrualStatus = "draft" | "approved" | "reversed";

/** Draft -> approved -> reversed. Reversed is terminal; drafts cannot be reversed. */
export function canTransitionAccrual(from: AccrualStatus, action: "approve" | "reverse"): boolean {
  if (action === "approve") return from === "draft";
  return from === "approved";
}

export function nextAccrualStatus(
  from: AccrualStatus,
  action: "approve" | "reverse",
): AccrualStatus {
  return action === "approve" ? "approved" : "reversed";
}

export function monthKey(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
