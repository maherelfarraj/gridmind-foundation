// P-086 — DPR rules, schemas, and pure helpers.
import { z } from "zod";

export const TRADES = [
  "civil",
  "mechanical",
  "electrical",
  "hse",
  "general",
  "other",
] as const;
export type Trade = (typeof TRADES)[number];

export const TRADE_LABELS: Record<Trade, string> = {
  civil: "Civil",
  mechanical: "Mechanical",
  electrical: "Electrical",
  hse: "HSE",
  general: "General",
  other: "Other",
};

export const WEATHER_DELAY_TYPES = [
  "rain",
  "wind",
  "heat",
  "cold",
  "dust_storm",
  "lightning",
  "other",
] as const;
export type WeatherDelayType = (typeof WEATHER_DELAY_TYPES)[number];

export const DPR_STATUSES = ["draft", "submitted", "approved"] as const;
export type DprStatus = (typeof DPR_STATUSES)[number];

export const SHIFTS = ["day", "night"] as const;
export type Shift = (typeof SHIFTS)[number];

export const OBSERVATION_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type ObservationSeverity = (typeof OBSERVATION_SEVERITIES)[number];

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------
/** Optional client idempotency key used by the offline queue. */
const idem = z.string().uuid().optional();

export const dprHeaderInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  shift: z.enum(SHIFTS).default("day"),
  weatherSummary: z.string().trim().max(500).nullable().optional(),
  temperatureHighC: z.number().min(-50).max(70).nullable().optional(),
  temperatureLowC: z.number().min(-50).max(70).nullable().optional(),
  workSummary: z.string().trim().max(4000).nullable().optional(),
  constraintsNotes: z.string().trim().max(4000).nullable().optional(),
  clientIdempotencyKey: idem,
});
export type DprHeaderInput = z.infer<typeof dprHeaderInput>;

export const manpowerRowInput = z.object({
  dprId: z.string().uuid(),
  trade: z.enum(TRADES),
  contractor: z.string().trim().max(120).nullable().optional(),
  headcount: z.number().int().min(0).max(9999),
  hours: z.number().min(0).max(24),
  notes: z.string().trim().max(500).nullable().optional(),
  clientIdempotencyKey: idem,
});

export const weatherDelayInput = z.object({
  dprId: z.string().uuid(),
  delayType: z.enum(WEATHER_DELAY_TYPES),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  lostHours: z.number().min(0).max(24),
  wbsItemId: z.string().uuid().nullable().optional(),
  impactNotes: z.string().trim().max(1000).nullable().optional(),
  clientIdempotencyKey: idem,
});

export const quantityRowInput = z.object({
  dprId: z.string().uuid(),
  wbsItemId: z.string().uuid(),
  area: z.string().trim().max(120).nullable().optional(),
  quantity: z.number().min(0).max(1_000_000),
  uom: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  clientIdempotencyKey: idem,
});

export const attachPhotoInput = z.object({
  dprId: z.string().uuid().nullable().optional(),
  observationId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid(),
  filePath: z.string().min(1).max(1024),
  caption: z.string().trim().max(500).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  discipline: z.string().trim().max(60).nullable().optional(),
  clientIdempotencyKey: idem,
});

export const observationInput = z.object({
  dprId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid(),
  severity: z.enum(OBSERVATION_SEVERITIES),
  description: z.string().trim().min(1).max(2000),
  area: z.string().trim().max(120).nullable().optional(),
  discipline: z.string().trim().max(60).default("general"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  clientIdempotencyKey: idem,
});

export const submitDprInput = z.object({
  id: z.string().uuid(),
  acknowledgeNoPhotos: z.boolean().default(false),
  clientIdempotencyKey: idem,
});

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------
export interface ManpowerLike {
  headcount: number;
  hours: number | string;
}

export function sumManpower(rows: readonly ManpowerLike[]): {
  totalManpower: number;
  totalHours: number;
} {
  let totalManpower = 0;
  let totalHours = 0;
  for (const r of rows) {
    const hc = Number(r.headcount) || 0;
    const h = Number(r.hours) || 0;
    totalManpower += hc;
    totalHours += hc * h;
  }
  // round hours to 2 decimals to avoid floating drift
  return {
    totalManpower,
    totalHours: Math.round(totalHours * 100) / 100,
  };
}

/** Rules for editing a DPR row. */
export function canEditDpr(
  status: DprStatus,
  roles: readonly string[],
  isCreator: boolean,
): boolean {
  if (status !== "draft") return false;
  if (isCreator) return true;
  return roles.some((r) =>
    ["foreman", "construction_admin", "company_admin"].includes(r),
  );
}

export function canApproveDpr(roles: readonly string[]): boolean {
  return roles.some((r) =>
    ["construction_admin", "company_admin"].includes(r),
  );
}

/** Normalize a WBS discipline text into the canonical set. */
export function normalizeDiscipline(
  raw: string | null | undefined,
): "civil" | "mechanical" | "electrical" | "other" {
  const t = (raw ?? "").toLowerCase();
  if (/civ/.test(t)) return "civil";
  if (/mech|struct/.test(t)) return "mechanical";
  if (/elec|dc|ac|inverter|module|hv|mv|lv/.test(t)) return "electrical";
  return "other";
}

/**
 * Build the storage object key for a site photo.
 * Company UUID MUST come first — the `storage_company_id` policy reads
 * the first folder segment to gate access.
 */
export function photoObjectPath(
  companyId: string,
  projectId: string,
  reportDate: string, // YYYY-MM-DD
  filename: string,
): string {
  const safe = filename.replace(/[^\w.-]+/g, "_").slice(0, 100);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${companyId}/${projectId}/field/${reportDate}/${id}-${safe}`;
}

/** Server-side submit validation. Returns null when OK, else an error code. */
export function submitBlockedReason(
  args: {
    manpowerCount: number;
    photoCount: number;
    acknowledgeNoPhotos: boolean;
  },
): string | null {
  if (args.manpowerCount <= 0) return "manpower_required";
  if (args.photoCount <= 0 && !args.acknowledgeNoPhotos)
    return "photos_required_ack";
  return null;
}
