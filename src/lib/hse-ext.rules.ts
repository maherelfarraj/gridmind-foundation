// P-185 — Pure rules for the HSE expansion (risk matrix, expiries, exceedance,
// audit scoring, numbering). No React, no Supabase imports.
import { z } from "zod";

/* ------------------------------- constants -------------------------------- */

export const RA_STATUSES = ["draft", "active", "archived"] as const;
export type RaStatus = (typeof RA_STATUSES)[number];

export const SAFETY_OBS_TYPES = ["safe_act", "unsafe_act", "unsafe_condition"] as const;
export type SafetyObsType = (typeof SAFETY_OBS_TYPES)[number];

export const OBS_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const OBS_STATUSES = ["open", "in_progress", "closed"] as const;

export const EMERGENCY_KINDS = ["drill", "actual"] as const;
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

export const EMERGENCY_EVENT_TYPES = [
  "medical",
  "fire",
  "env_spill",
  "security",
  "weather",
  "other",
] as const;

export const ENV_METRICS = [
  "noise_db",
  "dust_pm25",
  "water_quality",
  "soil",
  "emissions",
] as const;
export type EnvMetric = (typeof ENV_METRICS)[number];

export const WASTE_TYPES = ["general", "hazardous", "recyclable", "construction"] as const;
export type WasteType = (typeof WASTE_TYPES)[number];

export const AUDIT_STATUSES = ["scheduled", "completed", "closed"] as const;

export const COMPETENCY_EXPIRY_WARN_DAYS = 30;

/* ------------------------------ risk matrix -------------------------------- */

export type RiskBand = "low" | "medium" | "high" | "critical";

export interface Hazard {
  hazard: string;
  likelihood: number;
  severity: number;
  controls?: string | null;
  residual_likelihood?: number | null;
  residual_severity?: number | null;
}

export const hazardSchema = z.object({
  hazard: z.string().min(1),
  likelihood: z.number().int().min(1).max(5),
  severity: z.number().int().min(1).max(5),
  controls: z.string().nullable().optional(),
  residual_likelihood: z.number().int().min(1).max(5).nullable().optional(),
  residual_severity: z.number().int().min(1).max(5).nullable().optional(),
});

/** 5×5 matrix score. */
export function riskScore(likelihood: number, severity: number): number {
  return clamp5(likelihood) * clamp5(severity);
}

