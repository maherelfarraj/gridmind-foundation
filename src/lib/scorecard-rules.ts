// P-069 — Vendor scorecard pure rules.
import { z } from "zod";

export const RECOMPUTE_ROLES = [
  "procurement_admin",
  "procurement_officer",
  "company_admin",
] as const;

export const periodSchema = z
  .object({
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((v) => v.periodStart <= v.periodEnd, {
    message: "periodStart must be on or before periodEnd",
  });

export const recomputeSchema = periodSchema.and(
  z.object({ projectId: z.string().uuid().nullable().optional() }),
);

export const listSchema = periodSchema;

export interface GrnInput {
  po_id: string;
  status: string;
  defects_count: number;
  received_at: string | null;
}

export interface ExpeditingInput {
  status: string;
  last_vendor_contact_at: string | null;
}

const STALE_CONTACT_DAYS = 14;
const RESPONSIVENESS_PENALTY = 10;

export function computeOtdPct(
  grns: GrnInput[],
  poDueMap: Record<string, string | null>,
): number | null {
  const eligible = grns.filter((g) => g.received_at && poDueMap[g.po_id]);
  if (eligible.length === 0) return null;
  const onTime = eligible.filter((g) => {
    const rec = (g.received_at as string).slice(0, 10);
    const due = poDueMap[g.po_id] as string;
    return rec <= due;
  }).length;
  return round2((onTime / eligible.length) * 100);
}

export function computeQuality(grns: GrnInput[]): number | null {
  if (grns.length === 0) return null;
  const defective = grns.filter(
    (g) => g.status === "has_defects" || (g.defects_count ?? 0) > 0,
  ).length;
  return round2(100 - (defective / grns.length) * 100);
}

export function computeResponsiveness(
  logs: ExpeditingInput[],
  now: Date = new Date(),
): number | null {
  if (logs.length === 0) return null;
  const cutoff = new Date(now.getTime() - STALE_CONTACT_DAYS * 24 * 3600 * 1000);
  let penalties = 0;
  for (const l of logs) {
    const stale = !l.last_vendor_contact_at || new Date(l.last_vendor_contact_at) < cutoff;
    const delayed = l.status === "delayed";
    if (stale || delayed) penalties += 1;
  }
  return Math.max(0, round2(100 - penalties * RESPONSIVENESS_PENALTY));
}

export type TrendDirection = "up" | "down" | "flat";

export function trend(
  current: number | null | undefined,
  prior: number | null | undefined,
): { delta: number; direction: TrendDirection } | null {
  if (current == null || prior == null) return null;
  const delta = round2(current - prior);
  const direction: TrendDirection = delta > 0.01 ? "up" : delta < -0.01 ? "down" : "flat";
  return { delta, direction };
}

export type StatusBand = "green" | "amber" | "destructive";

export function statusBand(otd: number | null | undefined): StatusBand | null {
  if (otd == null) return null;
  if (otd >= 95) return "green";
  if (otd >= 80) return "amber";
  return "destructive";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
