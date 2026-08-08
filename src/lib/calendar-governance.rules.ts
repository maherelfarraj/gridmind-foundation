// GC-16d — Governed calendar policy administration + versioned observed holiday sets.
//
// PURE module: no I/O, no server-fn transforms. Everything here is
// deterministic so policy resolution, impact previews and holiday validation
// are reproducible from the persisted evidence alone.
import { z } from "zod";

import {
  addBusinessDays,
  addCalendarDays,
  CalendarConfigError,
  GOVERNED_CALENDAR_IDS,
  GOVERNED_CALENDARS,
  isGovernedCalendarId,
  resolveGovernedCalendar,
  resolveGovernedTimezone,
  type GovernedCalendar,
  type GovernedCalendarId,
} from "@/lib/contracts-claims.rules";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const HOLIDAY_SET_STATUSES = ["draft", "approved", "superseded"] as const;
export type HolidaySetStatus = (typeof HOLIDAY_SET_STATUSES)[number];

export const HOLIDAY_KINDS = ["public_holiday", "exceptional_closure"] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];

export const POLICY_SCOPES = ["company", "contract"] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export const POLICY_CHANGE_STATUSES = ["pending", "approved", "rejected", "applied"] as const;
export type PolicyChangeStatus = (typeof POLICY_CHANGE_STATUSES)[number];

/**
 * Calendars whose observed holidays are lunar/variable (Eid, Hijri new year) and
 * therefore CANNOT be derived deterministically. They require an approved,
 * versioned observed-date set per year — never a speculative calculation.
 */
export const OBSERVED_HOLIDAY_CALENDARS: readonly GovernedCalendarId[] = [
  "mena-jo",
  "mena-gulf",
  "mena-eg",
];

