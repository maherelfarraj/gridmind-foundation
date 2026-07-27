// P-199 — Finance alerts: pure rules, schemas and evaluators (no I/O).
import { z } from "zod";

import type { StatusTone } from "@/components/ui/status-badge";
import { AGING_BUCKETS, type AgingBucketKey } from "@/lib/finance/aging-weights";
import { bucketFor, balanceOf, daysBetween, daysPastDue } from "@/lib/ar-aging.rules";

export const FINANCE_ALERT_RULE_TYPES = [
  "overdue_invoice_days",
  "ar_aging_threshold",
  "unbilled_certified_value",
  "payment_unmatched_days",
] as const;
export type FinanceAlertRuleType = (typeof FINANCE_ALERT_RULE_TYPES)[number];

export const FINANCE_ALERT_STATUSES = ["open", "acknowledged", "dismissed"] as const;
export type FinanceAlertStatus = (typeof FINANCE_ALERT_STATUSES)[number];

export const FINANCE_ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type FinanceAlertSeverity = (typeof FINANCE_ALERT_SEVERITIES)[number];

export const FINANCE_ALERT_FULL_ROLES = ["finance_admin", "company_admin"] as const;
export const FINANCE_ALERT_READ_ROLES = ["project_admin"] as const;
export type FinanceAlertAccess = "full" | "read" | "none";

export const NOTIFY_ROLE_OPTIONS = [
  "finance_admin",
  "company_admin",
  "project_admin",
  "procurement_admin",
] as const;

export function ruleTypeLabel(t: FinanceAlertRuleType): string {
  return {
    overdue_invoice_days: "Overdue invoices",
    ar_aging_threshold: "AR aging threshold",
    unbilled_certified_value: "Unbilled certified value",
    payment_unmatched_days: "Unmatched payments",
  }[t];
}

export function ruleTypeHint(t: FinanceAlertRuleType): string {
  return {
    overdue_invoice_days:
      "Fires per receivable invoice past due by more than the configured days (critical beyond 2×).",
    ar_aging_threshold: "Fires once when the chosen aging bucket total reaches the amount.",
    unbilled_certified_value:
      "Fires per contract where certified earned revenue exceeds billed by the amount.",
    payment_unmatched_days:
      "Fires per recorded payment left unmatched longer than the configured days.",
  }[t];
}

export function severityTone(s: string): StatusTone {
  if (s === "critical") return "critical";
  if (s === "warning") return "attention";
  return "active";
}

export function alertStatusTone(s: string): StatusTone {
  if (s === "acknowledged") return "positive";
  if (s === "dismissed") return "inactive";
  return "attention";
}

// ---------------------------------------------------------------------------
// Threshold shapes per rule type
// ---------------------------------------------------------------------------
export const DaysThresholdSchema = z.object({ days: z.number().int().min(0).max(3650) });
export const AmountThresholdSchema = z.object({ amount_base: z.number().min(0) });
export const AgingThresholdSchema = z.object({
  amount_base: z.number().min(0),
  bucket: z.enum(AGING_BUCKETS as unknown as [AgingBucketKey, ...AgingBucketKey[]]),
});

export type ThresholdValue = string | number | boolean | null;
export type ThresholdMap = Record<string, ThresholdValue>;

export function parseThreshold(ruleType: FinanceAlertRuleType, raw: unknown): ThresholdMap {
  switch (ruleType) {
    case "overdue_invoice_days":
    case "payment_unmatched_days":
      return DaysThresholdSchema.parse(raw);
    case "ar_aging_threshold":
      return AgingThresholdSchema.parse(raw);
    case "unbilled_certified_value":
      return AmountThresholdSchema.parse(raw);
  }
}

export function defaultThreshold(ruleType: FinanceAlertRuleType): ThresholdMap {
  switch (ruleType) {
    case "overdue_invoice_days":
      return { days: 30 };
    case "payment_unmatched_days":
      return { days: 14 };
    case "ar_aging_threshold":
      return { amount_base: 100000, bucket: "d90_plus" };
    case "unbilled_certified_value":
      return { amount_base: 50000 };
  }
}

export const SaveAlertRuleSchema = z.object({
  id: z.string().uuid().optional(),
  rule_type: z.enum(FINANCE_ALERT_RULE_TYPES),
  threshold: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  enabled: z.boolean(),
  notify_role: z.enum(NOTIFY_ROLE_OPTIONS),
});
export type SaveAlertRuleInput = z.infer<typeof SaveAlertRuleSchema>;

export const ListAlertsSchema = z.object({
  status: z.enum([...FINANCE_ALERT_STATUSES, "all"]).default("open"),
  rule_type: z.enum([...FINANCE_ALERT_RULE_TYPES, "all"]).default("all"),
});
export type ListAlertsInput = z.infer<typeof ListAlertsSchema>;

