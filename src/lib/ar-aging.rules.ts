// P-195 — AR aging engine: pure, unit-testable rules (no I/O).
import { z } from "zod";

import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  agingWeight,
  type AgingBucketKey,
} from "@/lib/finance/aging-weights";

/** Only open receivables age — draft/submitted/under_review/disputed/cancelled/paid never appear. */
export const AGING_ELIGIBLE_STATUSES = ["approved", "sent", "partially_paid"] as const;

export const REMINDER_CHANNELS = ["email", "letter", "phone", "portal", "other"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export function reminderChannelLabel(c: ReminderChannel): string {
  return { email: "Email", letter: "Letter", phone: "Phone", portal: "Client portal", other: "Other" }[
    c
  ];
}

export const GetArAgingSchema = z.object({
  company_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});
export type GetArAgingInput = z.infer<typeof GetArAgingSchema>;

export const SendReminderSchema = z.object({
  invoice_id: z.string().uuid(),
  channel: z.enum(REMINDER_CHANNELS),
  template: z.string().trim().min(3).max(4000),
  notes: z.string().trim().max(2000).optional(),
});
export type SendReminderInput = z.infer<typeof SendReminderSchema>;

export const FORMULAS = {
  balance: "balance = amount + tax_amount − paid_amount",
  daysPastDue: "days past due = today − due_date (negative until due)",
  buckets:
    "current: ≤ 0 days · 1-30 · 31-60 · 61-90 · 90+ (exactly 30/60/90 land in the lower bucket)",
  totalAr: "total AR = Σ open receivable balances (base currency)",
  overdueAr: "overdue AR = Σ balances in all non-current buckets",
  expectedCash: "Σ balance × bucket probability",
  baseAmount: "base = balance × FX rate (latest rate on or before today)",
} as const;

// ---------------------------------------------------------------------------
// Core math
// ---------------------------------------------------------------------------
export interface AgingInvoiceInput {
  id: string;
  invoice_number: string;
  status: string;
  direction: string;
  due_date: string | null;
  amount: number;
  tax_amount: number;
  paid_amount: number;
  currency_code: string;
  /** Balance converted to the report base currency; null when no FX rate exists. */
  fx_rate_to_base: number | null;
  project_id: string | null;
  project_name: string | null;
  client_name: string | null;
  reminder_count: number;
}

export interface AgingInvoiceRow extends AgingInvoiceInput {
  balance: number;
  base_balance: number;
  fx_missing: boolean;
  days_past_due: number;
  bucket: AgingBucketKey;
}

const CENT = 100;
const round2 = (n: number) => Math.round(n * CENT) / CENT;

export function balanceOf(inv: { amount: number; tax_amount: number; paid_amount: number }): number {
  return round2(
    (Math.round(inv.amount * CENT) +
      Math.round(inv.tax_amount * CENT) -
      Math.round(inv.paid_amount * CENT)) /
      CENT,
  );
}

/** Whole days between two ISO dates (UTC, DST-safe). */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** days_past_due = today − due_date; negative before the due date, 0 on it. */
export function daysPastDue(dueDate: string | null, today: string): number {
  if (!dueDate) return 0;
  return daysBetween(dueDate, today);
}

/**
 * EXACT boundary rule: ≤0 current, 1..30, 31..60, 61..90, >90.
 * 30 → 1-30, 60 → 31-60, 90 → 61-90.
 */
export function bucketFor(days: number): AgingBucketKey {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export function isAgingEligible(inv: {
  direction: string;
  status: string;
  amount: number;
  tax_amount: number;
  paid_amount: number;
}): boolean {
  if (inv.direction !== "receivable") return false;
  if (!(AGING_ELIGIBLE_STATUSES as readonly string[]).includes(inv.status)) return false;
  return balanceOf(inv) > 0.005;
}

export function toAgingRow(inv: AgingInvoiceInput, today: string): AgingInvoiceRow {
  const balance = balanceOf(inv);
  const rate = inv.fx_rate_to_base;
  const days = daysPastDue(inv.due_date, today);
  return {
    ...inv,
    balance,
    base_balance: rate === null ? balance : round2(balance * rate),
    fx_missing: rate === null,
    days_past_due: days,
    bucket: bucketFor(days),
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------
export type BucketSums = Record<AgingBucketKey, number>;

export function emptyBuckets(): BucketSums {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

export interface AgingGroup {
  key: string;
  label: string;
  buckets: BucketSums;
  total: number;
  expected_cash: number;
  invoice_ids: string[];
}

export const UNLINKED_LABEL = "Unlinked";

function groupBy(
  rows: AgingInvoiceRow[],
  keyOf: (r: AgingInvoiceRow) => { key: string; label: string },
): AgingGroup[] {
  const map = new Map<string, AgingGroup>();
  for (const r of rows) {
    const { key, label } = keyOf(r);
    let g = map.get(key);
    if (!g) {
      g = { key, label, buckets: emptyBuckets(), total: 0, expected_cash: 0, invoice_ids: [] };
      map.set(key, g);
    }
    g.buckets[r.bucket] = round2(g.buckets[r.bucket] + r.base_balance);
    g.total = round2(g.total + r.base_balance);
    g.expected_cash = round2(g.expected_cash + r.base_balance * agingWeight(r.bucket));
    g.invoice_ids.push(r.id);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

export function groupByClient(rows: AgingInvoiceRow[]): AgingGroup[] {
  return groupBy(rows, (r) => {
    const label = r.client_name?.trim() || UNLINKED_LABEL;
    return { key: label, label };
  });
}

export function groupByProject(rows: AgingInvoiceRow[]): AgingGroup[] {
  return groupBy(rows, (r) => ({
    key: r.project_id ?? "__unlinked__",
    label: r.project_name?.trim() || UNLINKED_LABEL,
  }));
}

export function sumBuckets(groups: AgingGroup[]): BucketSums {
  const out = emptyBuckets();
  for (const g of groups) {
    for (const b of AGING_BUCKETS) out[b] = round2(out[b] + g.buckets[b]);
  }
  return out;
}

export function totalOf(buckets: BucketSums): number {
  return round2(AGING_BUCKETS.reduce((s, b) => s + buckets[b], 0));
}

export function overdueOf(buckets: BucketSums): number {
  return round2(
    AGING_BUCKETS.filter((b) => b !== "current").reduce((s, b) => s + buckets[b], 0),
  );
}

/** expected cash = Σ balance × weight(bucket) — weights live in aging-weights.ts. */
export function expectedCash(buckets: BucketSums): number {
  return round2(AGING_BUCKETS.reduce((s, b) => s + buckets[b] * agingWeight(b), 0));
}

export interface BucketBar {
  bucket: AgingBucketKey;
  label: string;
  balance: number;
  weight: number;
  expected: number;
}

export function bucketBars(buckets: BucketSums): BucketBar[] {
  return AGING_BUCKETS.map((b) => ({
    bucket: b,
    label: AGING_BUCKET_LABELS[b],
    balance: buckets[b],
    weight: agingWeight(b),
    expected: round2(buckets[b] * agingWeight(b)),
  }));
}

// ---------------------------------------------------------------------------
// Next-90-days expected-cash projection
// ---------------------------------------------------------------------------
export interface ForecastMonth {
  month: string; // YYYY-MM
  balance: number;
  expected: number;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Overdue balances are expected in the current month (collection effort now);
 * not-yet-due balances land in their due month, capped at today + 90 days.
 */
export function forecastByMonth(rows: AgingInvoiceRow[], today: string, horizonDays = 90): ForecastMonth[] {
  const horizon = addDaysIso(today, horizonDays);
  const map = new Map<string, ForecastMonth>();
  for (const r of rows) {
    const due = r.due_date && r.due_date > today ? r.due_date : today;
    if (due > horizon) continue;
    const key = monthKey(due);
    const m = map.get(key) ?? { month: key, balance: 0, expected: 0 };
    m.balance = round2(m.balance + r.base_balance);
    m.expected = round2(m.expected + r.base_balance * agingWeight(r.bucket));
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
