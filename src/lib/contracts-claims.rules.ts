// GC-16 — Governed Contract & Claims Control.
//
// PURE MATH ONLY — no I/O, no Supabase, no React. Everything in this module is
// deterministic and unit-testable in isolation.
//
// Doctrine:
//   * NON-POSTING. This layer never mutates contracts, change orders,
//     forecasts, EVM reports, cash-flow or recognition snapshots. It reads
//     them and derives governed exposure.
//   * Asserted / submitted / assessed / approved / forecast / certified /
//     paid / at-risk values are kept strictly separate and are never summed
//     into one another.
//   * Money is rounded HALF-UP at the currency minor unit exactly once, when
//     it leaves the engine.
//   * FX comes from the existing fx_rates feed only. A missing rate is an
//     exception — never a silent 1.0 fallback.
import { z } from "zod";

import { DEFAULT_MINOR_UNIT, roundMoney } from "@/lib/costing.fx";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonRecord = { [k: string]: JsonValue };

export const CONTRACTS_CLAIMS_DISCLAIMER =
  "Non-posting management information. Contract and claims exposure is governed controls output and does not create, replace or post accounting journal entries.";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------
export const CLAIM_STATUSES = [
  "draft",
  "notified",
  "submitted",
  "under_assessment",
  "assessed",
  "negotiation",
  "approved",
  "rejected",
  "certified",
  "paid",
  "closed",
  "withdrawn",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_KINDS = [
  "variation",
  "eot",
  "prolongation",
  "disruption",
  "acceleration",
  "ld_defence",
  "termination",
  "other",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const DEADLINE_KINDS = [
  "notice",
  "submission",
  "response",
  "determination",
  "instrument_expiry",
  "limitation",
  "retention_release",
  "back_to_back",
] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export const DEADLINE_STATUSES = ["open", "met", "missed", "waived", "superseded"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];

export const SNAPSHOT_STATUSES = ["working", "submitted", "approved", "superseded"] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export const ALERT_STATES = ["open", "acknowledged", "snoozed", "escalated", "resolved"] as const;
export type AlertState = (typeof ALERT_STATES)[number];

export const ALERT_KINDS = [
  "claim_notice_approaching",
  "claim_notice_missed",
  "claim_response_overdue",
  "claim_aging",
  "claim_quantum_movement",
  "claim_entitlement_gap",
  "claim_eot_ld_conflict",
  "contract_instrument_expiring",
  "contract_retention_release_due",
  "contract_back_to_back_gap",
  "contract_fx_materiality",
  "contract_reconciliation_break",
  "contract_sod_exception",
] as const;
export type ClaimAlertKind = (typeof ALERT_KINDS)[number];

export type Severity = "info" | "warning" | "critical";

// ---------------------------------------------------------------------------
// Deterministic claim state machine
// ---------------------------------------------------------------------------
export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  draft: ["notified", "withdrawn"],
  notified: ["submitted", "withdrawn"],
  submitted: ["under_assessment", "rejected", "withdrawn"],
  under_assessment: ["assessed", "rejected"],
  assessed: ["negotiation", "approved", "rejected"],
  negotiation: ["approved", "rejected", "assessed"],
  approved: ["certified", "closed"],
  rejected: ["negotiation", "closed"],
  certified: ["paid", "closed"],
  paid: ["closed"],
  closed: [],
  withdrawn: [],
};

/** Statuses whose commercial record is frozen. */
export const TERMINAL_CLAIM_STATUSES: readonly ClaimStatus[] = ["closed", "withdrawn", "paid"];

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return (CLAIM_TRANSITIONS[from] ?? []).includes(to);
}

export function assertClaimTransition(from: ClaimStatus, to: ClaimStatus): void {
  if (!canTransitionClaim(from, to)) throw new Error(`claim_transition_invalid:${from}->${to}`);
}

/** Transitions that require the approval role (segregation of duties applies). */
export const APPROVAL_TRANSITIONS: readonly ClaimStatus[] = [
  "approved",
  "rejected",
  "certified",
  "paid",
  "closed",
];

export function requiresApprovalRole(to: ClaimStatus): boolean {
  return APPROVAL_TRANSITIONS.includes(to);
}

/**
 * Segregation of duties: the person who prepared/submitted a claim may never
 * be the person who approves or certifies it.
 */
export function violatesSegregation(input: {
  to: ClaimStatus;
  actorId: string | null;
  preparedBy: string | null;
  submittedBy?: string | null;
}): boolean {
  if (!requiresApprovalRole(input.to)) return false;
  if (!input.actorId) return true;
  return input.actorId === input.preparedBy || input.actorId === input.submittedBy;
}

/** Delegation thresholds — value above which a higher authority is required. */
export interface DelegationBand {
  role: string;
  limit: number; // inclusive upper bound in reporting currency; Infinity for unlimited
}

export const DEFAULT_DELEGATION: readonly DelegationBand[] = [
  { role: "project_admin", limit: 50_000 },
  { role: "finance_admin", limit: 500_000 },
  { role: "company_admin", limit: Number.POSITIVE_INFINITY },
];

export function withinDelegation(
  amount: number,
  roles: readonly string[],
  bands: readonly DelegationBand[] = DEFAULT_DELEGATION,
): boolean {
  const limit = bands
    .filter((b) => roles.includes(b.role))
    .reduce((max, b) => Math.max(max, b.limit), 0);
  return Math.abs(amount) <= limit;
}

// ---------------------------------------------------------------------------
// Deadline engine
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;

