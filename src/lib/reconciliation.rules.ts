// P-198 — Bank reconciliation lite: pure rules, schemas and month math.
import { z } from "zod";

import type { StatusTone } from "@/components/ui/status-badge";

export const RECONCILIATION_STATUSES = ["unmatched", "matched", "partial", "excluded"] as const;
export type ReconStatus = (typeof RECONCILIATION_STATUSES)[number];

/** Statuses a reconcile action may target. */
export const RECONCILE_TARGET_STATUSES = ["matched", "partial", "excluded"] as const;
export type ReconTarget = (typeof RECONCILE_TARGET_STATUSES)[number];

/** Only these current statuses may be bulk-transitioned. */
export const BULK_SOURCE_STATUSES = ["unmatched", "partial"] as const;

export const RECON_FILTERS = ["unmatched", "matched", "partial", "excluded", "all"] as const;
export type ReconFilter = (typeof RECON_FILTERS)[number];

export const RECONCILED_TARGET_PCT = 0.9;

export const RECON_FORMULAS = {
  matchedPct:
    "matched % = matched payments ÷ (recorded payments in month − excluded). Voided payments are never counted.",
  excluded:
    "Excluded payments (e.g. personal card, not company funds) leave the denominator entirely.",
} as const;

export function reconStatusLabel(s: ReconStatus): string {
  switch (s) {
    case "matched":
      return "Matched";
    case "partial":
      return "Partial";
    case "excluded":
      return "Excluded";
    default:
      return "Unmatched";
  }
}

export function reconStatusTone(s: ReconStatus): StatusTone {
  switch (s) {
    case "matched":
      return "positive";
    case "partial":
      return "attention";
    case "excluded":
      return "inactive";
    default:
      return "active";
  }
}

// ---------------------------------------------------------------------------
// Month helpers — "YYYY-MM" ↔ inclusive ISO date range
// ---------------------------------------------------------------------------
export function currentMonth(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function monthLabel(month: string): string {
  const { from } = monthRange(month);
  return new Date(`${from}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// Monthly summary
// ---------------------------------------------------------------------------
export interface ReconPaymentLike {
  reconciliation_status: ReconStatus;
  record_status: "recorded" | "voided";
  amount: number;
}

export interface ReconSummary {
  total: number;
  matched: number;
  partial: number;
  unmatched: number;
  excluded: number;
  denominator: number;
  matched_pct: number | null;
  matched_amount: number;
  unmatched_amount: number;
}

export function summarize(rows: ReconPaymentLike[]): ReconSummary {
  const recorded = rows.filter((r) => r.record_status === "recorded");
  const count = (s: ReconStatus) => recorded.filter((r) => r.reconciliation_status === s).length;
  const matched = count("matched");
  const excluded = count("excluded");
  const denominator = recorded.length - excluded;
  const sum = (p: (r: ReconPaymentLike) => boolean) =>
    Math.round(recorded.filter(p).reduce((a, r) => a + r.amount, 0) * 100) / 100;
  return {
    total: recorded.length,
    matched,
    partial: count("partial"),
    unmatched: count("unmatched"),
    excluded,
    denominator,
    matched_pct: denominator > 0 ? matched / denominator : null,
    matched_amount: sum((r) => r.reconciliation_status === "matched"),
    unmatched_amount: sum((r) => r.reconciliation_status === "unmatched"),
  };
}

export function matchedPctStatus(pct: number | null): "neutral" | "good" | "warning" {
  if (pct === null) return "neutral";
  return pct >= RECONCILED_TARGET_PCT ? "good" : "warning";
}

/** Bulk reference for row #index using a shared statement prefix. */
export function bulkReference(prefix: string | null | undefined, index: number): string | null {
  const p = (prefix ?? "").trim();
  if (!p) return null;
  return `${p}-${String(index + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
export const ReconcilePaymentSchema = z
  .object({
    payment_id: z.string().uuid(),
    status: z.enum(RECONCILE_TARGET_STATUSES),
    bank_reference: z.string().trim().max(120).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== "excluded" || Boolean(v.note && v.note.length > 0), {
    message: "A note is required when excluding a payment.",
    path: ["note"],
  });
export type ReconcilePaymentInput = z.infer<typeof ReconcilePaymentSchema>;

export const BulkReconcileSchema = z
  .object({
    payment_ids: z.array(z.string().uuid()).min(1).max(200),
    status: z.enum(RECONCILE_TARGET_STATUSES),
    bank_reference_prefix: z.string().trim().max(80).optional().nullable(),
    note: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.status !== "excluded" || Boolean(v.note && v.note.length > 0), {
    message: "A note is required when excluding payments.",
    path: ["note"],
  });
export type BulkReconcileInput = z.infer<typeof BulkReconcileSchema>;

export const ListReconciliationSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  status: z.enum(RECON_FILTERS).default("unmatched"),
  direction: z.enum(["all", "receivable", "payable"]).default("all"),
});
export type ListReconciliationInput = z.infer<typeof ListReconciliationSchema>;