export function requiresObservedHolidays(calendarId: string): boolean {
  return (OBSERVED_HOLIDAY_CALENDARS as readonly string[]).includes(calendarId);
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
export interface HolidayDateRecord {
  observed_date: string;
  label_en: string;
  label_ar: string;
  kind: HolidayKind;
  source_reference?: string | null;
}

export interface HolidaySetRecord {
  id: string;
  calendar_id: string;
  jurisdiction: string;
  year: number;
  version: string;
  label: string;
  status: HolidaySetStatus;
  source_reference?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  created_by?: string | null;
  row_version: number;
  dates: readonly HolidayDateRecord[];
}

export interface CalendarPolicyRecord {
  calendar_id: string | null;
  timezone: string | null;
}

export interface PolicyChangeRecord {
  id: string;
  scope: PolicyScope;
  contract_id: string | null;
  project_id: string | null;
  from_calendar_id: string | null;
  from_timezone: string | null;
  to_calendar_id: string;
  to_timezone: string;
  material: boolean;
  status: PolicyChangeStatus;
  reason: string;
  impact: Record<string, unknown>;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  applied_at: string | null;
  row_version: number;
}

// ---------------------------------------------------------------------------
// Effective calendar (base weekend rules + approved observed holiday sets)
// ---------------------------------------------------------------------------
export interface EffectiveCalendar extends GovernedCalendar {
  /** `${calendar_id}@${year}:${version}` for every approved set folded in. */
  holiday_set_versions: readonly string[];
  /** Years covered by an approved set. */
  covered_years: readonly number[];
}

export function holidaySetVersionKey(set: {
  calendar_id: string;
  year: number;
  version: string;
}): string {
  return `${set.calendar_id}@${set.year}:${set.version}`;
}

/**
 * Fold the APPROVED observed-date sets for a calendar into its governed base.
 * Draft and superseded versions are ignored by construction — deadline
 * calculation must never consume an unapproved date.
 */
export function effectiveCalendar(
  base: GovernedCalendar,
  sets: readonly HolidaySetRecord[],
): EffectiveCalendar {
  const approved = sets
    .filter((s) => s.status === "approved" && s.calendar_id === base.id)
    .slice()
    .sort((a, b) => (a.year - b.year !== 0 ? a.year - b.year : a.version.localeCompare(b.version)));

  // A later version for the same year wins; earlier versions are superseded.
  const byYear = new Map<number, HolidaySetRecord>();
  for (const s of approved) byYear.set(s.year, s);

  const holidays = new Set<string>(base.holidays);
  const versions: string[] = [];
  const years: number[] = [];
  for (const [year, set] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    years.push(year);
    versions.push(holidaySetVersionKey(set));
    for (const d of set.dates) holidays.add(d.observed_date.slice(0, 10));
  }

  return {
    ...base,
    holidays: [...holidays].sort(),
    holiday_set_versions: versions,
    covered_years: years,
  };
}

/** Years a business-day computation can reach from a trigger date. */
export function requiredHolidayYears(triggerIso: string, durationDays: number): number[] {
  const start = Number(triggerIso.slice(0, 4));
  if (!Number.isFinite(start)) return [];
  // Business days stretch at most ~7/5 of the calendar span; pad a year.
  const span = Math.max(0, Math.trunc(durationDays));
  const end = Number(addCalendarDays(triggerIso, Math.ceil(span * 1.5) + 30).slice(0, 4));
  const out: number[] = [];
  for (let y = start; y <= end; y += 1) out.push(y);
  return out;
}

export interface CoverageResult {
  ok: boolean;
  missing_years: number[];
  applied_versions: string[];
  message: string | null;
}

/**
 * Coverage of the approved observed-date sets for the years a deadline touches.
 * Missing coverage is a governed WARNING by default and a hard 422 when the
 * company enforces holiday sets — never a silent fallback.
 */
export function checkHolidayCoverage(
  cal: EffectiveCalendar,
  years: readonly number[],
): CoverageResult {
  if (!requiresObservedHolidays(cal.id))
    return { ok: true, missing_years: [], applied_versions: [...cal.holiday_set_versions], message: null };
  const missing = years.filter((y) => !cal.covered_years.includes(y));
  return {
    ok: missing.length === 0,
    missing_years: missing,
    applied_versions: [...cal.holiday_set_versions],
    message: missing.length
      ? `No approved observed-holiday set for calendar "${cal.id}" covering ${missing.join(", ")}. Import and approve the official dates before relying on this due date.`
      : null,
  };
}

export function assertHolidayCoverage(cal: EffectiveCalendar, years: readonly number[]): void {
  const res = checkHolidayCoverage(cal, years);
  if (!res.ok) throw new CalendarConfigError("holiday_set_missing", res.message!);
}

// ---------------------------------------------------------------------------
// Policy resolution chain
// ---------------------------------------------------------------------------
export interface PolicyChainInput {
  request?: CalendarPolicyRecord | null;
  contract?: CalendarPolicyRecord | null;
  company?: CalendarPolicyRecord | null;
}

export interface PolicyChainStep {
  source: "request" | "contract_policy" | "company_policy";
  calendar_id: string | null;
  timezone: string | null;
  applied: boolean;
}

export interface ResolvedPolicy {
  calendar: GovernedCalendar;
  calendar_id: GovernedCalendarId;
  calendar_version: string;
  calendar_source: "request" | "contract_policy" | "company_policy";
  timezone: string;
  chain: PolicyChainStep[];
}

/** Deterministic request → contract → company resolution. Never falls back. */
export function resolveCalendarPolicy(input: PolicyChainInput): ResolvedPolicy {
  const order: { source: PolicyChainStep["source"]; rec: CalendarPolicyRecord | null | undefined }[] =
    [
      { source: "request", rec: input.request },
      { source: "contract_policy", rec: input.contract },
      { source: "company_policy", rec: input.company },
    ];

  let chosen: { source: PolicyChainStep["source"]; calendarId: string } | null = null;
  let timezone: string | null = null;
  const chain: PolicyChainStep[] = [];

  for (const step of order) {
    const calendarId = step.rec?.calendar_id ?? null;
    const tz = step.rec?.timezone ?? null;
    const applies = !chosen && Boolean(calendarId);
    if (applies) chosen = { source: step.source, calendarId: calendarId! };
    if (!timezone && tz && (applies || chosen?.source === step.source || !chosen)) timezone = tz;
    chain.push({ source: step.source, calendar_id: calendarId, timezone: tz, applied: applies });
  }

  const calendar = resolveGovernedCalendar(chosen?.calendarId ?? null);
  const tz = resolveGovernedTimezone(calendar, timezone ?? calendar.timezones[0]);
  return {
    calendar,
    calendar_id: calendar.id,
    calendar_version: calendar.version,
    calendar_source: chosen!.source,
    timezone: tz,
    chain,
  };
}

/** A calendar change is material; a timezone-only change is not. */
export function isMaterialPolicyChange(
  from: CalendarPolicyRecord | null | undefined,
  to: CalendarPolicyRecord,
): boolean {
  return (from?.calendar_id ?? null) !== (to.calendar_id ?? null);
}

// ---------------------------------------------------------------------------
// Recalculation impact preview
// ---------------------------------------------------------------------------
export interface RecalcDeadline {
  id: string;
  label: string;
  kind: string;
  status: string;
  satisfied_at?: string | null;
  calendar: "calendar" | "business";
  trigger_date: string;
  duration_days: number;
  due_date: string;
  calendar_id: string;
  calendar_version: string;
  period_locked?: boolean;
}

export interface RecalcRow {
  id: string;
  label: string;
  kind: string;
  before_due_date: string;
  after_due_date: string;
  shift_days: number;
  changed: boolean;
  frozen: boolean;
  frozen_reason: string | null;
}

export interface RecalcPreview {
  rows: RecalcRow[];
  changed_count: number;
  frozen_count: number;
  max_shift_days: number;
  applied_versions: readonly string[];
}

const DAY = 86_400_000;
const dayDiff = (a: string, b: string): number =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY);

