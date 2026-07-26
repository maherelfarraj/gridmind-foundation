// P-182 — Pure rules for the construction governance register (method
// statements, toolbox talks, permits to work, site instructions, technical
// queries). No React / Supabase imports: deterministic and unit-testable.
import { z } from "zod";

export const GOV_DOC_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "superseded",
] as const;
export type GovDocStatus = (typeof GOV_DOC_STATUSES)[number];

export const TBT_STATUSES = ["scheduled", "held", "cancelled"] as const;
export type TbtStatus = (typeof TBT_STATUSES)[number];

export const PTW_TYPES = [
  "hot_work",
  "confined_space",
  "working_at_height",
  "electrical",
  "excavation",
  "lifting",
  "general",
] as const;
export type PtwType = (typeof PTW_TYPES)[number];

export const PTW_STATUSES = [
  "requested",
  "active",
  "suspended",
  "closed",
  "expired",
  "cancelled",
] as const;
export type PtwStatus = (typeof PTW_STATUSES)[number];

export const SI_STATUSES = ["issued", "acknowledged", "completed", "cancelled"] as const;
export type SiStatus = (typeof SI_STATUSES)[number];

export const TQ_STATUSES = ["draft", "submitted", "answered", "closed", "void"] as const;
export type TqStatus = (typeof TQ_STATUSES)[number];

export const TQ_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TqPriority = (typeof TQ_PRIORITIES)[number];

export const PTW_TYPE_LABELS: Record<PtwType, string> = {
  hot_work: "Hot work",
  confined_space: "Confined space",
  working_at_height: "Working at height",
  electrical: "Electrical",
  excavation: "Excavation",
  lifting: "Lifting",
  general: "General",
};

/** MS-0001 / TBT-0001 / PTW-0001 / SI-0001 / TQ-0001 style numbers, per company. */
export function formatGovNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Next sequence for a prefix given the numbers already issued. */
export function nextGovSequence(prefix: string, existing: readonly string[]): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** R0 → R1 → R2 …; anything unrecognised restarts the ladder at R1. */
export function nextRevision(current: string): string {
  const m = /^R(\d+)$/i.exec((current ?? "").trim());
  return `R${m ? Number(m[1]) + 1 : 1}`;
}

export type PtwValidityInput = {
  status: PtwStatus;
  validFrom: string;
  validTo: string;
  isolationsConfirmed: boolean;
};

export type PtwValidity = {
  /** Status the row should hold once the lazy expiry sweep is applied. */
  effectiveStatus: PtwStatus;
  /** True only when work may proceed under the permit right now. */
  usable: boolean;
  /** True when the row must be written back as 'expired'. */
  needsExpirySweep: boolean;
  reason: string | null;
};

/**
 * Server-side permit validity. A permit is usable only when it is active,
 * inside its window, and its isolations are confirmed. Expiry is evaluated
 * lazily on read/mutate (no cron): a live permit past valid_to sweeps to
 * 'expired'.
 */
export function evaluatePtwValidity(input: PtwValidityInput, nowMs = Date.now()): PtwValidity {
  const from = Date.parse(input.validFrom);
  const to = Date.parse(input.validTo);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return {
      effectiveStatus: input.status,
      usable: false,
      needsExpirySweep: false,
      reason: "Permit validity window is not a valid date range.",
    };
  }

  const live = input.status === "active" || input.status === "requested";
  const past = nowMs >= to;
  const needsExpirySweep = live && past;
  const effectiveStatus: PtwStatus = needsExpirySweep ? "expired" : input.status;

  if (effectiveStatus !== "active") {
    return {
      effectiveStatus,
      usable: false,
      needsExpirySweep,
      reason:
        effectiveStatus === "expired"
          ? "Permit expired — its validity window has passed."
          : `Permit is ${effectiveStatus.replace("_", " ")}, not active.`,
    };
  }
  if (nowMs < from) {
    return {
      effectiveStatus,
      usable: false,
      needsExpirySweep,
      reason: "Permit is not yet within its validity window.",
    };
  }
  if (!input.isolationsConfirmed) {
    return {
      effectiveStatus,
      usable: false,
      needsExpirySweep,
      reason: "Isolations have not been confirmed.",
    };
  }
  return { effectiveStatus, usable: true, needsExpirySweep, reason: null };
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);

export const isolationPointSchema = z.object({
  point: trimmed(1, 200),
  type: trimmed(1, 80).default("electrical"),
  lockedBy: trimmed(1, 120).nullish(),
  confirmedAt: z.string().datetime().nullish(),
});
export type IsolationPoint = z.infer<typeof isolationPointSchema>;

export const methodStatementCreateSchema = z.object({
  projectId: uuid,
  title: trimmed(3, 200),
  activity: trimmed(3, 200),
  filePath: z.string().trim().max(500).nullish(),
});

export const methodStatementUpdateSchema = z.object({
  id: uuid,
  title: trimmed(3, 200).optional(),
  activity: trimmed(3, 200).optional(),
  filePath: z.string().trim().max(500).nullish(),
  status: z.enum(GOV_DOC_STATUSES).optional(),
});

export const methodStatementReviseSchema = z.object({ id: uuid });
export const methodStatementSubmitSchema = z.object({ id: uuid });

export const toolboxTalkSchema = z.object({
  id: uuid.optional(),
  projectId: uuid,
  talkDate: isoDate,
  topic: trimmed(3, 200),
  location: z.string().trim().max(200).nullish(),
  presenter: uuid.nullish(),
  status: z.enum(TBT_STATUSES).default("scheduled"),
  notes: z.string().trim().max(4000).nullish(),
});

export const attendanceSchema = z.object({
  talkId: uuid,
  workerName: trimmed(2, 160),
  trade: z.string().trim().max(80).nullish(),
  employer: z.string().trim().max(160).nullish(),
  signaturePath: z.string().trim().max(500).nullish(),
  attended: z.boolean().default(true),
});

export const permitCreateSchema = z
  .object({
    projectId: uuid,
    permitType: z.enum(PTW_TYPES),
    location: trimmed(2, 200),
    description: trimmed(3, 4000),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime(),
    isolations: z.array(isolationPointSchema).default([]),
  })
  .refine((v) => Date.parse(v.validTo) > Date.parse(v.validFrom), {
    message: "valid_to must be after valid_from",
    path: ["validTo"],
  });

export const permitTransitionSchema = z.object({
  id: uuid,
  status: z.enum(["active", "suspended", "closed", "cancelled"]),
  isolationsConfirmed: z.boolean().optional(),
});

export const siteInstructionSchema = z.object({
  projectId: uuid,
  instruction: trimmed(3, 4000),
  issuedTo: trimmed(2, 160),
  cwpId: uuid.nullish(),
  dueDate: isoDate.nullish(),
});

export const siteInstructionTransitionSchema = z.object({
  id: uuid,
  status: z.enum(SI_STATUSES),
});

export const technicalQuerySchema = z.object({
  projectId: uuid,
  subject: trimmed(3, 200),
  question: trimmed(3, 4000),
  priority: z.enum(TQ_PRIORITIES).default("normal"),
  dueDate: isoDate.nullish(),
});

/** Answering a TQ requires a non-empty response. */
export const technicalQueryAnswerSchema = z.object({
  id: uuid,
  response: trimmed(1, 4000),
});

export const technicalQueryEscalateSchema = z.object({
  id: uuid,
  rfiId: uuid,
});

export const technicalQueryStatusSchema = z.object({
  id: uuid,
  status: z.enum(TQ_STATUSES),
});
