// GC-16d — Deterministic tests for governed calendar policy administration,
// versioned observed-holiday sets and recalculation impact preview.
import { describe, expect, it } from "vitest";

import {
  assertHolidayCoverage,
  checkHolidayCoverage,
  effectiveCalendar,
  frozenReason,
  holidaySetVersionKey,
  isMaterialPolicyChange,
  isRealIsoDay,
  previewRecalculation,
  requiredHolidayYears,
  requiresObservedHolidays,
  resolveCalendarPolicy,
  validateHolidayImport,
  holidayImportSchema,
  holidaySetSchema,
  policyChangeDecisionSchema,
  policyChangeRequestSchema,
  recalcSchema,
  type HolidaySetRecord,
  type RecalcDeadline,
} from "@/lib/calendar-governance.rules";
import {
  addBusinessDays,
  CalendarConfigError,
  GOVERNED_CALENDARS,
} from "@/lib/contracts-claims.rules";

const set = (over: Partial<HolidaySetRecord> = {}): HolidaySetRecord => ({
  id: over.id ?? "set-1",
  calendar_id: over.calendar_id ?? "mena-jo",
  jurisdiction: over.jurisdiction ?? "JO",
  year: over.year ?? 2026,
  version: over.version ?? "1",
  label: over.label ?? "Official 2026",
  status: over.status ?? "approved",
  source_reference: over.source_reference ?? "official-gazette",
  approved_by: over.approved_by ?? "approver",
  approved_at: over.approved_at ?? "2026-01-01T00:00:00Z",
  created_by: over.created_by ?? "requester",
  row_version: over.row_version ?? 1,
  dates: over.dates ?? [
    {
      observed_date: "2026-03-20",
      label_en: "Eid al-Fitr",
      label_ar: "عيد الفطر",
      kind: "public_holiday",
    },
  ],
});