/**
 * A deadline is FROZEN — never retroactively recalculated — when it is already
 * satisfied, waived, superseded, missed, or sits in a locked costing period.
 */
export function frozenReason(d: RecalcDeadline): string | null {
  if (d.satisfied_at) return "satisfied";
  if (d.status === "met" || d.status === "waived" || d.status === "superseded" || d.status === "missed")
    return d.status;
  if (d.period_locked) return "period_locked";
  return null;
}

export function previewRecalculation(
  deadlines: readonly RecalcDeadline[],
  target: EffectiveCalendar,
): RecalcPreview {
  const rows: RecalcRow[] = [];
  for (const d of deadlines) {
    const frozen = frozenReason(d);
    const after =
      frozen || d.calendar !== "business"
        ? d.due_date
        : addBusinessDays(d.trigger_date, Math.max(0, Math.trunc(d.duration_days)), target);
    rows.push({
      id: d.id,
      label: d.label,
      kind: d.kind,
      before_due_date: d.due_date,
      after_due_date: after,
      shift_days: dayDiff(after, d.due_date),
      changed: after !== d.due_date,
      frozen: Boolean(frozen),
      frozen_reason: frozen,
    });
  }
  rows.sort((a, b) => a.before_due_date.localeCompare(b.before_due_date) || a.id.localeCompare(b.id));
  return {
    rows,
    changed_count: rows.filter((r) => r.changed).length,
    frozen_count: rows.filter((r) => r.frozen).length,
    max_shift_days: rows.reduce((m, r) => Math.max(m, Math.abs(r.shift_days)), 0),
    applied_versions: target.holiday_set_versions,
  };
}

// ---------------------------------------------------------------------------
// Holiday import validation
// ---------------------------------------------------------------------------
export interface HolidayImportIssue {
  row: number;
  code:
    | "invalid_date"
    | "year_mismatch"
    | "duplicate_in_import"
    | "duplicate_existing"
    | "missing_label"
    | "invalid_kind";
  message: string;
  observed_date?: string;
}