export const AlertActionSchema = z.object({
  alert_id: z.string().uuid(),
  action: z.enum(["acknowledge", "dismiss"]),
});
export type AlertActionInput = z.infer<typeof AlertActionSchema>;

// ---------------------------------------------------------------------------
// Evaluators — pure. Each returns candidate alerts (no ids/dates attached).
// ---------------------------------------------------------------------------
export interface AlertCandidate {
  entity_type: "invoice" | "contract" | "payment" | "company";
  entity_id: string;
  severity: FinanceAlertSeverity;
  message: string;
  metadata: ThresholdMap;
}

export interface OverdueInvoiceInput {
  id: string;
  invoice_number: string;
  direction: string;
  status: string;
  due_date: string | null;
  amount: number;
  tax_amount: number;
  paid_amount: number;
}

export function evaluateOverdueInvoices(
  invoices: OverdueInvoiceInput[],
  days: number,
  today: string,
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const inv of invoices) {
    if (inv.direction !== "receivable") continue;
    const balance = balanceOf(inv);
    if (balance <= 0.005) continue;
    const past = daysPastDue(inv.due_date, today);
    if (!(past > days)) continue;
    out.push({
      entity_type: "invoice",
      entity_id: inv.id,
      severity: past > days * 2 ? "critical" : "warning",
      message: `Invoice ${inv.invoice_number} is ${past} days past due (balance ${balance.toFixed(2)}).`,
      metadata: { days_past_due: past, balance, threshold_days: days },
    });
  }
  return out;
}

export interface AgingBucketInput {
  direction: string;
  status: string;
  due_date: string | null;
  amount: number;
  tax_amount: number;
  paid_amount: number;
}

/** Sum of open receivable balances landing in one aging bucket. */
export function bucketTotal(
  invoices: AgingBucketInput[],
  bucket: AgingBucketKey,
  today: string,
): number {
  let total = 0;
  for (const inv of invoices) {
    if (inv.direction !== "receivable") continue;
    const balance = balanceOf(inv);
    if (balance <= 0.005) continue;
    if (bucketFor(daysPastDue(inv.due_date, today)) !== bucket) continue;
    total += balance;
  }
  return Math.round(total * 100) / 100;
}

export function evaluateArAging(
  companyId: string,
  invoices: AgingBucketInput[],
  bucket: AgingBucketKey,
  amountBase: number,
  today: string,
): AlertCandidate[] {
  const total = bucketTotal(invoices, bucket, today);
  if (total < amountBase) return [];
  return [
    {
      entity_type: "company",
      entity_id: companyId,
      severity: total >= amountBase * 2 ? "critical" : "warning",
      message: `AR aging bucket ${bucket} totals ${total.toFixed(2)}, at or above the ${amountBase.toFixed(2)} threshold.`,
      metadata: { bucket, total, threshold_amount_base: amountBase },
    },
  ];
}

export interface UnbilledContractInput {
  contract_id: string;
  contract_number: string;
  earned: number;
  billed: number;
}

export function evaluateUnbilledCertified(
  rows: UnbilledContractInput[],
  amountBase: number,
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const r of rows) {
    const unbilled = Math.round((r.earned - r.billed) * 100) / 100;
    if (unbilled < amountBase) continue;
    out.push({
      entity_type: "contract",
      entity_id: r.contract_id,
      severity: unbilled >= amountBase * 2 ? "critical" : "warning",
      message: `Contract ${r.contract_number} has ${unbilled.toFixed(2)} of certified work not yet invoiced.`,
      metadata: {
        unbilled,
        earned: r.earned,
        billed: r.billed,
        threshold_amount_base: amountBase,
      },
    });
  }
  return out;
}

export interface UnmatchedPaymentInput {
  id: string;
  payment_number: string | null;
  record_status: string;
  reconciliation_status: string;
  payment_date: string | null;
}

export function evaluateUnmatchedPayments(
  payments: UnmatchedPaymentInput[],
  days: number,
  today: string,
): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const p of payments) {
    if (p.record_status !== "recorded") continue;
    if (p.reconciliation_status !== "unmatched") continue;
    if (!p.payment_date) continue;
    const age = daysBetween(p.payment_date, today);
    if (!(age > days)) continue;
    out.push({
      entity_type: "payment",
      entity_id: p.id,
      severity: age > days * 2 ? "critical" : "warning",
      message: `Payment ${p.payment_number ?? p.id} has been unmatched for ${age} days.`,
      metadata: { days_unmatched: age, threshold_days: days },
    });
  }
  return out;
}