// ---------------------------------------------------------------------------
// Policy resolution chain
// ---------------------------------------------------------------------------
describe("resolveCalendarPolicy — request → contract → company", () => {
  it("prefers an explicit request override", () => {
    const r = resolveCalendarPolicy({
      request: { calendar_id: "mena-gulf", timezone: "Asia/Riyadh" },
      contract: { calendar_id: "mena-jo", timezone: "Asia/Amman" },
      company: { calendar_id: "iso-std", timezone: "UTC" },
    });
    expect(r.calendar_source).toBe("request");
    expect(r.calendar_id).toBe("mena-gulf");
    expect(r.timezone).toBe("Asia/Riyadh");
  });

  it("falls to the contract policy when there is no request override", () => {
    const r = resolveCalendarPolicy({
      request: null,
      contract: { calendar_id: "mena-jo", timezone: "Asia/Amman" },
      company: { calendar_id: "iso-std", timezone: "UTC" },
    });
    expect(r.calendar_source).toBe("contract_policy");
    expect(r.timezone).toBe("Asia/Amman");
  });

  it("falls to the company policy last", () => {
    const r = resolveCalendarPolicy({
      contract: { calendar_id: null, timezone: null },
      company: { calendar_id: "mena-eg", timezone: "Africa/Cairo" },
    });
    expect(r.calendar_source).toBe("company_policy");
    expect(r.calendar_id).toBe("mena-eg");
  });

  it("exposes the full chain with exactly one applied step", () => {
    const r = resolveCalendarPolicy({ company: { calendar_id: "iso-std", timezone: "UTC" } });
    expect(r.chain.map((c) => c.source)).toEqual(["request", "contract_policy", "company_policy"]);
    expect(r.chain.filter((c) => c.applied)).toHaveLength(1);
  });

  it("raises a governed error instead of silently defaulting when nothing is configured", () => {
    expect(() => resolveCalendarPolicy({})).toThrow(CalendarConfigError);
  });

  it("rejects an unknown calendar identifier", () => {
    expect(() =>
      resolveCalendarPolicy({ request: { calendar_id: "made-up", timezone: null } }),
    ).toThrow(CalendarConfigError);
  });

  it("rejects a timezone that is not governed for the calendar", () => {
    expect(() =>
      resolveCalendarPolicy({ request: { calendar_id: "mena-jo", timezone: "America/New_York" } }),
    ).toThrow(CalendarConfigError);
  });

  it("treats a calendar change as material and a timezone-only change as not", () => {
    expect(
      isMaterialPolicyChange(
        { calendar_id: "iso-std", timezone: "UTC" },
        { calendar_id: "mena-jo", timezone: "Asia/Amman" },
      ),
    ).toBe(true);
    expect(
      isMaterialPolicyChange(
        { calendar_id: "mena-jo", timezone: "Asia/Amman" },
        { calendar_id: "mena-jo", timezone: "Asia/Amman" },
      ),
    ).toBe(false);
    expect(isMaterialPolicyChange(null, { calendar_id: "iso-std", timezone: "UTC" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Effective calendar folding
// ---------------------------------------------------------------------------
describe("effectiveCalendar — approved sets only", () => {
  const base = GOVERNED_CALENDARS["mena-jo"];

  it("folds approved observed dates into the base holidays", () => {
    const eff = effectiveCalendar(base, [set()]);
    expect(eff.holidays).toContain("2026-03-20");
    expect(eff.covered_years).toEqual([2026]);
    expect(eff.holiday_set_versions).toEqual(["mena-jo@2026:1"]);
  });

  it("ignores draft and superseded versions", () => {
    const eff = effectiveCalendar(base, [
      set({
        id: "d",
        status: "draft",
        dates: [
          { observed_date: "2026-05-05", label_en: "x", label_ar: "س", kind: "public_holiday" },
        ],
      }),
      set({
        id: "s",
        status: "superseded",
        version: "0",
        dates: [
          { observed_date: "2026-06-06", label_en: "y", label_ar: "ص", kind: "public_holiday" },
        ],
      }),
    ]);
    expect(eff.holidays).not.toContain("2026-05-05");
    expect(eff.holidays).not.toContain("2026-06-06");
    expect(eff.covered_years).toEqual([]);
  });

  it("ignores sets belonging to another calendar", () => {
    const eff = effectiveCalendar(base, [set({ calendar_id: "mena-eg" })]);
    expect(eff.holiday_set_versions).toEqual([]);
  });

  it("lets the later approved version win for the same year", () => {
    const eff = effectiveCalendar(base, [
      set({
        id: "v1",
        version: "1",
        dates: [
          { observed_date: "2026-05-04", label_en: "a", label_ar: "أ", kind: "public_holiday" },
        ],
      }),
      set({
        id: "v2",
        version: "2",
        dates: [
          { observed_date: "2026-03-21", label_en: "b", label_ar: "ب", kind: "public_holiday" },
        ],
      }),
    ]);
    expect(eff.holiday_set_versions).toEqual(["mena-jo@2026:2"]);
    expect(eff.holidays).toContain("2026-03-21");
    expect(eff.holidays).not.toContain("2026-05-04");
  });

  it("produces a stable version key", () => {
    expect(holidaySetVersionKey({ calendar_id: "mena-eg", year: 2027, version: "3" })).toBe(
      "mena-eg@2027:3",
    );
  });
});

// ---------------------------------------------------------------------------
// Coverage enforcement
// ---------------------------------------------------------------------------
describe("holiday coverage", () => {
  it("marks lunar-calendar coverage gaps and never silently falls back", () => {
    const eff = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], [set({ year: 2026 })]);
    const res = checkHolidayCoverage(eff, [2026, 2027]);
    expect(res.ok).toBe(false);
    expect(res.missing_years).toEqual([2027]);
    expect(res.message).toMatch(/2027/);
    expect(() => assertHolidayCoverage(eff, [2026, 2027])).toThrow(CalendarConfigError);
  });

  it("passes when every touched year is covered", () => {
    const eff = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], [
      set({ year: 2026 }),
      set({
        id: "s27",
        year: 2027,
        dates: [
          { observed_date: "2027-03-10", label_en: "e", label_ar: "ع", kind: "public_holiday" },
        ],
      }),
    ]);
    expect(checkHolidayCoverage(eff, [2026, 2027]).ok).toBe(true);
    expect(() => assertHolidayCoverage(eff, [2026, 2027])).not.toThrow();
  });

  it("does not require observed sets for the fixed ISO calendar", () => {
    const eff = effectiveCalendar(GOVERNED_CALENDARS["iso-std"], []);
    expect(requiresObservedHolidays("iso-std")).toBe(false);
    expect(checkHolidayCoverage(eff, [2030]).ok).toBe(true);
  });

  it("derives every year a business-day span can reach", () => {
    expect(requiredHolidayYears("2026-12-20", 60)).toEqual([2026, 2027]);
    expect(requiredHolidayYears("2026-02-01", 5)).toEqual([2026]);
  });
});

// ---------------------------------------------------------------------------
// Weekend / DST / boundary behaviour
// ---------------------------------------------------------------------------
describe("business-day arithmetic under governed calendars", () => {
  it("uses the Friday/Saturday MENA weekend", () => {
    const jo = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], []);
    // 2026-01-08 is a Thursday; +1 business day skips Fri+Sat to Sunday.
    expect(addBusinessDays("2026-01-08", 1, jo)).toBe("2026-01-11");
  });

  it("uses the Saturday/Sunday ISO weekend", () => {
    const iso = effectiveCalendar(GOVERNED_CALENDARS["iso-std"], []);
    expect(addBusinessDays("2026-01-09", 1, iso)).toBe("2026-01-12");
  });

  it("skips an approved observed holiday", () => {
    const withEid = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], [
      set({
        dates: [
          {
            observed_date: "2026-01-11",
            label_en: "Closure",
            label_ar: "إغلاق",
            kind: "exceptional_closure",
          },
        ],
      }),
    ]);
    expect(addBusinessDays("2026-01-08", 1, withEid)).toBe("2026-01-12");
  });

  it("is stable across a DST boundary because it works on wall-clock dates", () => {
    const eg = effectiveCalendar(GOVERNED_CALENDARS["mena-eg"], []);
    const a = addBusinessDays("2026-04-23", 3, eg);
    const b = addBusinessDays("2026-04-23", 3, eg);
    expect(a).toBe(b);
    expect(a).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// Recalculation preview / frozen protection
// ---------------------------------------------------------------------------
describe("previewRecalculation", () => {
  const target = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], []);
  const d = (over: Partial<RecalcDeadline>): RecalcDeadline => ({
    id: over.id ?? "d1",
    label: over.label ?? "Notice",
    kind: over.kind ?? "notice",
    status: over.status ?? "open",
    satisfied_at: over.satisfied_at ?? null,
    calendar: over.calendar ?? "business",
    trigger_date: over.trigger_date ?? "2026-01-08",
    duration_days: over.duration_days ?? 1,
    due_date: over.due_date ?? "2026-01-09",
    calendar_id: over.calendar_id ?? "iso-std",
    calendar_version: over.calendar_version ?? "2026.1",
    period_locked: over.period_locked ?? false,
  });

  it("reports before/after evidence and the shift", () => {
    const p = previewRecalculation([d({})], target);
    expect(p.rows[0]!.before_due_date).toBe("2026-01-09");
    expect(p.rows[0]!.after_due_date).toBe("2026-01-11");
    expect(p.rows[0]!.shift_days).toBe(2);
    expect(p.changed_count).toBe(1);
    expect(p.max_shift_days).toBe(2);
  });

  it.each([
    ["satisfied", d({ id: "s", satisfied_at: "2026-01-09T10:00:00Z" }), "satisfied"],
    ["met", d({ id: "m", status: "met" }), "met"],
    ["waived", d({ id: "w", status: "waived" }), "waived"],
    ["superseded", d({ id: "x", status: "superseded" }), "superseded"],
    ["missed", d({ id: "z", status: "missed" }), "missed"],
    ["period locked", d({ id: "p", period_locked: true }), "period_locked"],
  ])("never retroactively moves a %s deadline", (_name, row, reason) => {
    expect(frozenReason(row)).toBe(reason);
    const p = previewRecalculation([row], target);
    expect(p.rows[0]!.frozen).toBe(true);
    expect(p.rows[0]!.after_due_date).toBe(row.due_date);
    expect(p.rows[0]!.changed).toBe(false);
    expect(p.frozen_count).toBe(1);
  });

  it("leaves pure calendar-day deadlines untouched", () => {
    const p = previewRecalculation([d({ calendar: "calendar" })], target);
    expect(p.rows[0]!.changed).toBe(false);
  });

  it("records the applied holiday-set versions as evidence", () => {
    const withSet = effectiveCalendar(GOVERNED_CALENDARS["mena-jo"], [set()]);
    expect(previewRecalculation([d({})], withSet).applied_versions).toEqual(["mena-jo@2026:1"]);
  });

  it("is deterministic and order-stable", () => {
    const rows = [d({ id: "b", due_date: "2026-02-02" }), d({ id: "a", due_date: "2026-01-09" })];
    expect(previewRecalculation(rows, target).rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// Holiday import validation
// ---------------------------------------------------------------------------
describe("validateHolidayImport", () => {
  const good = {
    observed_date: "2026-03-20",
    label_en: "Eid",
    label_ar: "عيد",
    kind: "public_holiday" as const,
  };

  it("accepts a clean import and sorts it", () => {
    const r = validateHolidayImport([{ ...good, observed_date: "2026-04-01" }, good], 2026);
    expect(r.ok).toBe(true);
    expect(r.accepted.map((a) => a.observed_date)).toEqual(["2026-03-20", "2026-04-01"]);
  });

  it("rejects impossible dates", () => {
    const r = validateHolidayImport([{ ...good, observed_date: "2026-02-30" }], 2026);
    expect(r.issues[0]!.code).toBe("invalid_date");
    expect(r.ok).toBe(false);
    expect(isRealIsoDay("2026-02-30")).toBe(false);
    expect(isRealIsoDay("2026-02-28")).toBe(true);
  });

  it("rejects a date outside the set year", () => {
    expect(
      validateHolidayImport([{ ...good, observed_date: "2027-03-20" }], 2026).issues[0]!.code,
    ).toBe("year_mismatch");
  });

  it("requires both EN and AR labels", () => {
    expect(validateHolidayImport([{ ...good, label_ar: "  " }], 2026).issues[0]!.code).toBe(
      "missing_label",
    );
  });

  it("rejects an ungoverned holiday kind", () => {
    expect(
      validateHolidayImport([{ ...good, kind: "bank_holiday" as never }], 2026).issues[0]!.code,
    ).toBe("invalid_kind");
  });

  it("detects duplicates inside the import", () => {
    const r = validateHolidayImport([good, good], 2026);
    expect(r.issues[0]!.code).toBe("duplicate_in_import");
    expect(r.duplicates).toEqual(["2026-03-20"]);
  });

  it("detects duplicates against the existing version", () => {
    const r = validateHolidayImport([good], 2026, [good]);
    expect(r.issues[0]!.code).toBe("duplicate_existing");
    expect(r.accepted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------
describe("governed API schemas", () => {
  it("requires a reason and idempotency-friendly identity on a policy change request", () => {
    expect(() =>
      policyChangeRequestSchema.parse({ scope: "company", to_calendar_id: "mena-jo" }),
    ).toThrow();
    const ok = policyChangeRequestSchema.parse({
      scope: "company",
      to_calendar_id: "mena-jo",
      to_timezone: "Asia/Amman",
      reason: "Adopt Jordanian official calendar",
      idempotency_key: crypto.randomUUID(),
    });
    expect(ok.scope).toBe("company");
  });

  it("constrains a decision to approve/reject and carries optimistic concurrency", () => {
    expect(() =>
      policyChangeDecisionSchema.parse({
        id: crypto.randomUUID(),
        decision: "maybe",
        row_version: 1,
      }),
    ).toThrow();
    expect(
      policyChangeDecisionSchema.parse({
        id: crypto.randomUUID(),
        decision: "approve",
        row_version: 1,
      }).decision,
    ).toBe("approve");
  });

  it("validates holiday set and import payloads", () => {
    expect(() => holidaySetSchema.parse({ calendar_id: "nope", year: 2026 })).toThrow();
    expect(() => holidayImportSchema.parse({ set_id: "not-a-uuid", rows: [] })).toThrow();
  });

  it("validates the recalculation payload", () => {
    expect(() => recalcSchema.parse({})).toThrow();
  });
});
