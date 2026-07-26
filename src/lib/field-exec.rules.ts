// P-181 — Field execution rules, zod schemas and pure helpers.
// No React / Supabase imports: safe for unit tests and both runtimes.
import { z } from "zod";

export const EQUIPMENT_STATUSES = ["on_site", "standby", "off_hired", "breakdown"] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  on_site: "On site",
  standby: "Standby",
  off_hired: "Off hired",
  breakdown: "Breakdown",
};

export const DELIVERY_STATUSES = [
  "expected",
  "in_transit",
  "delivered",
  "partially_delivered",
  "rejected",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  expected: "Expected",
  in_transit: "In transit",
  delivered: "Delivered",
  partially_delivered: "Partially delivered",
  rejected: "Rejected",
};

export const FIELD_DISCIPLINES = [
  "general",
  "civil",
  "mechanical",
  "electrical",
  "hse",
  "other",
] as const;

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
export const workFrontInput = z.object({
  id: uuid.optional(),
  projectId: uuid,
  name: z.string().trim().min(1).max(120),
  area: z.string().trim().max(120).nullable().optional(),
  discipline: z.enum(FIELD_DISCIPLINES).default("general"),
  isActive: z.boolean().default(true),
});
export type WorkFrontInput = z.infer<typeof workFrontInput>;

export const crewAssignmentInput = z.object({
  workFrontId: uuid,
  assignmentDate: isoDate,
  trade: z.string().trim().min(1).max(60),
  contractor: z.string().trim().max(120).nullable().optional(),
  headcount: z.number().int().min(0).max(9999),
  cwpId: uuid.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const equipmentRecordInput = z.object({
  id: uuid.optional(),
  dprId: uuid,
  equipmentTag: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).nullable().optional(),
  category: z.string().trim().max(60).nullable().optional(),
  status: z.enum(EQUIPMENT_STATUSES).default("on_site"),
  hours: z.number().min(0).max(24),
  operatorName: z.string().trim().max(120).nullable().optional(),
  fuelLitres: z.number().min(0).max(99_999).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export const materialConsumptionInput = z.object({
  dprId: uuid,
  material: z.string().trim().min(1).max(160),
  qty: z.number().positive().max(1_000_000),
  uom: z.string().trim().min(1).max(30),
  cwpId: uuid.nullable().optional(),
  batchSerialId: uuid.nullable().optional(),
});

export const deliveryInput = z.object({
  id: uuid.optional(),
  projectId: uuid,
  purchaseOrderId: uuid.nullable().optional(),
  reference: z.string().trim().max(120).nullable().optional(),
  status: z.enum(DELIVERY_STATUSES).default("expected"),
  expectedDate: isoDate.nullable().optional(),
  deliveredAt: z.string().datetime().nullable().optional(),
  carrier: z.string().trim().max(120).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------
/** Roles allowed to write field-execution records. */
export const FIELD_WRITER_ROLES = [
  "construction_admin",
  "foreman",
  "field_technician",
  "company_admin",
] as const;

export interface CrewLike {
  work_front_id: string;
  assignment_date: string;
  headcount: number | string;
}

/** Total headcount per work front for a given date. */
export function crewHeadcountByFront(
  rows: readonly CrewLike[],
  date: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.assignment_date !== date) continue;
    out[r.work_front_id] = (out[r.work_front_id] ?? 0) + (Number(r.headcount) || 0);
  }
  return out;
}

export interface EquipmentLike {
  status: string;
  hours: number | string;
}

/**
 * Utilization = logged hours / (24h × units on site or standby).
 * Off-hired and broken-down units are excluded from the denominator.
 */
export function equipmentUtilization(rows: readonly EquipmentLike[]): number {
  const active = rows.filter((r) => r.status === "on_site" || r.status === "standby");
  if (active.length === 0) return 0;
  const hours = active.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  return Math.round((hours / (active.length * 24)) * 1000) / 10;
}

export const GPS_MAX_AGE_MS = 15 * 60_000;

export interface GpsClaim {
  source?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  gpsCapturedAt?: string | null;
}

/**
 * Mobile DPR submissions MUST carry a fresh GPS fix. Returns null when the
 * claim is acceptable, otherwise a human-readable rejection message.
 * Coordinates are never trusted beyond storage — they are only range-checked.
 */
export function gpsRejectionReason(claim: GpsClaim, nowMs: number): string | null {
  if (claim.source !== "mobile") return null;
  const { latitude, longitude, gpsCapturedAt } = claim;
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    !gpsCapturedAt
  ) {
    return "Location required — enable GPS on the device and retry the submission.";
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    return "Latitude is out of range.";
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return "Longitude is out of range.";
  }
  const capturedMs = Date.parse(gpsCapturedAt);
  if (Number.isNaN(capturedMs)) return "GPS capture time is not a valid timestamp.";
  if (Math.abs(nowMs - capturedMs) > GPS_MAX_AGE_MS) {
    return "GPS fix is stale — capture a new location within 15 minutes of submitting.";
  }
  return null;
}

/** Accepted media MIME prefixes for field capture. */
export function mediaTypeForFile(mime: string | null | undefined): "photo" | "video" {
  return (mime ?? "").startsWith("video/") ? "video" : "photo";
}
