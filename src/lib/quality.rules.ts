// P-183 — Pure rules for the quality-management expansion (ITPs, MIRs,
// FAT/SAT, certificates, calibration and discipline test records, dossiers).
// No React / Supabase imports: deterministic and unit-testable.
import { z } from "zod";

export const ITP_POINT_TYPES = ["hold", "witness", "review", "surveillance"] as const;
export type ItpPointType = (typeof ITP_POINT_TYPES)[number];

export const ITP_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "active",
  "superseded",
  "cancelled",
] as const;
export type ItpStatus = (typeof ITP_STATUSES)[number];

export const ITP_STEP_STATUSES = ["pending", "signed_off", "waived", "failed"] as const;
export type ItpStepStatus = (typeof ITP_STEP_STATUSES)[number];

export const TEST_RESULT_STATUSES = ["pending", "pass", "fail", "conditional"] as const;
export type TestResultStatus = (typeof TEST_RESULT_STATUSES)[number];

export const MIR_STATUSES = [
  "requested",
  "scheduled",
  "inspected",
  "accepted",
  "rejected",
] as const;
export type MirStatus = (typeof MIR_STATUSES)[number];

export const DOSSIER_STATUSES = ["compiling", "complete", "issued"] as const;
export type DossierStatus = (typeof DOSSIER_STATUSES)[number];

export const CABLE_TEST_TYPES = [
  "insulation_resistance",
  "continuity",
  "hipot",
  "iv_curve",
] as const;
export const RELAY_TEST_TYPES = [
  "secondary_injection",
  "primary_injection",
  "settings_verification",
] as const;
export const TRANSFORMER_TEST_TYPES = [
  "ratio",
  "winding_resistance",
  "insulation_resistance",
  "oil_dga",
] as const;

export const ITP_POINT_TYPE_LABELS: Record<ItpPointType, string> = {
  hold: "Hold point",
  witness: "Witness point",
  review: "Review",
  surveillance: "Surveillance",
};

export const TEST_RECORD_TABS = [
  "welding",
  "torque",
  "cable",
  "thermographic",
  "relay",
  "transformer",
] as const;
export type TestRecordTab = (typeof TEST_RECORD_TABS)[number];

export const TEST_RECORD_TAB_LABELS: Record<TestRecordTab, string> = {
  welding: "Welding",
  torque: "Torque",
  cable: "Cable",
  thermographic: "Thermographic",
  relay: "Relay",
  transformer: "Transformer",
};

/** ITP-0001 / MIR-0001 / FAT-0001 / SAT-0001 / CERT-0001 / DOSS-0001 per company. */
export function formatQaNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Next sequence for a prefix given the numbers already issued. */
export function nextQaSequence(prefix: string, existing: readonly string[]): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/* --------------------------- hold-point logic ----------------------------- */

const CWP_FORWARD_ORDER = ["draft", "planned", "in_progress", "complete"] as const;

/**
 * True when a CWP status/progress change moves work forward and therefore has
 * to clear open ITP hold points first.
 */
export function isForwardCwpTransition(input: {
  fromStatus?: string | null;
  toStatus?: string | null;
  fromProgress?: number | null;
  toProgress?: number | null;
}): boolean {
  const from = CWP_FORWARD_ORDER.indexOf(
    (input.fromStatus ?? "") as (typeof CWP_FORWARD_ORDER)[number],
  );
  const to = CWP_FORWARD_ORDER.indexOf(
    (input.toStatus ?? "") as (typeof CWP_FORWARD_ORDER)[number],
  );
  if (to >= 0 && (from < 0 || to > from)) return true;
  const fromPct = input.fromProgress ?? 0;
  const toPct = input.toProgress;
  return typeof toPct === "number" && toPct > fromPct;
}

export const HOLD_POINT_MESSAGE = "Open ITP hold point — sign-off required before work proceeds.";

/** Steps that still block forward work: hold points that are pending or failed. */
export function openHoldPoints<T extends { point_type: string; status: string }>(
  steps: readonly T[],
): T[] {
  return steps.filter(
    (s) => s.point_type === "hold" && (s.status === "pending" || s.status === "failed"),
  );
}

/** A step may be signed off by its declared role, or by a company admin. */
export function canSignOffStep(signoffRole: string | null | undefined, roles: readonly string[]) {
  if (roles.includes("company_admin")) return true;
  if (!signoffRole) return roles.length > 0;
  return roles.includes(signoffRole);
}

/* ---------------------------- calibration --------------------------------- */

export const CALIBRATION_WARNING_DAYS = 30;

export type CalibrationState = "unknown" | "expired" | "due_soon" | "ok";

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Calibration state of a tool relative to a reference date (the test date).
 * `expired` means the instrument was out of calibration when used.
 */
export function calibrationState(
  nextDue: string | null | undefined,
  referenceDate: string,
): CalibrationState {
  if (!nextDue) return "unknown";
  const days = daysBetween(referenceDate, nextDue);
  if (Number.isNaN(days)) return "unknown";
  if (days < 0) return "expired";
  if (days <= CALIBRATION_WARNING_DAYS) return "due_soon";
  return "ok";
}

export function calibrationChipLabel(state: CalibrationState, nextDue?: string | null): string {
  switch (state) {
    case "expired":
      return `Out of calibration${nextDue ? ` (due ${nextDue})` : ""}`;
    case "due_soon":
      return `Calibration due ${nextDue}`;
    case "unknown":
      return "No calibration record";
    default:
      return `Calibrated to ${nextDue}`;
  }
}

/* ------------------------------- schemas ---------------------------------- */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const shortText = z.string().trim().min(1).max(200);

