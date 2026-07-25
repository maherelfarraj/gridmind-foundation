// P-088 — HSE pure helpers, zod schemas, and 24-hour rule.
import { z } from "zod";

// ---------------------------------------------------------------------------
// enums / constants
// ---------------------------------------------------------------------------
export const INCIDENT_TYPES = [
  "injury",
  "near_miss",
  "property_damage",
  "environmental",
  "security",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export const INCIDENT_TYPE_LABELS: Record<IncidentType, string> = {
  injury: "Injury",
  near_miss: "Near miss",
  property_damage: "Property damage",
  environmental: "Environmental",
  security: "Security",
};

export const INCIDENT_SEVERITIES = ["minor", "moderate", "major", "critical", "fatal"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = ["open", "investigating", "closed"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INSPECTION_STATUSES = ["scheduled", "completed", "closed"] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const CHECKLIST_RESULTS = ["pass", "fail", "na"] as const;
export type ChecklistResult = (typeof CHECKLIST_RESULTS)[number];

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
export const correctiveActionSchema = z.object({
  id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(200).nullable().optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  done_at: z.string().datetime().nullable().optional(),
});
export type CorrectiveAction = z.infer<typeof correctiveActionSchema>;

export const incidentInput = z.object({
  projectId: z.string().uuid(),
  incidentType: z.enum(INCIDENT_TYPES),
  severity: z.enum(INCIDENT_SEVERITIES).default("minor"),
  occurredAt: z.string().datetime(),
  location: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().min(3).max(4000),
  personsInvolved: z.string().trim().max(2000).nullable().optional(),
  daysAwayFromWork: z.number().int().min(0).max(3650).default(0),
  restrictedDuty: z.boolean().default(false),
  medicalTreatment: z.boolean().default(false),
  oshaRecordable: z.boolean().default(false),
  correctiveActions: z.array(correctiveActionSchema).default([]),
});
export type IncidentInput = z.infer<typeof incidentInput>;

export const incidentUpdateInput = incidentInput.partial().extend({
  id: z.string().uuid(),
  status: z.enum(INCIDENT_STATUSES).optional(),
});

export const incidentCloseInput = z.object({
  id: z.string().uuid(),
  closingNotes: z.string().trim().max(2000).nullable().optional(),
});

export const checklistItemSchema = z.object({
  id: z.string().uuid().optional(),
  item: z.string().trim().min(1).max(500),
  result: z.enum(CHECKLIST_RESULTS).default("pass"),
  notes: z.string().trim().max(1000).nullable().optional(),
  resolved: z.boolean().optional(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const inspectionInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  inspectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  inspectionType: z.string().trim().min(1).max(60).default("routine"),
  area: z.string().trim().max(200).nullable().optional(),
  checklist: z.array(checklistItemSchema).default([]),
  status: z.enum(INSPECTION_STATUSES).default("scheduled"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type InspectionInput = z.infer<typeof inspectionInput>;

export const trainingInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  personName: z.string().trim().min(1).max(200),
  course: z.string().trim().min(1).max(200),
  provider: z.string().trim().max(200).nullable().optional(),
  completedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  certificatePath: z.string().trim().max(500).nullable().optional(),
});
export type TrainingInput = z.infer<typeof trainingInput>;

// ---------------------------------------------------------------------------
// 24-hour rule
// ---------------------------------------------------------------------------
const MS_PER_HOUR = 3_600_000;

export function hoursSinceOccurred(occurredAt: string | Date, now: Date = new Date()): number {
  const t = new Date(occurredAt).getTime();
  return (now.getTime() - t) / MS_PER_HOUR;
}

export interface CountdownBadge {
  kind: "countdown";
  hoursRemaining: number;
}
export interface LateBadge {
  kind: "late";
  hoursLate: number;
}
export interface OnTimeBadge {
  kind: "on_time";
}
export type IncidentTimingBadge = CountdownBadge | LateBadge | OnTimeBadge;

/**
 * Returns a countdown badge if the incident is inside its 24h logging window,
 * a "late" badge if reported_at − occurred_at > 24h, or an on-time badge.
 * `reportedAt` may be null/undefined for drafts — treated as "not yet reported".
 */
export function incidentTimingBadge(
  occurredAt: string | Date,
  reportedAt: string | Date | null | undefined,
  now: Date = new Date(),
): IncidentTimingBadge {
  const elapsed = hoursSinceOccurred(occurredAt, now);
  if (reportedAt) {
    const reportedGap =
      (new Date(reportedAt).getTime() - new Date(occurredAt).getTime()) / MS_PER_HOUR;
    if (reportedGap > 24) {
      return { kind: "late", hoursLate: reportedGap - 24 };
    }
  }
  if (elapsed < 24) {
    return {
      kind: "countdown",
      hoursRemaining: Math.max(0, 24 - elapsed),
    };
  }
  return { kind: "on_time" };
}

/** True while the incident is still inside its unlogged 24h window. */
export function isInUnloggedWindow(
  occurredAt: string | Date,
  reportedAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const elapsed = hoursSinceOccurred(occurredAt, now);
  if (elapsed >= 24) return false;
  if (!reportedAt) return true;
  const gap = (new Date(reportedAt).getTime() - new Date(occurredAt).getTime()) / MS_PER_HOUR;
  return gap < 24;
}

// ---------------------------------------------------------------------------
// TRIR
// ---------------------------------------------------------------------------
/** TRIR = (OSHA recordables × 200,000) / manpower hours. Null if hours ≤ 0. */
export function computeTrir(recordables: number, hours: number): number | null {
  if (!Number.isFinite(hours) || hours <= 0) return null;
  if (!Number.isFinite(recordables) || recordables < 0) return null;
  return (recordables * 200_000) / hours;
}

// ---------------------------------------------------------------------------
// checklist / findings
// ---------------------------------------------------------------------------
export interface ChecklistSummary {
  findingsCount: number;
  openFindings: number;
}
export function summarizeChecklist(items: readonly ChecklistItem[]): ChecklistSummary {
  let findings = 0;
  let open = 0;
  for (const it of items) {
    if (it.result === "fail") {
      findings += 1;
      if (!it.resolved) open += 1;
    }
  }
  return { findingsCount: findings, openFindings: open };
}

// ---------------------------------------------------------------------------
// training expiry
// ---------------------------------------------------------------------------
export type TrainingExpiryStatus = "expired" | "expiring_30" | "valid" | "no_expiry";
export function trainingExpiryStatus(
  expiresOn: string | null | undefined,
  now: Date = new Date(),
): TrainingExpiryStatus {
  if (!expiresOn) return "no_expiry";
  const t = new Date(expiresOn + "T23:59:59Z").getTime();
  const nowMs = now.getTime();
  if (t < nowMs) return "expired";
  const daysLeft = (t - nowMs) / (24 * MS_PER_HOUR);
  if (daysLeft <= 30) return "expiring_30";
  return "valid";
}

// ---------------------------------------------------------------------------
// incident number sequencing
// ---------------------------------------------------------------------------
export function nextIncidentNumber(existing: readonly string[], prefix = "HSE-"): string {
  let max = 0;
  for (const n of existing) {
    if (!n?.startsWith(prefix)) continue;
    const rest = n.slice(prefix.length);
    const asInt = Number.parseInt(rest, 10);
    if (Number.isFinite(asInt) && asInt > max) max = asInt;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// role helpers (UI only — RLS enforces on the server)
// ---------------------------------------------------------------------------
export function canEditIncident(roles: readonly string[]): boolean {
  return (
    roles.includes("hse_admin") ||
    roles.includes("construction_admin") ||
    roles.includes("company_admin") ||
    roles.includes("super_admin")
  );
}
export function canWriteInspection(roles: readonly string[]): boolean {
  return (
    roles.includes("hse_admin") || roles.includes("company_admin") || roles.includes("super_admin")
  );
}
export const canWriteTraining = canWriteInspection;