export interface HolidayImportResult {
  ok: boolean;
  accepted: HolidayDateRecord[];
  issues: HolidayImportIssue[];
  duplicates: string[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isRealIsoDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** Deterministic validation + duplicate detection for an observed-date import. */
export function validateHolidayImport(
  rows: readonly Partial<HolidayDateRecord>[],
  year: number,
  existing: readonly HolidayDateRecord[] = [],
): HolidayImportResult {
  const issues: HolidayImportIssue[] = [];
  const accepted: HolidayDateRecord[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  const already = new Set(existing.map((e) => e.observed_date.slice(0, 10)));

  rows.forEach((raw, i) => {
    const idx = i + 1;
    const date = String(raw.observed_date ?? "").slice(0, 10);
    if (!isRealIsoDay(date)) {
      issues.push({ row: idx, code: "invalid_date", message: `Row ${idx}: "${date}" is not a valid YYYY-MM-DD date.` });
      return;
    }
    if (Number(date.slice(0, 4)) !== year) {
      issues.push({
        row: idx,
        code: "year_mismatch",
        observed_date: date,
        message: `Row ${idx}: ${date} does not belong to the set year ${year}.`,
      });
      return;
    }
    const en = String(raw.label_en ?? "").trim();
    const ar = String(raw.label_ar ?? "").trim();
    if (!en || !ar) {
      issues.push({
        row: idx,
        code: "missing_label",
        observed_date: date,
        message: `Row ${idx}: both English and Arabic labels are required.`,
      });
      return;
    }
    const kind = (raw.kind ?? "public_holiday") as HolidayKind;
    if (!(HOLIDAY_KINDS as readonly string[]).includes(kind)) {
      issues.push({
        row: idx,
        code: "invalid_kind",
        observed_date: date,
        message: `Row ${idx}: "${String(raw.kind)}" is not a governed holiday kind.`,
      });
      return;
    }
    if (seen.has(date)) {
      duplicates.push(date);
      issues.push({
        row: idx,
        code: "duplicate_in_import",
        observed_date: date,
        message: `Row ${idx}: ${date} appears more than once in this import.`,
      });
      return;
    }
    if (already.has(date)) {
      duplicates.push(date);
      issues.push({
        row: idx,
        code: "duplicate_existing",
        observed_date: date,
        message: `Row ${idx}: ${date} is already recorded in this set version.`,
      });
      return;
    }
    seen.add(date);
    accepted.push({
      observed_date: date,
      label_en: en,
      label_ar: ar,
      kind,
      source_reference: raw.source_reference ?? null,
    });
  });

  accepted.sort((a, b) => a.observed_date.localeCompare(b.observed_date));
  return { ok: issues.length === 0, accepted, issues, duplicates: [...new Set(duplicates)] };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const isoDay = z.string().regex(ISO_DAY, "Expected YYYY-MM-DD");

export const calendarGovernanceQuerySchema = z.object({
  project_id: uuid.optional(),
  contract_id: uuid.optional(),
  calendar_id: z.enum(GOVERNED_CALENDAR_IDS).optional(),
  year: z.number().int().min(2000).max(2200).optional(),
});
export type CalendarGovernanceQuery = z.infer<typeof calendarGovernanceQuerySchema>;

export const policyChangeRequestSchema = z.object({
  scope: z.enum(POLICY_SCOPES),
  contract_id: uuid.nullable().optional(),
  project_id: uuid.nullable().optional(),
  to_calendar_id: z.enum(GOVERNED_CALENDAR_IDS),
  to_timezone: z.string().min(1).max(64),
  reason: z.string().min(8).max(2000),
  idempotency_key: z.string().min(8).max(120),
});
export type PolicyChangeRequestInput = z.infer<typeof policyChangeRequestSchema>;

export const policyChangeDecisionSchema = z.object({
  id: uuid,
  decision: z.enum(["approve", "reject"]),
  row_version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});
export type PolicyChangeDecisionInput = z.infer<typeof policyChangeDecisionSchema>;

export const holidaySetSchema = z.object({
  id: uuid.optional(),
  calendar_id: z.enum(GOVERNED_CALENDAR_IDS),
  jurisdiction: z.string().min(2).max(80),
  year: z.number().int().min(2000).max(2200),
  version: z.string().min(1).max(32),
  label: z.string().min(2).max(160),
  source_reference: z.string().max(400).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  row_version: z.number().int().min(1).optional(),
});
export type HolidaySetInput = z.infer<typeof holidaySetSchema>;

export const holidayImportSchema = z.object({
  set_id: uuid,
  preview: z.boolean().default(false),
  rows: z
    .array(
      z.object({
        observed_date: isoDay,
        label_en: z.string().min(1).max(160),
        label_ar: z.string().min(1).max(160),
        kind: z.enum(HOLIDAY_KINDS).default("public_holiday"),
        source_reference: z.string().max(400).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type HolidayImportInput = z.infer<typeof holidayImportSchema>;

export const holidaySetDecisionSchema = z.object({
  id: uuid,
  decision: z.enum(["approve", "supersede"]),
  row_version: z.number().int().min(1),
  note: z.string().max(2000).optional(),
});
export type HolidaySetDecisionInput = z.infer<typeof holidaySetDecisionSchema>;

export const recalcSchema = z.object({
  project_id: uuid,
  contract_id: uuid.nullable().optional(),
  apply: z.boolean().default(false),
  reason: z.string().min(8).max(2000).optional(),
  idempotency_key: z.string().min(8).max(120).optional(),
});
export type RecalcInput = z.infer<typeof recalcSchema>;

export { CalendarConfigError, GOVERNED_CALENDARS, GOVERNED_CALENDAR_IDS, isGovernedCalendarId };
export type { GovernedCalendar, GovernedCalendarId };
