// P-197 — Work-in-progress (revenue recognition) pure math.
// No I/O here: every function is unit-testable in isolation.
import { z } from "zod";

import {
  OVER_BILLED_THRESHOLD_PCT,
  UNDER_BILLED_THRESHOLD_PCT,
} from "@/lib/finance/wip-thresholds";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export const GetWipReportSchema = z.object({
  project_id: z.string().uuid(),
  as_of_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type GetWipReportInput = z.infer<typeof GetWipReportSchema>;

// ---------------------------------------------------------------------------
// Status sets — exact, per spec
// ---------------------------------------------------------------------------
/** Contracts that carry earned revenue. */
export const WIP_CONTRACT_STATUSES = ["signed", "active"] as const;
/** Certified progress counts as earned revenue; draft/rejected never do. */
export const EARNED_PAY_APP_STATUSES = ["certified", "approved", "invoiced"] as const;
/** Issued receivable invoices; draft/cancelled (and disputed/submitted) excluded. */
export const BILLED_INVOICE_STATUSES = ["approved", "sent", "partially_paid", "paid"] as const;
/** Only non-voided payment records count as collected. */
export const COLLECTED_PAYMENT_STATUS = "recorded" as const;

export const WIP_FULL_ROLES = ["finance_admin", "company_admin"] as const;
export const WIP_READ_ROLES = ["project_admin"] as const;
export type WipAccessLevel = "full" | "read" | "none";

/** Formula strings surfaced in column tooltips and the PDF footnote. */
export const WIP_FORMULAS = {
  earned:
    "Earned revenue = Σ pay_applications.total_certified where status ∈ (certified, approved, invoiced) and period_end ≤ as-of date (certified percentage-of-completion).",
  billed:
    "Billed = Σ invoices.amount for receivable invoices on the contract where status ∈ (approved, sent, partially_paid, paid) and issue_date ≤ as-of date.",
  collected:
    "Collected = Σ payments.amount on those invoices where record_status = recorded and payment_date ≤ as-of date.",
  wip: "WIP = Earned − Billed. Positive = under-billed (asset: earned ahead of invoicing); negative = over-billed (liability).",
  retention:
    "Retention withheld = Σ pay_applications.retention_amount over the same certified pay applications.",
  percentComplete: "% complete = Earned revenue ÷ contract value (contracts.value).",
} as const;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export interface WipContractInput {
  id: string;
  contract_number: string;
  counterparty: string;
  status: string;
  value: number;
  currency_code: string;
  project_id: string;
}

export interface WipPayAppInput {
  contract_id: string | null;
  status: string;
  period_end: string | null;
  total_certified: number | null;
  retention_amount: number | null;
}

export interface WipInvoiceInput {
  id: string;
  contract_id: string | null;
  direction: string;
  status: string;
  issue_date: string | null;
  amount: number | null;
}

export interface WipPaymentInput {
  invoice_id: string | null;
  record_status: string;
  payment_date: string | null;
  amount: number | null;
}

export type BillingFlag = "under_billed" | "over_billed" | "balanced";

export interface WipContractRow {
  contract_id: string;
  contract_number: string;
  counterparty: string;
  status: string;
  value: number;
  currency_code: string;
  earned: number;
  billed: number;
  collected: number;
  wip: number;
  retention_withheld: number;
  percent_complete: number;
  flag: BillingFlag;
  /** WIP magnitude exceeds the company threshold for its direction. */
  over_threshold: boolean;
}

export interface WipRollup {
  earned: number;
  billed: number;
  collected: number;
  wip: number;
  retention_withheld: number;
  contract_value: number;
  under_billed: number;
  over_billed: number;
  contracts: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Inclusive on-or-before comparison; a missing date never qualifies. */
export function onOrBefore(date: string | null | undefined, asOf: string): boolean {
  if (!date) return false;
  return date.slice(0, 10) <= asOf;
}

export function isEarnedPayApp(p: WipPayAppInput, asOf: string): boolean {
  return (
    (EARNED_PAY_APP_STATUSES as readonly string[]).includes(p.status) &&
    onOrBefore(p.period_end, asOf)
  );
}

export function isBilledInvoice(i: WipInvoiceInput, asOf: string): boolean {
  return (
    i.direction === "receivable" &&
    (BILLED_INVOICE_STATUSES as readonly string[]).includes(i.status) &&
    onOrBefore(i.issue_date, asOf)
  );
}

export function isCollectedPayment(p: WipPaymentInput, asOf: string): boolean {
  return p.record_status === COLLECTED_PAYMENT_STATUS && onOrBefore(p.payment_date, asOf);
}

export function isWipContract(c: { status: string }): boolean {
  return (WIP_CONTRACT_STATUSES as readonly string[]).includes(c.status);
}

export function billingFlag(wip: number): BillingFlag {
  if (wip > 0) return "under_billed";
  if (wip < 0) return "over_billed";
  return "balanced";
}

export function exceedsThreshold(wip: number, contractValue: number): boolean {
  const v = Math.abs(num(contractValue));
  if (v <= 0) return false;
  const ratio = Math.abs(wip) / v;
  return wip >= 0 ? ratio > UNDER_BILLED_THRESHOLD_PCT : ratio > OVER_BILLED_THRESHOLD_PCT;
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------
export function computeWipRows(
  contracts: WipContractInput[],
  payApps: WipPayAppInput[],
  invoices: WipInvoiceInput[],
  payments: WipPaymentInput[],
  asOf: string,
): WipContractRow[] {
  const eligible = contracts.filter(isWipContract);

  const earnedBy = new Map<string, number>();
  const retentionBy = new Map<string, number>();
  for (const p of payApps) {
    if (!p.contract_id || !isEarnedPayApp(p, asOf)) continue;
    earnedBy.set(p.contract_id, (earnedBy.get(p.contract_id) ?? 0) + num(p.total_certified));
    retentionBy.set(p.contract_id, (retentionBy.get(p.contract_id) ?? 0) + num(p.retention_amount));
  }

  const billedBy = new Map<string, number>();
  const invoiceContract = new Map<string, string>();
  for (const i of invoices) {
    if (!i.contract_id || !isBilledInvoice(i, asOf)) continue;
    invoiceContract.set(i.id, i.contract_id);
    billedBy.set(i.contract_id, (billedBy.get(i.contract_id) ?? 0) + num(i.amount));
  }

  const collectedBy = new Map<string, number>();
  for (const p of payments) {
    if (!p.invoice_id || !isCollectedPayment(p, asOf)) continue;
    const contractId = invoiceContract.get(p.invoice_id);
    if (!contractId) continue;
    collectedBy.set(contractId, (collectedBy.get(contractId) ?? 0) + num(p.amount));
  }

  return eligible.map((c) => {
    const earned = earnedBy.get(c.id) ?? 0;
    const billed = billedBy.get(c.id) ?? 0;
    const collected = collectedBy.get(c.id) ?? 0;
    const wip = earned - billed;
    const value = num(c.value);
    return {
      contract_id: c.id,
      contract_number: c.contract_number,
      counterparty: c.counterparty,
      status: c.status,
      value,
      currency_code: c.currency_code,
      earned,
      billed,
      collected,
      wip,
      retention_withheld: retentionBy.get(c.id) ?? 0,
      percent_complete: value > 0 ? earned / value : 0,
      flag: billingFlag(wip),
      over_threshold: exceedsThreshold(wip, value),
    };
  });
}

export function rollupWip(rows: WipContractRow[]): WipRollup {
  const acc: WipRollup = {
    earned: 0,
    billed: 0,
    collected: 0,
    wip: 0,
    retention_withheld: 0,
    contract_value: 0,
    under_billed: 0,
    over_billed: 0,
    contracts: rows.length,
  };
  for (const r of rows) {
    acc.earned += r.earned;
    acc.billed += r.billed;
    acc.collected += r.collected;
    acc.wip += r.wip;
    acc.retention_withheld += r.retention_withheld;
    acc.contract_value += r.value;
    if (r.wip > 0) acc.under_billed += r.wip;
    if (r.wip < 0) acc.over_billed += -r.wip;
  }
  return acc;
}

export const BILLING_FLAG_LABEL: Record<BillingFlag, string> = {
  under_billed: "Under-billed",
  over_billed: "Over-billed",
  balanced: "Balanced",
};