function parseIso(iso: string): Date {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid_date:${iso}`);
  return d;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addCalendarDays(iso: string, days: number): string {
  return isoDate(new Date(parseIso(iso).getTime() + days * DAY_MS));
}

/** Weekend definition: Saturday(6)/Sunday(0) by default. Configurable for MENA. */
export interface WorkCalendar {
  weekend: readonly number[];
  holidays: readonly string[];
}

export const DEFAULT_CALENDAR: WorkCalendar = { weekend: [6, 0], holidays: [] };
/** Fri/Sat weekend used across most Jordanian EPC contracts. */
export const MENA_CALENDAR: WorkCalendar = { weekend: [5, 6], holidays: [] };

function isWorkingDay(iso: string, cal: WorkCalendar): boolean {
  const d = parseIso(iso);
  if (cal.weekend.includes(d.getUTCDay())) return false;
  return !cal.holidays.includes(iso);
}

export function addBusinessDays(
  iso: string,
  days: number,
  cal: WorkCalendar = DEFAULT_CALENDAR,
): string {
  let cursor = iso.slice(0, 10);
  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor, cal)) remaining -= 1;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// GC-16c — governed calendar registry (deterministic id + version, no fallback)
// ---------------------------------------------------------------------------
export interface GovernedCalendar extends WorkCalendar {
  id: GovernedCalendarId;
  version: string;
  label: string;
  /** Timezones a contract may govern this calendar with. */
  timezones: readonly string[];
}

export const GOVERNED_CALENDAR_IDS = ["iso-std", "mena-jo", "mena-gulf", "mena-eg"] as const;
export type GovernedCalendarId = (typeof GOVERNED_CALENDAR_IDS)[number];

export const GOVERNED_CALENDAR_VERSION = "2026.1";

/**
 * Holidays are contractual working-day exclusions, expressed as fixed Gregorian
 * dates for the governed version. Bumping a calendar's holiday set REQUIRES a
 * new `version`; deadlines record the version applied so historical due dates
 * remain reproducible.
 */
export const GOVERNED_CALENDARS: Readonly<Record<GovernedCalendarId, GovernedCalendar>> = {
  "iso-std": {
    id: "iso-std",
    version: GOVERNED_CALENDAR_VERSION,
    label: "Standard (Sat/Sun weekend)",
    weekend: [6, 0],
    holidays: [],
    timezones: ["UTC", "Europe/London", "Europe/Berlin", "Asia/Amman", "Asia/Dubai"],
  },
  "mena-jo": {
    id: "mena-jo",
    version: GOVERNED_CALENDAR_VERSION,
    label: "Jordan (Fri/Sat weekend)",
    weekend: [5, 6],
    holidays: ["2026-01-01", "2026-03-20", "2026-03-21", "2026-05-01", "2026-05-25", "2026-12-25"],
    timezones: ["Asia/Amman", "UTC"],
  },
  "mena-gulf": {
    id: "mena-gulf",
    version: GOVERNED_CALENDAR_VERSION,
    label: "Gulf (Fri/Sat weekend)",
    weekend: [5, 6],
    holidays: ["2026-01-01", "2026-03-20", "2026-03-21", "2026-12-02"],
    timezones: ["Asia/Dubai", "Asia/Riyadh", "Asia/Qatar", "UTC"],
  },
  "mena-eg": {
    id: "mena-eg",
    version: GOVERNED_CALENDAR_VERSION,
    label: "Egypt (Fri/Sat weekend)",
    weekend: [5, 6],
    holidays: ["2026-01-01", "2026-01-07", "2026-04-25", "2026-07-23", "2026-10-06"],
    timezones: ["Africa/Cairo", "UTC"],
  },
};

/** Governed validation error — surfaced as a 422 by the server layer. */
export class CalendarConfigError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CalendarConfigError";
    this.code = code;
  }
}

export function isGovernedCalendarId(id: unknown): id is GovernedCalendarId {
  return typeof id === "string" && (GOVERNED_CALENDAR_IDS as readonly string[]).includes(id);
}

/** Resolve a governed calendar. Never falls back silently. */
export function resolveGovernedCalendar(id: unknown): GovernedCalendar {
  if (id === null || id === undefined || id === "")
    throw new CalendarConfigError(
      "deadline_calendar_unresolved",
      "No governed work calendar is configured for this deadline. Set a calendar on the contract or in company costing settings, or supply one explicitly.",
    );
  if (!isGovernedCalendarId(id))
    throw new CalendarConfigError(
      "deadline_calendar_invalid",
      `Unknown governed work calendar "${String(id)}". Allowed: ${GOVERNED_CALENDAR_IDS.join(", ")}.`,
    );
  return GOVERNED_CALENDARS[id];
}

/** Validate the timezone against the IANA database AND the calendar's governed set. */
export function resolveGovernedTimezone(cal: GovernedCalendar, tz: unknown): string {
  if (tz === null || tz === undefined || tz === "")
    throw new CalendarConfigError(
      "deadline_timezone_unresolved",
      "No governed timezone is configured for this deadline.",
    );
  if (typeof tz !== "string" || !isValidIanaTimezone(tz))
    throw new CalendarConfigError(
      "deadline_timezone_invalid",
      `"${String(tz)}" is not a valid IANA timezone.`,
    );
  if (!cal.timezones.includes(tz))
    throw new CalendarConfigError(
      "deadline_timezone_not_governed",
      `Timezone "${tz}" is not governed for calendar "${cal.id}". Allowed: ${cal.timezones.join(", ")}.`,
    );
  return tz;
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * DST-safe "today" in a governed timezone. Uses the IANA zone's wall clock so a
 * deadline never flips a day early/late across a DST boundary.
 */
export function zonedTodayIso(tz: string, nowMs: number = Date.now()): string {
  if (!isValidIanaTimezone(tz))
    throw new CalendarConfigError(
      "deadline_timezone_invalid",
      `"${tz}" is not a valid IANA timezone.`,
    );
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
  return parts.slice(0, 10);
}

export interface DeadlineInput {
  kind: DeadlineKind;
  trigger_date: string;
  duration_days: number;
  calendar: "calendar" | "business";
  /** Governed calendar identifier. Required — no silent default. */
  calendar_id?: GovernedCalendarId | string | null;
  workCalendar?: WorkCalendar;
}

/** Deterministic due date for any contractual clock. */
export function computeDueDate(input: DeadlineInput): string {
  const days = Math.max(0, Math.trunc(input.duration_days));
  if (input.calendar !== "business") return addCalendarDays(input.trigger_date, days);
  const cal = input.workCalendar ?? resolveGovernedCalendar(input.calendar_id);
  return addBusinessDays(input.trigger_date, days, cal);
}

export function daysUntil(dueIso: string, todayIso: string): number {
  return Math.round((parseIso(dueIso).getTime() - parseIso(todayIso).getTime()) / DAY_MS);
}

export interface DeadlineState {
  status: DeadlineStatus;
  days_remaining: number;
  overdue: boolean;
  approaching: boolean;
}

/** Evaluate a deadline against "today". `warnDays` sets the approaching band. */
export function evaluateDeadline(
  row: { due_date: string; status: DeadlineStatus; satisfied_at?: string | null },
  todayIso: string,
  warnDays = 7,
): DeadlineState {
  const remaining = daysUntil(row.due_date, todayIso);
  if (row.status === "waived" || row.status === "superseded")
    return { status: row.status, days_remaining: remaining, overdue: false, approaching: false };
  if (row.satisfied_at)
    return {
      status: parseIso(row.satisfied_at) <= parseIso(row.due_date) ? "met" : "missed",
      days_remaining: remaining,
      overdue: false,
      approaching: false,
    };
  return {
    status: remaining < 0 ? "missed" : "open",
    days_remaining: remaining,
    overdue: remaining < 0,
    approaching: remaining >= 0 && remaining <= warnDays,
  };
}

// ---------------------------------------------------------------------------
// Exposure model
// ---------------------------------------------------------------------------
export interface ClaimValues {
  asserted_amount: number;
  submitted_amount: number;
  assessed_amount: number;
  approved_amount: number;
  forecast_amount: number;
  certified_amount: number;
  paid_amount: number;
  at_risk_amount: number;
}

export interface ClaimRecord extends ClaimValues {
  id: string;
  claim_ref: string;
  title: string;
  kind: ClaimKind;
  status: ClaimStatus;
  currency_code: string;
  clause_ref?: string | null;
  entitlement_basis?: string | null;
  cause?: string | null;
  effect?: string | null;
  mitigation?: string | null;
  is_back_to_back?: boolean;
  back_to_back_ref?: string | null;
  eot_days_claimed: number;
  eot_days_assessed: number;
  eot_days_approved: number;
  ld_exposure: number;
  event_date?: string | null;
  notice_due_at?: string | null;
  notice_served_at?: string | null;
  submission_due_at?: string | null;
  submitted_at?: string | null;
  response_due_at?: string | null;
  responded_at?: string | null;
  limitation_at?: string | null;
  owner_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  fx_rate?: number | null;
  fx_rate_date?: string | null;
  fx_source?: string | null;
  fx_stale?: boolean;
}

/** Statuses treated as settled — no longer live commercial exposure. */
const SETTLED: readonly ClaimStatus[] = ["paid", "closed", "withdrawn", "rejected"];

/**
 * Governed exposure for a single claim, in its own currency.
 *
 * exposure = the best-supported unrecovered value:
 *   certified but unpaid  → certified − paid
 *   approved not certified → approved
 *   assessed              → assessed
 *   submitted             → submitted × 0 (never earned) + at_risk
 * Unapproved value NEVER enters as approved value; it is reported separately.
 */
export function claimExposure(claim: ClaimRecord): {
  exposure: number;
  unapproved: number;
  recoverable: number;
  settled: boolean;
} {
  const settled = SETTLED.includes(claim.status);
  const certifiedOutstanding = Math.max(0, claim.certified_amount - claim.paid_amount);
  const approvedOutstanding = Math.max(0, claim.approved_amount - claim.certified_amount);
  const unapproved = settled
    ? 0
    : Math.max(
        0,
        (claim.assessed_amount || claim.submitted_amount || claim.asserted_amount) -
          claim.approved_amount,
      );
  const exposure = settled ? 0 : certifiedOutstanding + approvedOutstanding;
  return {
    exposure: roundMoney(exposure),
    unapproved: roundMoney(unapproved),
    recoverable: roundMoney(certifiedOutstanding),
    settled,
  };
}

export interface ExposureTotals {
  claim_count: number;
  asserted: number;
  submitted: number;
  assessed: number;
  approved: number;
  forecast: number;
  certified: number;
  paid: number;
  at_risk: number;
  unapproved_exposure: number;
  live_exposure: number;
  ld_exposure: number;
  eot_days_approved: number;
  eot_days_claimed: number;
}

export function emptyTotals(): ExposureTotals {
  return {
    claim_count: 0,
    asserted: 0,
    submitted: 0,
    assessed: 0,
    approved: 0,
    forecast: 0,
    certified: 0,
    paid: 0,
    at_risk: 0,
    unapproved_exposure: 0,
    live_exposure: 0,
    ld_exposure: 0,
    eot_days_approved: 0,
    eot_days_claimed: 0,
  };
}

export function rollupClaims(
  claims: readonly ClaimRecord[],
  minorUnit: number = DEFAULT_MINOR_UNIT,
): ExposureTotals {
  const t = emptyTotals();
  for (const c of claims) {
    const e = claimExposure(c);
    t.claim_count += 1;
    t.asserted += c.asserted_amount;
    t.submitted += c.submitted_amount;
    t.assessed += c.assessed_amount;
    t.approved += c.approved_amount;
    t.forecast += c.forecast_amount;
    t.certified += c.certified_amount;
    t.paid += c.paid_amount;
    t.at_risk += c.at_risk_amount;
    t.ld_exposure += c.ld_exposure;
    t.unapproved_exposure += e.unapproved;
    t.live_exposure += e.exposure;
    t.eot_days_approved += c.eot_days_approved;
    t.eot_days_claimed += c.eot_days_claimed;
  }
  const money = (v: number) => roundMoney(v, minorUnit);
  return {
    ...t,
    asserted: money(t.asserted),
    submitted: money(t.submitted),
    assessed: money(t.assessed),
    approved: money(t.approved),
    forecast: money(t.forecast),
    certified: money(t.certified),
    paid: money(t.paid),
    at_risk: money(t.at_risk),
    ld_exposure: money(t.ld_exposure),
    unapproved_exposure: money(t.unapproved_exposure),
    live_exposure: money(t.live_exposure),
  };
}

export interface WaterfallStep {
  key: string;
  label: string;
  value: number;
  cumulative: number;
}

/** Exposure waterfall from asserted value down to unpaid certified value. */
export function exposureWaterfall(t: ExposureTotals): WaterfallStep[] {
  const steps: Array<{ key: string; label: string; value: number }> = [
    { key: "asserted", label: "Asserted", value: t.asserted },
    { key: "not_submitted", label: "Not submitted", value: -(t.asserted - t.submitted) },
    { key: "assessment_movement", label: "Assessment movement", value: t.assessed - t.submitted },
    { key: "not_approved", label: "Not approved", value: -(t.assessed - t.approved) },
    { key: "not_certified", label: "Not certified", value: -(t.approved - t.certified) },
    { key: "paid", label: "Paid", value: -t.paid },
  ];
  let cumulative = 0;
  return steps.map((s) => {
    cumulative = roundMoney(cumulative + s.value);
    return { ...s, value: roundMoney(s.value), cumulative };
  });
}

/** Remaining prime-contract value net of approved variations and billings. */
export function remainingContractValue(input: {
  original_value: number;
  approved_variations: number;
  certified_to_date: number;
}): number {
  return roundMoney(input.original_value + input.approved_variations - input.certified_to_date);
}

/** Liquidated-damages exposure honouring the contractual cap. */
export function ldExposure(input: {
  delay_days: number;
  eot_days_approved: number;
  rate_per_day: number;
  cap_pct: number;
  contract_value: number;
}): { chargeable_days: number; gross: number; capped: number; at_cap: boolean } {
  const chargeable = Math.max(
    0,
    Math.trunc(input.delay_days) - Math.trunc(input.eot_days_approved),
  );
  const gross = roundMoney(chargeable * Math.max(0, input.rate_per_day));
  const cap = roundMoney((Math.max(0, input.cap_pct) / 100) * Math.max(0, input.contract_value));
  const capped = cap > 0 ? Math.min(gross, cap) : gross;
  return {
    chargeable_days: chargeable,
    gross,
    capped: roundMoney(capped),
    at_cap: cap > 0 && gross >= cap,
  };
}

/** Back-to-back gap: head-contract entitlement not passed down to a subcontract. */
export function backToBackGap(input: {
  head_amount: number;
  sub_amount: number;
  head_due: string | null;
  sub_due: string | null;
}): { amount_gap: number; timing_gap_days: number; has_gap: boolean } {
  const amountGap = roundMoney(Math.max(0, input.head_amount - input.sub_amount));
  const timingGap = input.head_due && input.sub_due ? daysUntil(input.head_due, input.sub_due) : 0;
  return {
    amount_gap: amountGap,
    timing_gap_days: timingGap,
    has_gap: amountGap > 0 || timingGap < 0,
  };
}

// ---------------------------------------------------------------------------
// FX — fx_rates only, no silent fallback
// ---------------------------------------------------------------------------
export interface FxQuote {
  rate: number;
  rate_date: string;
  source: string;
  stale: boolean;
}

export function convertClaim(
  amount: number,
  from: string,
  to: string,
  quote: FxQuote | null,
  minorUnit: number = DEFAULT_MINOR_UNIT,
): { value: number; provenance: JsonRecord } {
  if (from.toUpperCase() === to.toUpperCase())
    return {
      value: roundMoney(amount, minorUnit),
      provenance: { rate: 1, source: "identity", rate_date: null, stale: false },
    };
  if (!quote) throw new Error(`fx_rate_missing:${from}->${to}`);
  return {
    value: roundMoney(amount * quote.rate, minorUnit),
    provenance: {
      rate: quote.rate,
      source: quote.source,
      rate_date: quote.rate_date,
      stale: quote.stale,
    },
  };
}

/** Materiality test on FX movement between two snapshot dates. */
export function fxMateriality(
  prior: number,
  current: number,
  thresholdPct = 5,
): { movement_pct: number; material: boolean } {
  if (prior === 0) return { movement_pct: 0, material: false };
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  return { movement_pct: Number(pct.toFixed(4)), material: Math.abs(pct) >= thresholdPct };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------
export interface ReconciliationCheck {
  code: string;
  ok: boolean;
  expected: number;
  actual: number;
  delta: number;
}

export function reconcile(input: {
  totals: ExposureTotals;
  approved_variations_register: number;
  forecast_claim_provision: number;
  tolerance?: number;
}): ReconciliationCheck[] {
  const tol = input.tolerance ?? 0.01;
  const mk = (code: string, expected: number, actual: number): ReconciliationCheck => ({
    code,
    expected: roundMoney(expected),
    actual: roundMoney(actual),
    delta: roundMoney(actual - expected),
    ok: Math.abs(actual - expected) <= tol,
  });
  return [
    mk("approved_vs_register", input.approved_variations_register, input.totals.approved),
    mk("forecast_vs_provision", input.forecast_claim_provision, input.totals.forecast),
    mk("paid_le_certified", input.totals.paid, Math.min(input.totals.paid, input.totals.certified)),
  ];
}

/** Deterministic checksum over the governed line set. */
export function snapshotChecksum(lines: readonly JsonRecord[]): string {
  const canonical = JSON.stringify(lines);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < canonical.length; i += 1) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Exceptions and alerts
// ---------------------------------------------------------------------------
export interface ClaimException {
  code: string;
  severity: Severity;
  message: string;
  context: JsonRecord;
}

export function deriveExceptions(
  claims: readonly ClaimRecord[],
  checks: readonly ReconciliationCheck[],
): ClaimException[] {
  const out: ClaimException[] = [];
  for (const c of claims) {
    if (!c.clause_ref || !c.entitlement_basis)
      out.push({
        code: "entitlement_gap",
        severity: "warning",
        message: `Claim ${c.claim_ref} has no contractual clause or entitlement basis recorded.`,
        context: { claim_id: c.id, claim_ref: c.claim_ref },
      });
    if (!c.cause || !c.effect)
      out.push({
        code: "cause_effect_missing",
        severity: "warning",
        message: `Claim ${c.claim_ref} is missing a documented cause-and-effect chain.`,
        context: { claim_id: c.id, claim_ref: c.claim_ref },
      });
    if (c.paid_amount > c.certified_amount + 0.01)
      out.push({
        code: "paid_exceeds_certified",
        severity: "critical",
        message: `Claim ${c.claim_ref} is paid above the certified amount.`,
        context: { claim_id: c.id, paid: c.paid_amount, certified: c.certified_amount },
      });
    if (c.eot_days_approved > 0 && c.ld_exposure > 0)
      out.push({
        code: "eot_ld_conflict",
        severity: "warning",
        message: `Claim ${c.claim_ref} carries both approved extension of time and liquidated-damages exposure.`,
        context: { claim_id: c.id, eot: c.eot_days_approved, ld: c.ld_exposure },
      });
    if (c.fx_stale)
      out.push({
        code: "fx_stale",
        severity: "warning",
        message: `Claim ${c.claim_ref} uses a stale exchange rate.`,
        context: { claim_id: c.id, rate_date: c.fx_rate_date ?? null },
      });
  }
  for (const chk of checks)
    if (!chk.ok)
      out.push({
        code: `reconciliation_${chk.code}`,
        severity: "critical",
        message: `Reconciliation break on ${chk.code}: expected ${chk.expected}, actual ${chk.actual}.`,
        context: { expected: chk.expected, actual: chk.actual, delta: chk.delta },
      });
  return out;
}

export interface ClaimAlert {
  dedupe_key: string;
  kind: ClaimAlertKind;
  severity: Severity;
  title: string;
  message: string;
  claim_id: string | null;
  deadline_id: string | null;
  owner_id: string | null;
  due_at: string | null;
  evidence_link: string | null;
  context: JsonRecord;
}

export interface DeadlineRecord {
  id: string;
  claim_id: string | null;
  kind: DeadlineKind;
  label: string;
  due_date: string;
  status: DeadlineStatus;
  satisfied_at?: string | null;
  owner_id?: string | null;
  /** GC-16c governed calendar provenance carried through to alerts and packs. */
  calendar?: "calendar" | "business";
  calendar_id?: GovernedCalendarId | string;
  calendar_version?: string;
  calendar_source?: string;
  timezone?: string;
}

export interface AlertEvaluationInput {
  project_id: string;
  today: string;
  claims: readonly ClaimRecord[];
  deadlines: readonly DeadlineRecord[];
  exceptions?: readonly ClaimException[];
  instruments?: readonly { id: string; reference: string; expiry_date: string; kind: string }[];
  agingDays?: number;
  quantumMovementPct?: number;
  priorApproved?: Record<string, number>;
  /**
   * GC-16c: when supplied, each deadline is evaluated against "today" in its own
   * governed timezone (DST-safe) instead of the portfolio-wide `today`.
   */
  nowMs?: number;
}

const dedupe = (parts: readonly (string | null | undefined)[]): string =>
  parts.filter(Boolean).join("|");

/** GC-16c: calendar provenance carried into every deadline-derived alert. */
export function calendarProvenance(d: DeadlineRecord): JsonRecord {
  return {
    calendar: d.calendar ?? null,
    calendar_id: d.calendar_id ?? null,
    calendar_version: d.calendar_version ?? null,
    calendar_source: d.calendar_source ?? null,
    timezone: d.timezone ?? null,
  };
}

/** Deterministic, de-duplicated alert set. Identical input ⇒ identical output. */
export function evaluateClaimAlerts(input: AlertEvaluationInput): ClaimAlert[] {
  const today = input.today.slice(0, 10);
  const aging = input.agingDays ?? 60;
  const movementPct = input.quantumMovementPct ?? 20;
  const found = new Map<string, ClaimAlert>();
  const push = (a: ClaimAlert) => {
    if (!found.has(a.dedupe_key)) found.set(a.dedupe_key, a);
  };
  const link = (claimId: string | null) =>
    claimId ? `/projects/${input.project_id}/costing/contracts-claims?claim=${claimId}` : null;
  const todayFor = (d: DeadlineRecord): string =>
    input.nowMs !== undefined && d.timezone ? zonedTodayIso(d.timezone, input.nowMs) : today;

  for (const d of input.deadlines) {
    const state = evaluateDeadline(d, todayFor(d));

    if (state.status === "met" || state.status === "waived" || state.status === "superseded")
      continue;
    if (state.overdue) {
      const kind: ClaimAlertKind =
        d.kind === "notice"
          ? "claim_notice_missed"
          : d.kind === "response"
            ? "claim_response_overdue"
            : d.kind === "instrument_expiry"
              ? "contract_instrument_expiring"
              : d.kind === "retention_release"
                ? "contract_retention_release_due"
                : "claim_response_overdue";
      push({
        dedupe_key: dedupe(["deadline", d.id, kind]),
        kind,
        severity: "critical",
        title: `Missed ${d.kind.replace(/_/g, " ")}`,
        message: `${d.label} was due on ${d.due_date} and is ${Math.abs(state.days_remaining)} day(s) overdue.`,
        claim_id: d.claim_id,
        deadline_id: d.id,
        owner_id: d.owner_id ?? null,
        due_at: d.due_date,
        evidence_link: link(d.claim_id),
        context: {
          days_overdue: Math.abs(state.days_remaining),
          kind: d.kind,
          ...calendarProvenance(d),
        },
      });
    } else if (state.approaching && d.kind === "notice") {
      push({
        dedupe_key: dedupe(["deadline", d.id, "claim_notice_approaching"]),
        kind: "claim_notice_approaching",
        severity: "warning",
        title: "Notice window closing",
        message: `${d.label} is due on ${d.due_date} (${state.days_remaining} day(s) remaining).`,
        claim_id: d.claim_id,
        deadline_id: d.id,
        owner_id: d.owner_id ?? null,
        due_at: d.due_date,
        evidence_link: link(d.claim_id),
        context: { days_remaining: state.days_remaining, ...calendarProvenance(d) },
      });
    }
  }

  for (const inst of input.instruments ?? []) {
    const remaining = daysUntil(inst.expiry_date, today);
    if (remaining <= 30)
      push({
        dedupe_key: dedupe(["instrument", inst.id, "contract_instrument_expiring"]),
        kind: "contract_instrument_expiring",
        severity: remaining < 0 ? "critical" : "warning",
        title: "Security expiring",
        message: `${inst.kind} ${inst.reference} expires on ${inst.expiry_date}.`,
        claim_id: null,
        deadline_id: null,
        owner_id: null,
        due_at: inst.expiry_date,
        evidence_link: null,
        context: { days_remaining: remaining },
      });
  }

  for (const c of input.claims) {
    if (SETTLED.includes(c.status)) continue;
    const opened = c.created_at ? c.created_at.slice(0, 10) : null;
    if (opened) {
      const age = -daysUntil(opened, today);
      if (age >= aging)
        push({
          dedupe_key: dedupe(["claim", c.id, "claim_aging"]),
          kind: "claim_aging",
          severity: age >= aging * 2 ? "critical" : "warning",
          title: "Aging claim",
          message: `Claim ${c.claim_ref} has been open for ${age} day(s) at status ${c.status}.`,
          claim_id: c.id,
          deadline_id: null,
          owner_id: c.owner_id ?? null,
          due_at: null,
          evidence_link: link(c.id),
          context: { age_days: age, status: c.status },
        });
    }
    const prior = input.priorApproved?.[c.id];
    if (typeof prior === "number") {
      const move = fxMateriality(prior, c.approved_amount, movementPct);
      if (move.material)
        push({
          dedupe_key: dedupe(["claim", c.id, "claim_quantum_movement"]),
          kind: "claim_quantum_movement",
          severity: "warning",
          title: "Quantum movement",
          message: `Approved quantum on ${c.claim_ref} moved ${move.movement_pct}% since the last governed snapshot.`,
          claim_id: c.id,
          deadline_id: null,
          owner_id: c.owner_id ?? null,
          due_at: null,
          evidence_link: link(c.id),
          context: { prior, current: c.approved_amount, movement_pct: move.movement_pct },
        });
    }
    if (!c.clause_ref || !c.entitlement_basis)
      push({
        dedupe_key: dedupe(["claim", c.id, "claim_entitlement_gap"]),
        kind: "claim_entitlement_gap",
        severity: "warning",
        title: "Entitlement gap",
        message: `Claim ${c.claim_ref} has no contractual clause or entitlement basis recorded.`,
        claim_id: c.id,
        deadline_id: null,
        owner_id: c.owner_id ?? null,
        due_at: null,
        evidence_link: link(c.id),
        context: {},
      });
    if (c.eot_days_approved > 0 && c.ld_exposure > 0)
      push({
        dedupe_key: dedupe(["claim", c.id, "claim_eot_ld_conflict"]),
        kind: "claim_eot_ld_conflict",
        severity: "warning",
        title: "Extension of time and liquidated damages conflict",
        message: `Claim ${c.claim_ref} holds ${c.eot_days_approved} approved day(s) while liquidated damages remain exposed.`,
        claim_id: c.id,
        deadline_id: null,
        owner_id: c.owner_id ?? null,
        due_at: null,
        evidence_link: link(c.id),
        context: { eot_days: c.eot_days_approved, ld: c.ld_exposure },
      });
    if (c.is_back_to_back && !c.back_to_back_ref)
      push({
        dedupe_key: dedupe(["claim", c.id, "contract_back_to_back_gap"]),
        kind: "contract_back_to_back_gap",
        severity: "warning",
        title: "Back-to-back gap",
        message: `Claim ${c.claim_ref} is flagged back-to-back but has no downstream reference.`,
        claim_id: c.id,
        deadline_id: null,
        owner_id: c.owner_id ?? null,
        due_at: null,
        evidence_link: link(c.id),
        context: {},
      });
    if (c.fx_stale)
      push({
        dedupe_key: dedupe(["claim", c.id, "contract_fx_materiality"]),
        kind: "contract_fx_materiality",
        severity: "warning",
        title: "Stale exchange rate",
        message: `Claim ${c.claim_ref} is translated on a stale exchange rate (${c.fx_rate_date ?? "unknown"}).`,
        claim_id: c.id,
        deadline_id: null,
        owner_id: c.owner_id ?? null,
        due_at: null,
        evidence_link: link(c.id),
        context: { rate_date: c.fx_rate_date ?? null },
      });
  }

  for (const ex of input.exceptions ?? [])
    if (ex.code.startsWith("reconciliation_"))
      push({
        dedupe_key: dedupe(["project", input.project_id, ex.code]),
        kind: "contract_reconciliation_break",
        severity: "critical",
        title: "Reconciliation break",
        message: ex.message,
        claim_id: null,
        deadline_id: null,
        owner_id: null,
        due_at: null,
        evidence_link: null,
        context: ex.context,
      });

  return [...found.values()].sort((a, b) => a.dedupe_key.localeCompare(b.dedupe_key));
}

export const ALERT_STATE_TRANSITIONS: Record<AlertState, readonly AlertState[]> = {
  open: ["acknowledged", "snoozed", "escalated", "resolved"],
  acknowledged: ["snoozed", "escalated", "resolved"],
  snoozed: ["open", "acknowledged", "escalated", "resolved"],
  escalated: ["acknowledged", "resolved"],
  resolved: ["open"],
};

export function canTransitionAlert(from: AlertState, to: AlertState): boolean {
  return (ALERT_STATE_TRANSITIONS[from] ?? []).includes(to);
}

/** An alert that is snoozed past its snooze date is live again. */
export function effectiveAlertState(
  row: { state: AlertState; snoozed_until?: string | null },
  todayIso: string,
): AlertState {
  if (row.state === "snoozed" && row.snoozed_until && daysUntil(row.snoozed_until, todayIso) < 0)
    return "open";
  return row.state;
}

// ---------------------------------------------------------------------------
// Snapshot lifecycle
// ---------------------------------------------------------------------------
export const SNAPSHOT_TRANSITIONS: Record<SnapshotStatus, readonly SnapshotStatus[]> = {
  working: ["submitted", "superseded"],
  submitted: ["approved", "working", "superseded"],
  approved: ["superseded"],
  superseded: [],
};

export function canTransitionSnapshot(from: SnapshotStatus, to: SnapshotStatus): boolean {
  return (SNAPSHOT_TRANSITIONS[from] ?? []).includes(to);
}

export function approvalBlockers(exceptions: readonly ClaimException[]): string[] {
  return exceptions.filter((e) => e.severity === "critical").map((e) => e.code);
}

export function isFrozen(status: SnapshotStatus): boolean {
  return status === "approved" || status === "superseded";
}

// ---------------------------------------------------------------------------
// Portfolio rollup
// ---------------------------------------------------------------------------
export interface PortfolioProjectExposure {
  project_id: string;
  project_name: string;
  currency: string;
  totals: ExposureTotals;
  open_alerts: number;
  overdue_deadlines: number;
}

export function rollupPortfolio(rows: readonly PortfolioProjectExposure[]): ExposureTotals & {
  project_count: number;
  open_alerts: number;
  overdue_deadlines: number;
} {
  const base = emptyTotals();
  let alerts = 0;
  let overdue = 0;
  for (const r of rows) {
    for (const key of Object.keys(base) as (keyof ExposureTotals)[])
      base[key] = (base[key] as number) + (r.totals[key] as number);
    alerts += r.open_alerts;
    overdue += r.overdue_deadlines;
  }
  return {
    ...base,
    asserted: roundMoney(base.asserted),
    submitted: roundMoney(base.submitted),
    assessed: roundMoney(base.assessed),
    approved: roundMoney(base.approved),
    forecast: roundMoney(base.forecast),
    certified: roundMoney(base.certified),
    paid: roundMoney(base.paid),
    at_risk: roundMoney(base.at_risk),
    ld_exposure: roundMoney(base.ld_exposure),
    unapproved_exposure: roundMoney(base.unapproved_exposure),
    live_exposure: roundMoney(base.live_exposure),
    project_count: rows.length,
    open_alerts: alerts,
    overdue_deadlines: overdue,
  };
}

export function concentrationBy(
  rows: readonly PortfolioProjectExposure[],
  metric: keyof ExposureTotals = "live_exposure",
  top = 5,
): Array<{ project_id: string; project_name: string; value: number; share_pct: number }> {
  const total = rows.reduce((s, r) => s + (r.totals[metric] as number), 0);
  return rows
    .map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      value: roundMoney(r.totals[metric] as number),
      share_pct:
        total === 0 ? 0 : Number((((r.totals[metric] as number) / total) * 100).toFixed(3)),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, top);
}

// ---------------------------------------------------------------------------
// Zod schemas (shared by server functions)
// ---------------------------------------------------------------------------
const uuid = z.string().uuid();
const monthDate = z.string().regex(/^\d{4}-\d{2}-01$/);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite();

export const claimUpsertSchema = z.object({
  id: uuid.optional(),
  project_id: uuid,
  contract_id: uuid.nullable().optional(),
  claim_ref: z.string().min(1).max(64),
  title: z.string().min(3).max(240),
  kind: z.enum(CLAIM_KINDS).default("variation"),
  clause_ref: z.string().max(120).nullable().optional(),
  entitlement_basis: z.string().max(2000).nullable().optional(),
  cause: z.string().max(4000).nullable().optional(),
  effect: z.string().max(4000).nullable().optional(),
  mitigation: z.string().max(4000).nullable().optional(),
  quantum_basis: z.string().max(2000).nullable().optional(),
  is_back_to_back: z.boolean().optional(),
  back_to_back_ref: z.string().max(120).nullable().optional(),
  currency_code: z.string().length(3),
  asserted_amount: money.optional(),
  submitted_amount: money.optional(),
  assessed_amount: money.optional(),
  approved_amount: money.optional(),
  forecast_amount: money.optional(),
  certified_amount: money.optional(),
  paid_amount: money.optional(),
  at_risk_amount: money.optional(),
  eot_days_claimed: z.number().int().min(0).optional(),
  eot_days_assessed: z.number().int().min(0).optional(),
  eot_days_approved: z.number().int().min(0).optional(),
  ld_exposure: money.optional(),
  event_date: isoDay.nullable().optional(),
  awareness_date: isoDay.nullable().optional(),
  notice_due_at: isoDay.nullable().optional(),
  notice_served_at: isoDay.nullable().optional(),
  submission_due_at: isoDay.nullable().optional(),
  submitted_at: isoDay.nullable().optional(),
  response_due_at: isoDay.nullable().optional(),
  responded_at: isoDay.nullable().optional(),
  limitation_at: isoDay.nullable().optional(),
  owner_id: uuid.nullable().optional(),
  evidence: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
  row_version: z.number().int().min(1).optional(),
});
export type ClaimUpsertInput = z.infer<typeof claimUpsertSchema>;

export const claimTransitionSchema = z.object({
  claim_id: uuid,
  to: z.enum(CLAIM_STATUSES),
  row_version: z.number().int().min(1),
  reason: z.string().min(8).max(2000).optional(),
  idempotency_key: z.string().min(8).max(120).optional(),
});
export type ClaimTransitionInput = z.infer<typeof claimTransitionSchema>;

export const claimValuationSchema = z.object({
  claim_id: uuid,
  effective_period: monthDate,
  basis: z.enum(["asserted", "submitted", "assessed", "approved", "forecast"]).default("assessed"),
  amount: money,
  probability_pct: z.number().min(0).max(100).default(100),
  reason: z.string().min(8).max(2000),
});
export type ClaimValuationInput = z.infer<typeof claimValuationSchema>;

export const deadlineSchema = z.object({
  id: uuid.optional(),
  project_id: uuid,
  claim_id: uuid.nullable().optional(),
  contract_id: uuid.nullable().optional(),
  kind: z.enum(DEADLINE_KINDS),
  label: z.string().min(3).max(240),
  clause_ref: z.string().max(120).nullable().optional(),
  trigger_date: isoDay,
  duration_days: z.number().int().min(0).max(3650),
  calendar: z.enum(["calendar", "business"]).default("calendar"),
  /** GC-16c: explicit governed calendar/timezone. Omitted ⇒ resolved from policy. */
  calendar_id: z.enum(GOVERNED_CALENDAR_IDS).optional(),
  timezone: z.string().max(64).optional(),

  owner_id: uuid.nullable().optional(),
  evidence_reference: z.string().max(400).nullable().optional(),
  status: z.enum(DEADLINE_STATUSES).optional(),
  satisfied_at: isoDay.nullable().optional(),
  row_version: z.number().int().min(1).optional(),
});
export type DeadlineInputSchema = z.infer<typeof deadlineSchema>;

export const claimSnapshotBuildSchema = z.object({
  project_id: uuid,
  period_month: monthDate,
  data_date: isoDay,
  reporting_currency: z.string().length(3).optional(),
});
export type ClaimSnapshotBuildInput = z.infer<typeof claimSnapshotBuildSchema>;

export const claimSnapshotTransitionSchema = z.object({
  snapshot_id: uuid,
  to: z.enum(SNAPSHOT_STATUSES),
  row_version: z.number().int().min(1),
  reason: z.string().min(8).max(2000).optional(),
});
export type ClaimSnapshotTransitionInput = z.infer<typeof claimSnapshotTransitionSchema>;

export const claimAlertActionSchema = z.object({
  alert_id: uuid,
  action: z.enum(["acknowledge", "snooze", "escalate", "resolve", "reopen", "assign"]),
  snoozed_until: isoDay.optional(),
  owner_id: uuid.nullable().optional(),
  note: z.string().max(2000).optional(),
});
export type ClaimAlertActionInput = z.infer<typeof claimAlertActionSchema>;

export const portfolioClaimsSchema = z.object({
  period_month: monthDate.optional(),
  status: z.enum(["all", ...SNAPSHOT_STATUSES]).default("all"),
  search: z.string().max(120).optional(),
});
export type PortfolioClaimsQuery = z.infer<typeof portfolioClaimsSchema>;

export const claimsWorkspaceSchema = z.object({
  project_id: uuid,
  period_month: monthDate.optional(),
});
export type ClaimsWorkspaceQuery = z.infer<typeof claimsWorkspaceSchema>;

export function alertActionToState(action: ClaimAlertActionInput["action"]): AlertState | null {
  switch (action) {
    case "acknowledge":
      return "acknowledged";
    case "snooze":
      return "snoozed";
    case "escalate":
      return "escalated";
    case "resolve":
      return "resolved";
    case "reopen":
      return "open";
    default:
      return null;
  }
}
