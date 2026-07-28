// P-260 — Sub compliance + scorecards: pure rules (no I/O).
//
// Mirrors the SQL authority added in the P-260 migration:
//   * `sub_compliance_status(expiry)`        → complianceStatus()
//   * `sub_compliance_expiry_sweep()`        → complianceFingerprint()
//   * `sub_compliance_gate(subcontract_id)`  → complianceGate()
// Scorecard math lives here (and only here) so the server fn is a thin shell.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Document types
// ---------------------------------------------------------------------------
export const COMPLIANCE_DOC_TYPES = [
  "insurance",
  "license",
  "safety_cert",
  "performance_bond",
] as const;
export type ComplianceDocType = (typeof COMPLIANCE_DOC_TYPES)[number];

/** Insurance is always mandatory — the DB trigger forces this too. */
export const MANDATORY_DOC_TYPES: readonly ComplianceDocType[] = ["insurance"];

export const COMPLIANCE_STATUSES = ["valid", "expiring_soon", "expired"] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Days of runway before an unexpired document is flagged "expiring soon". */
export const EXPIRY_WARNING_DAYS = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysUntil(expiry: string, asOf: string = todayIso()): number {
  const a = Date.UTC(
    Number(expiry.slice(0, 4)),
    Number(expiry.slice(5, 7)) - 1,
    Number(expiry.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(asOf.slice(0, 4)),
    Number(asOf.slice(5, 7)) - 1,
    Number(asOf.slice(8, 10)),
  );
  return Math.round((a - b) / 86_400_000);
}

/** Derived-status doctrine: status is a function of the expiry date, never typed in. */
export function complianceStatus(
  expiry: string | null | undefined,
  asOf: string = todayIso(),
): ComplianceStatus {
  if (!expiry) return "valid";
  const days = daysUntil(expiry, asOf);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "expiring_soon";
  return "valid";
}

export const COMPLIANCE_STATUS_TONE: Record<ComplianceStatus, "green" | "amber" | "destructive"> = {
  valid: "green",
  expiring_soon: "amber",
  expired: "destructive",
};

// ---------------------------------------------------------------------------
// Expiry engine — fingerprint dedupe (the Day-5 lesson: no double-crying)
// ---------------------------------------------------------------------------
/**
 * One alert per (document, state, expiry date). Re-running the sweep, or a
 * document sliding from valid → expiring_soon → expired, produces at most one
 * notification per transition; a no-op sweep produces none.
 */
export function complianceFingerprint(doc: {
  id: string;
  status: ComplianceStatus;
  expiry_date: string;
}): string {
  return `${doc.id}:${doc.status}:${doc.expiry_date}`;
}

export function dedupeAlerts<
  T extends { id: string; status: ComplianceStatus; expiry_date: string },
>(
  docs: readonly T[],
  alreadySent: ReadonlySet<string> = new Set(),
): { doc: T; fingerprint: string }[] {
  const seen = new Set(alreadySent);
  const out: { doc: T; fingerprint: string }[] = [];
  for (const doc of docs) {
    if (doc.status === "valid") continue;
    const fingerprint = complianceFingerprint(doc);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push({ doc, fingerprint });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hard gate — expired mandatory insurance blocks claim submission
// ---------------------------------------------------------------------------
export type ComplianceGateCode = "compliance_insurance_expired";

export interface GateDoc {
  doc_type: ComplianceDocType | string;
  mandatory: boolean;
  expiry_date: string;
  subcontract_id?: string | null;
}

/** Mirror of `sub_compliance_gate()`; null = submission allowed. */
export function complianceGate(
  docs: readonly GateDoc[],
  subcontractId: string,
  asOf: string = todayIso(),
): ComplianceGateCode | null {
  const blocking = docs.some(
    (d) =>
      d.mandatory &&
      d.doc_type === "insurance" &&
      (d.subcontract_id == null || d.subcontract_id === subcontractId) &&
      complianceStatus(d.expiry_date, asOf) === "expired",
  );
  return blocking ? "compliance_insurance_expired" : null;
}

/** Non-blocking nudge shown next to the submit button. */
export function complianceWarnings(
  docs: readonly (GateDoc & { id: string })[],
  asOf: string = todayIso(),
): { id: string; status: ComplianceStatus }[] {
  return docs
    .map((d) => ({ id: d.id, status: complianceStatus(d.expiry_date, asOf) }))
    .filter((d) => d.status !== "valid");
}

// ---------------------------------------------------------------------------
// Scorecard math
// ---------------------------------------------------------------------------
const clamp = (n: number) => Math.max(0, Math.min(100, n));
export const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;

export interface ScorecardClaimInput {
  /** Net payable the sub asked for. */
  claimed: number;
  /** Net payable actually certified (null when still open). */
  certified: number | null;
  period_end: string;
  submitted_at: string | null;
}

/** Safety-incident severities we score against a sub's work fronts. */
export const INCIDENT_PENALTY: Record<string, number> = {
  fatality: 100,
  lost_time: 25,
  medical_treatment: 15,
  first_aid: 8,
  near_miss: 4,
  property_damage: 8,
};
const DEFAULT_INCIDENT_PENALTY = 10;

/** NCR severity penalties against their packages. */
export const NCR_PENALTY: Record<string, number> = {
  critical: 25,
  major: 12,
  minor: 5,
};
const DEFAULT_NCR_PENALTY = 8;

/** Claims submitted within this many days of period end count as on time. */
export const ON_TIME_GRACE_DAYS = 7;

/** 100 = every certified claim matched what was claimed, to the cent. */
export function claimAccuracy(claims: readonly ScorecardClaimInput[]): number | null {
  const settled = claims.filter((c) => c.certified != null && Number(c.claimed) > 0);
  if (settled.length === 0) return null;
  const variance =
    settled.reduce((acc, c) => {
      const claimed = Number(c.claimed);
      return acc + Math.abs(claimed - Number(c.certified)) / claimed;
    }, 0) / settled.length;
  return round2(clamp(100 - variance * 100));
}

export function safetyScore(
  incidents: readonly { severity?: string | null }[],
  hasWorkFronts = true,
): number | null {
  if (!hasWorkFronts) return null;
  const penalty = incidents.reduce(
    (acc, i) => acc + (INCIDENT_PENALTY[String(i.severity ?? "")] ?? DEFAULT_INCIDENT_PENALTY),
    0,
  );
  return round2(clamp(100 - penalty));
}

export function qualityScore(
  ncrs: readonly { severity?: string | null }[],
  hasPackages = true,
): number | null {
  if (!hasPackages) return null;
  const penalty = ncrs.reduce(
    (acc, n) => acc + (NCR_PENALTY[String(n.severity ?? "")] ?? DEFAULT_NCR_PENALTY),
    0,
  );
  return round2(clamp(100 - penalty));
}

export function onTimeScore(claims: readonly ScorecardClaimInput[]): number | null {
  const submitted = claims.filter((c) => c.submitted_at);
  if (submitted.length === 0) return null;
  const onTime = submitted.filter(
    (c) => daysUntil(String(c.submitted_at).slice(0, 10), c.period_end) <= ON_TIME_GRACE_DAYS,
  ).length;
  return round2((onTime / submitted.length) * 100);
}

export const SCORECARD_WEIGHTS = {
  claim_accuracy: 0.35,
  safety_score: 0.25,
  quality_score: 0.2,
  on_time_score: 0.2,
} as const;

export interface ScorecardComponents {
  claim_accuracy: number | null;
  safety_score: number | null;
  quality_score: number | null;
  on_time_score: number | null;
}

/** Weighted composite over the components that exist, renormalised. */
export function compositeScore(parts: ScorecardComponents): number | null {
  let weighted = 0;
  let weight = 0;
  for (const key of Object.keys(SCORECARD_WEIGHTS) as (keyof ScorecardComponents)[]) {
    const value = parts[key];
    if (value == null) continue;
    weighted += value * SCORECARD_WEIGHTS[key];
    weight += SCORECARD_WEIGHTS[key];
  }
  if (weight === 0) return null;
  return round2(clamp(weighted / weight));
}

export type ScoreTrend = "up" | "down" | "flat";

export function scoreTrend(
  current: number | null | undefined,
  prior: number | null | undefined,
): { delta: number; direction: ScoreTrend } | null {
  if (current == null || prior == null) return null;
  const delta = round2(current - prior);
  return { delta, direction: delta > 0.01 ? "up" : delta < -0.01 ? "down" : "flat" };
}

export function scoreBand(
  score: number | null | undefined,
): "green" | "amber" | "destructive" | null {
  if (score == null) return null;
  if (score >= 85) return "green";
  if (score >= 70) return "amber";
  return "destructive";
}

export interface ScorecardResult extends ScorecardComponents {
  composite: number | null;
  metrics: Record<string, number>;
}

export function computeScorecard(input: {
  claims: readonly ScorecardClaimInput[];
  incidents: readonly { severity?: string | null }[];
  ncrs: readonly { severity?: string | null }[];
  hasWorkFronts?: boolean;
  hasPackages?: boolean;
}): ScorecardResult {
  const parts: ScorecardComponents = {
    claim_accuracy: claimAccuracy(input.claims),
    safety_score: safetyScore(input.incidents, input.hasWorkFronts ?? true),
    quality_score: qualityScore(input.ncrs, input.hasPackages ?? true),
    on_time_score: onTimeScore(input.claims),
  };
  return {
    ...parts,
    composite: compositeScore(parts),
    metrics: {
      claims: input.claims.length,
      certified_claims: input.claims.filter((c) => c.certified != null).length,
      incidents: input.incidents.length,
      ncrs: input.ncrs.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------
const dateStr = z.string().regex(DATE_RE);

export const ComplianceDocSaveSchema = z
  .object({
    id: z.string().uuid().optional(),
    vendor_id: z.string().uuid(),
    subcontract_id: z.string().uuid().nullable().optional(),
    doc_type: z.enum(COMPLIANCE_DOC_TYPES),
    title: z.string().trim().min(2).max(200),
    reference: z.string().trim().max(120).nullable().optional(),
    issue_date: dateStr.nullable().optional(),
    expiry_date: dateStr,
    mandatory: z.boolean().default(false),
    file_path: z.string().trim().max(600).nullable().optional(),
    file_name: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => !v.issue_date || v.expiry_date >= v.issue_date, {
    message: "dates_out_of_order",
    path: ["expiry_date"],
  });
export type ComplianceDocSaveInput = z.infer<typeof ComplianceDocSaveSchema>;

export const ScorecardComputeSchema = z
  .object({
    vendor_id: z.string().uuid(),
    period_start: dateStr,
    period_end: dateStr,
  })
  .refine((v) => v.period_start <= v.period_end, { message: "invalid_period" });
export type ScorecardComputeInput = z.infer<typeof ScorecardComputeSchema>;
