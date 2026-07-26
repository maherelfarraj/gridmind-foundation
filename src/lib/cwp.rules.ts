// P-179 — Pure rules for CWPs, look-ahead plans, weighting, delay & recovery.
// No React / Supabase imports here: everything is deterministic and testable.
import { z } from "zod";

export const CWP_STATUSES = [
  "draft",
  "planned",
  "in_progress",
  "on_hold",
  "complete",
  "cancelled",
] as const;
export type CwpStatus = (typeof CWP_STATUSES)[number];

export const LOOK_AHEAD_STATUSES = ["draft", "published", "locked"] as const;
export type LookAheadStatus = (typeof LOOK_AHEAD_STATUSES)[number];

export const DELAY_CAUSES = [
  "weather",
  "material",
  "design",
  "labor",
  "equipment",
  "client",
  "permit",
  "access",
  "other",
] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];

export const RECOVERY_PLAN_STATUSES = ["draft", "active", "achieved", "abandoned"] as const;
export type RecoveryPlanStatus = (typeof RECOVERY_PLAN_STATUSES)[number];

export const UOMS = ["m3", "m", "t", "kW", "kWh", "item"] as const;

/** CWP-0001 / RCP-0001 style sequence numbers, per company. */
export function formatSequenceNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Highest sequence held by an existing set of numbers with the given prefix. */
export function nextSequence(prefix: string, existing: readonly string[]): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** ISO date string (YYYY-MM-DD) that falls on a Monday. */
export function isMonday(isoDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const d = new Date(`${isoDate}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 1;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const uuid = z.string().uuid();

export const cwpCreateSchema = z
  .object({
    projectId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional().nullable(),
    discipline: z.string().trim().min(1).max(60).default("general"),
    area: z.string().trim().max(120).optional().nullable(),
    wbsItemId: uuid.optional().nullable(),
    plannedStart: isoDate.optional().nullable(),
    plannedEnd: isoDate.optional().nullable(),
    weight: z.number().min(0).max(9999).default(1),
  })
  .refine((v) => !v.plannedStart || !v.plannedEnd || v.plannedEnd >= v.plannedStart, {
    message: "planned_end must be on or after planned_start",
    path: ["plannedEnd"],
  });

export const cwpUpdateSchema = z.object({
  id: uuid,
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  discipline: z.string().trim().min(1).max(60).optional(),
  area: z.string().trim().max(120).nullable().optional(),
  wbsItemId: uuid.nullable().optional(),
  plannedStart: isoDate.nullable().optional(),
  plannedEnd: isoDate.nullable().optional(),
  status: z.enum(CWP_STATUSES).optional(),
  weight: z.number().min(0).max(9999).optional(),
  progressPct: z.number().min(0).max(100).optional(),
});

export const lookAheadEntrySchema = z.object({
  cwp_id: uuid.nullable().optional(),
  schedule_task_id: uuid.nullable().optional(),
  day: isoDate,
  crew_size: z.number().int().min(0).max(2000).default(0),
  constraints: z.array(z.string().trim().max(200)).default([]),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const lookAheadUpsertSchema = z.object({
  projectId: uuid,
  weekStart: isoDate.refine(isMonday, { message: "week_start must be a Monday" }),
  entries: z.array(lookAheadEntrySchema).max(500).default([]),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export const lookAheadStatusSchema = z.object({
  id: uuid,
  status: z.enum(["published", "locked"]),
});

export const weightingRuleSchema = z.object({
  projectId: uuid.nullable().optional(),
  discipline: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  uom: z.enum(UOMS),
  targetQty: z.number().positive(),
  weightPct: z.number().min(0).max(100),
  isActive: z.boolean().default(true),
});

export const delayAnalysisSchema = z.object({
  projectId: uuid,
  scheduleTaskId: uuid.nullable().optional(),
  cwpId: uuid.nullable().optional(),
  weatherDelayId: uuid.nullable().optional(),
  delayDate: isoDate,
  cause: z.enum(DELAY_CAUSES),
  lostDays: z.number().min(0).max(3650).default(0),
  narrative: z.string().trim().max(4000).nullable().optional(),
  eotClaim: z.boolean().default(false),
});

export const recoveryPlanSchema = z.object({
  projectId: uuid,
  delayAnalysisId: uuid.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  actions: z
    .array(
      z.object({
        action: z.string().trim().min(1).max(400),
        owner: z.string().trim().max(160).nullable().optional(),
        due_date: isoDate.nullable().optional(),
        status: z.enum(["open", "in_progress", "done"]).default("open"),
      }),
    )
    .max(200)
    .default([]),
  targetRecoveryDate: isoDate.nullable().optional(),
});

/**
 * Weighted rollup of CWP progress: sum(weight * progress) / sum(weight).
 * Returns 0 when no weighted packages exist (never NaN).
 */
export function rollupProgress(
  packages: ReadonlyArray<{ weight: number; progress_pct: number }>,
): number {
  const totalWeight = packages.reduce((s, p) => s + (p.weight || 0), 0);
  if (totalWeight <= 0) return 0;
  const earned = packages.reduce((s, p) => s + (p.weight || 0) * (p.progress_pct || 0), 0);
  return Math.round((earned / totalWeight) * 100) / 100;
}