export const itpCreateSchema = z.object({
  projectId: uuid,
  title: shortText,
  discipline: z.string().trim().min(1).max(60).default("general"),
  cwpId: uuid.nullish(),
  wbsItemId: uuid.nullish(),
});

export const itpUpdateSchema = z.object({
  id: uuid,
  title: shortText.optional(),
  discipline: z.string().trim().min(1).max(60).optional(),
  cwpId: uuid.nullish(),
  status: z.enum(ITP_STATUSES).optional(),
});

export const itpStepSchema = z.object({
  itpId: uuid,
  seq: z.number().int().min(1).max(999),
  description: z.string().trim().min(1).max(500),
  pointType: z.enum(ITP_POINT_TYPES).default("review"),
  referenceDoc: z.string().trim().max(200).nullish(),
  signoffRole: z.string().trim().max(60).nullish(),
});

export const itpStepSignoffSchema = z.object({
  stepId: uuid,
  status: z.enum(["signed_off", "waived", "failed"]),
  note: z.string().trim().max(500).nullish(),
});

export const mirSchema = z.object({
  projectId: uuid,
  material: shortText,
  purchaseOrderId: uuid.nullish(),
  qty: z.number().min(0).nullish(),
  uom: z.string().trim().max(20).nullish(),
  inspectionDate: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const mirUpdateSchema = z.object({
  id: uuid,
  status: z.enum(MIR_STATUSES).optional(),
  result: z.enum(TEST_RESULT_STATUSES).optional(),
  inspectionDate: isoDate.nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const fatSchema = z.object({
  projectId: uuid,
  equipmentTag: shortText,
  purchaseOrderId: uuid.nullish(),
  testDate: isoDate.nullish(),
  location: z.string().trim().max(200).nullish(),
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const satSchema = z.object({
  projectId: uuid,
  equipmentTag: shortText,
  fatId: uuid.nullish(),
  testDate: isoDate.nullish(),
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const testResultPatchSchema = z.object({
  id: uuid,
  kind: z.enum(["fat", "sat"]),
  result: z.enum(TEST_RESULT_STATUSES),
});

export const certificateSchema = z.object({
  projectId: uuid,
  entityType: z.string().trim().min(1).max(40),
  entityId: uuid.nullish(),
  title: shortText,
  issuedBy: z.string().trim().max(200).nullish(),
  issueDate: isoDate.nullish(),
  expiryDate: isoDate.nullish(),
  filePath: z.string().trim().max(500).nullish(),
});

export const calibrationSchema = z.object({
  instrumentTag: shortText,
  instrument: shortText,
  calibratedBy: z.string().trim().max(200).nullish(),
  calDate: isoDate,
  nextDue: isoDate.nullish(),
  result: z.enum(TEST_RESULT_STATUSES).default("pass"),
  certificatePath: z.string().trim().max(500).nullish(),
});

export const weldingSchema = z.object({
  projectId: uuid,
  welderName: shortText,
  welderCert: z.string().trim().max(120).nullish(),
  wpsRef: z.string().trim().max(120).nullish(),
  weldDate: isoDate,
  area: z.string().trim().max(120).nullish(),
  ndtMethod: z.string().trim().max(60).nullish(),
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const torqueSchema = z.object({
  projectId: uuid,
  equipmentTag: shortText,
  boltRef: shortText,
  targetTorqueNm: z.number().min(0).max(100000),
  actualTorqueNm: z.number().min(0).max(100000).nullish(),
  toolTag: z.string().trim().max(120).nullish(),
  torqueDate: isoDate,
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const cableTestSchema = z.object({
  projectId: uuid,
  cableTag: shortText,
  testType: z.enum(CABLE_TEST_TYPES),
  values: z.record(z.string(), z.unknown()).default({}),
  testDate: isoDate,
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const thermographicSchema = z.object({
  projectId: uuid,
  equipmentTag: shortText,
  location: z.string().trim().max(200).nullish(),
  imagePath: z.string().trim().max(500).nullish(),
  maxTempC: z.number().nullish(),
  deltaTC: z.number().nullish(),
  finding: z.string().trim().max(2000).nullish(),
  inspectionDate: isoDate,
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const relayTestSchema = z.object({
  projectId: uuid,
  relayTag: shortText,
  testType: z.enum(RELAY_TEST_TYPES),
  settings: z.record(z.string(), z.unknown()).default({}),
  testDate: isoDate,
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const transformerTestSchema = z.object({
  projectId: uuid,
  transformerTag: shortText,
  testType: z.enum(TRANSFORMER_TEST_TYPES),
  values: z.record(z.string(), z.unknown()).default({}),
  testDate: isoDate,
  result: z.enum(TEST_RESULT_STATUSES).default("pending"),
});

export const dossierSectionSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  entity_type: z.string().trim().min(1).max(40),
  entity_ids: z.array(uuid).default([]),
});
export type DossierSection = z.infer<typeof dossierSectionSchema>;

export const dossierCreateSchema = z.object({
  projectId: uuid,
  title: shortText,
});

export const dossierSectionsSchema = z.object({
  id: uuid,
  sections: z.array(dossierSectionSchema).max(50),
});

export const dossierIssueSchema = z.object({ id: uuid });

/** Sum of referenced rows across all dossier sections. */
export function dossierItemCount(sections: readonly DossierSection[]): number {
  return sections.reduce((n, s) => n + (s.entity_ids?.length ?? 0), 0);
}

/** A dossier is issuable once every section references at least one real row. */
export function isDossierComplete(sections: readonly DossierSection[]): boolean {
  return sections.length > 0 && sections.every((s) => (s.entity_ids?.length ?? 0) > 0);
}
