// P-068 — Pure expediting helpers: status derivation, KPI thresholds, schemas.
import { z } from "zod";

export const EXPEDITING_STATUSES = [
  "on_track",
  "at_risk",
  "delayed",
  "delivered",
] as const;
export type ExpeditingStatus = (typeof EXPEDITING_STATUSES)[number];

export const CONTACT_STALE_DAYS = 14;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// date helpers
// ---------------------------------------------------------------------------
function parseDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Whole days between `site_need_date` and today (UTC). Positive = future. */
export function daysUntilNeed(
  siteNeedDate: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  const d = parseDate(siteNeedDate);
  if (!d) return null;
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const needUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((needUtc - nowUtc) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// status derivation
// ---------------------------------------------------------------------------
export interface StatusInputs {
  current_eta: string | Date | null | undefined;
  site_need_date: string | Date | null | undefined;
  delivery_window_start?: string | Date | null;
  delivery_window_end?: string | Date | null;
  last_vendor_contact_at?: string | Date | null;
  fully_received: boolean;
}

export function deriveStatus(
  input: StatusInputs,
  now: Date = new Date(),
): ExpeditingStatus {
  if (input.fully_received) return "delivered";
  const eta = parseDate(input.current_eta);
  const need = parseDate(input.site_need_date);
  if (eta && need && eta.getTime() > need.getTime()) return "delayed";

  const winStart = parseDate(input.delivery_window_start);
  const winEnd = parseDate(input.delivery_window_end);
  const etaInWindow =
    eta && winStart && winEnd
      ? eta.getTime() >= winStart.getTime() && eta.getTime() <= winEnd.getTime()
      : false;
  const contact = parseDate(input.last_vendor_contact_at);
  const contactAgeDays = contact
    ? (now.getTime() - contact.getTime()) / MS_PER_DAY
    : Number.POSITIVE_INFINITY;
  if (etaInWindow && contactAgeDays > CONTACT_STALE_DAYS) return "at_risk";
  return "on_track";
}

// ---------------------------------------------------------------------------
// long-lead KPI (Stage-3 exit gate)
// ---------------------------------------------------------------------------
export type KpiBand = "green" | "amber" | "destructive";

export interface KpiRow {
  is_long_lead: boolean;
  status: ExpeditingStatus;
  eta_confirmed: boolean;
}

export interface LongLeadKpi {
  total: number;
  ready: number;
  pct: number; // 0-100
  band: KpiBand;
}

export function computeLongLeadKpi(rows: KpiRow[]): LongLeadKpi {
  const lls = rows.filter((r) => r.is_long_lead);
  const total = lls.length;
  const ready = lls.filter(
    (r) => r.status === "delivered" || r.eta_confirmed,
  ).length;
  const pct = total === 0 ? 0 : (ready / total) * 100;
  const band: KpiBand =
    total === 0 ? "amber" : pct >= 95 ? "green" : pct >= 85 ? "amber" : "destructive";
  return { total, ready, pct, band };
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const importFromPoSchema = z.object({
  poId: z.string().uuid(),
  longLeadLineNos: z.array(z.number().int().min(1).max(9999)).default([]),
  defaultSiteNeedDate: isoDate.nullable().optional(),
});

export const updateExpeditingSchema = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      current_eta: isoDate.nullable().optional(),
      eta_confirmed: z.boolean().optional(),
      site_need_date: isoDate.optional(),
      promised_delivery_date: isoDate.nullable().optional(),
      delivery_window_start: isoDate.nullable().optional(),
      delivery_window_end: isoDate.nullable().optional(),
      is_long_lead: z.boolean().optional(),
      notes: z.string().trim().max(4000).nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, "empty patch"),
});