function clamp5(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function riskBand(score: number): RiskBand {
  if (score <= 4) return "low";
  if (score <= 9) return "medium";
  if (score <= 15) return "high";
  return "critical";
}

/** Residual score falls back to the inherent values when not yet assessed. */
export function residualScore(h: Hazard): number {
  return riskScore(h.residual_likelihood ?? h.likelihood, h.residual_severity ?? h.severity);
}

/** Semantic token classes only — never raw colours. */
export function riskBandClass(band: RiskBand): string {
  switch (band) {
    case "low":
      return "bg-success/15 text-success border-success/30";
    case "medium":
      return "bg-warning/15 text-warning-foreground border-warning/30";
    case "high":
      return "bg-destructive/10 text-destructive border-destructive/30";
    default:
      return "bg-destructive/20 text-destructive border-destructive/50";
  }
}

/** Highest residual risk across a hazard register (0 when empty). */
export function worstResidual(hazards: Hazard[]): number {
  return hazards.reduce((max, h) => Math.max(max, residualScore(h)), 0);
}

/* ------------------------------- competency -------------------------------- */

export function daysUntil(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const target = new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

export type ExpiryState = "none" | "valid" | "expiring" | "expired";

export function expiryState(
  expiry: string | null | undefined,
  now = new Date(),
  warnDays = COMPETENCY_EXPIRY_WARN_DAYS,
): ExpiryState {
  const d = daysUntil(expiry, now);
  if (d === null) return "none";
  if (d < 0) return "expired";
  if (d <= warnDays) return "expiring";
  return "valid";
}

/* ------------------------------ environmental ------------------------------ */

/** Server-computed exceedance — client input is never trusted for this flag. */
export function computeExceedance(value: number, limit: number | null | undefined): boolean {
  if (limit === null || limit === undefined || !Number.isFinite(limit)) return false;
  return value > limit;
}

/* ------------------------------ audit scoring ------------------------------ */

export interface AuditItem {
  item: string;
  result?: "pass" | "fail" | "na" | null;
  note?: string | null;
}

export const auditItemSchema = z.object({
  item: z.string().min(1),
  result: z.enum(["pass", "fail", "na"]).nullable().optional(),
  note: z.string().nullable().optional(),
});

export interface AuditScore {
  scorePct: number | null;
  findingsCount: number;
}

/** score_pct = passes / (passes + fails); "na" and unanswered items are excluded. */
export function scoreChecklist(items: AuditItem[]): AuditScore {
  let pass = 0;
  let fail = 0;
  for (const i of items) {
    if (i.result === "pass") pass += 1;
    else if (i.result === "fail") fail += 1;
  }
  const scored = pass + fail;
  return {
    scorePct: scored === 0 ? null : Math.round((pass / scored) * 10000) / 100,
    findingsCount: fail,
  };
}

/* -------------------------------- numbering -------------------------------- */

export function formatHseNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export function nextHseSequence(prefix: string, existing: readonly string[]): number {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const value of existing) {
    const m = re.exec(value ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/* --------------------------------- schemas --------------------------------- */

const uuid = z.string().uuid();

export const raCreateSchema = z.object({
  projectId: uuid,
  title: z.string().min(1).max(200),
  activity: z.string().min(1).max(400),
  hazards: z.array(hazardSchema).default([]),
  reviewDate: z.string().nullable().optional(),
});

export const raUpdateSchema = z.object({
  id: uuid,
  title: z.string().min(1).max(200).optional(),
  activity: z.string().min(1).max(400).optional(),
  hazards: z.array(hazardSchema).optional(),
  reviewDate: z.string().nullable().optional(),
  status: z.enum(RA_STATUSES).optional(),
});

export const jsaStepSchema = z.object({
  step: z.string().min(1),
  hazards: z.string().nullable().optional(),
  controls: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
});

export const jsaCreateSchema = z.object({
  projectId: uuid,
  task: z.string().min(1).max(200),
  riskAssessmentId: uuid.nullable().optional(),
  steps: z.array(jsaStepSchema).default([]),
});

export const jsaUpdateSchema = z.object({
  id: uuid,
  task: z.string().min(1).max(200).optional(),
  riskAssessmentId: uuid.nullable().optional(),
  steps: z.array(jsaStepSchema).optional(),
  status: z.enum(RA_STATUSES).optional(),
});

export const observationCreateSchema = z.object({
  projectId: uuid,
  obsType: z.enum(SAFETY_OBS_TYPES),
  description: z.string().min(1).max(2000),
  location: z.string().max(200).nullable().optional(),
  actionTaken: z.string().max(2000).nullable().optional(),
  severity: z.enum(OBS_SEVERITIES).default("low"),
  photoPath: z.string().max(500).nullable().optional(),
});

export const observationUpdateSchema = z.object({
  id: uuid,
  status: z.enum(OBS_STATUSES).optional(),
  actionTaken: z.string().max(2000).nullable().optional(),
  severity: z.enum(OBS_SEVERITIES).optional(),
});

export const competencySchema = z.object({
  projectId: uuid.nullable().optional(),
  workerName: z.string().min(1).max(160),
  employer: z.string().max(160).nullable().optional(),
  competency: z.string().min(1).max(200),
  certificateNumber: z.string().max(120).nullable().optional(),
  issuedDate: z.string().nullable().optional(),
  expiryDate: z.string().nullable().optional(),
  filePath: z.string().max(500).nullable().optional(),
});

export const emergencySchema = z.object({
  projectId: uuid,
  kind: z.enum(EMERGENCY_KINDS),
  eventType: z.enum(EMERGENCY_EVENT_TYPES),
  occurredAt: z.string().min(1),
  responseTimeMinutes: z.number().min(0).max(9999).nullable().optional(),
  casualties: z.number().int().min(0).default(0),
  report: z.string().max(4000).nullable().optional(),
  lessonsLearned: z.string().max(4000).nullable().optional(),
});

export const environmentalSchema = z.object({
  projectId: uuid,
  metric: z.enum(ENV_METRICS),
  value: z.number(),
  uom: z.string().min(1).max(40),
  limitValue: z.number().nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  measuredAt: z.string().nullable().optional(),
});

export const wasteSchema = z.object({
  projectId: uuid,
  wasteType: z.enum(WASTE_TYPES),
  qty: z.number().positive(),
  uom: z.string().min(1).max(20).default("kg"),
  disposalMethod: z.string().max(200).nullable().optional(),
  contractor: z.string().max(200).nullable().optional(),
  manifestNumber: z.string().max(120).nullable().optional(),
  disposalDate: z.string().min(1),
});

export const auditCreateSchema = z.object({
  projectId: uuid,
  title: z.string().min(1).max(200),
  auditDate: z.string().min(1),
  items: z.array(auditItemSchema).default([]),
});

export const auditUpdateSchema = z.object({
  id: uuid,
  items: z.array(auditItemSchema).optional(),
  status: z.enum(AUDIT_STATUSES).optional(),
});

/* ---------------------------------- labels --------------------------------- */

export const OBS_TYPE_LABEL: Record<SafetyObsType, string> = {
  safe_act: "Safe act",
  unsafe_act: "Unsafe act",
  unsafe_condition: "Unsafe condition",
};

export const ENV_METRIC_LABEL: Record<EnvMetric, string> = {
  noise_db: "Noise (dB)",
  dust_pm25: "Dust PM2.5",
  water_quality: "Water quality",
  soil: "Soil",
  emissions: "Emissions",
};

export const WASTE_TYPE_LABEL: Record<WasteType, string> = {
  general: "General",
  hazardous: "Hazardous",
  recyclable: "Recyclable",
  construction: "Construction",
};

/** Humanise any snake_case enum value for display. */
export function hseLabel(value: string): string {
  if (value in OBS_TYPE_LABEL) return OBS_TYPE_LABEL[value as SafetyObsType];
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
