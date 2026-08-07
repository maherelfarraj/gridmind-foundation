// GC-03 — Costing close, versioning and period-gate rules.
import { describe, expect, it } from "vitest";

import {
  MATERIALITY_DEFAULTS,
  checkPeriodTransition,
  checkPosting,
  currentReportingPeriod,
  evaluateCloseReadiness,
  evaluateMateriality,
  materialityExplanationRequired,
  mostRestrictiveState,
  nextPeriodMonth,
  periodMonthOf,
  reportingToday,
  costingPeriodTransitionSchema,
  costingSettingsSchema,
  type ReadinessFacts,
} from "@/lib/costing.periods";
import {
  checkVersionApproval,
  diffSnapshots,
  nextVersionNumber,
  pickBaselineVersion,
  pickCurrentApproved,
  snapshotTotals,
  UNASSIGNED_COST_CODE_KEY,
  costCodeKey,
  type ForecastSnapshotLine,
} from "@/lib/costing.versions";
import { reverseSnapshot } from "@/lib/costing.fx";

const UUID = "11111111-1111-1111-1111-111111111111";

// ---------------------------------------------------------------- month math
describe("period / timezone semantics", () => {
  it("maps any business date to the first of its month", () => {
    expect(periodMonthOf("2026-03-31")).toBe("2026-03-01");
    expect(periodMonthOf("2026-01-01")).toBe("2026-01-01");
  });

  it("rolls the next period across a year boundary", () => {
    expect(nextPeriodMonth("2026-12-01")).toBe("2027-01-01");
    expect(nextPeriodMonth("2026-01-01")).toBe("2026-02-01");
  });

  it("resolves 'today' in the reporting timezone, not UTC", () => {
    // 2026-03-01T00:30Z is still 2026-02-28 in Los Angeles.
    const at = new Date("2026-03-01T00:30:00Z");
    expect(reportingToday("UTC", at)).toBe("2026-03-01");
    expect(reportingToday("America/Los_Angeles", at)).toBe("2026-02-28");
    expect(currentReportingPeriod("America/Los_Angeles", at)).toBe("2026-02-01");
    expect(currentReportingPeriod("Asia/Amman", at)).toBe("2026-03-01");
  });

  it("falls back to UTC for an invalid timezone", () => {
    const at = new Date("2026-03-01T00:30:00Z");
    expect(reportingToday("Not/AZone", at)).toBe("2026-03-01");
  });

  it("combines company and project locks to the most restrictive state", () => {
    expect(mostRestrictiveState("open", "soft_locked")).toBe("soft_locked");
    expect(mostRestrictiveState("soft_locked", "hard_closed")).toBe("hard_closed");
    expect(mostRestrictiveState(null, undefined, "open")).toBe("open");
    expect(mostRestrictiveState()).toBe("open");
  });
});

// ------------------------------------------------------------ posting gate
describe("checkPosting — the one authoritative posting rule", () => {
  it("allows any post in an open period", () => {
    expect(checkPosting("open", "2026-03-01").allowed).toBe(true);
  });

  it("blocks a hard-closed period and names the next open month", () => {
    const v = checkPosting("hard_closed", "2026-03-01");
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("costing_period_hard_closed");
    expect(v.message).toContain("2026-04");
  });

  it("blocks a soft-locked period for a non-adjustment", () => {
    const v = checkPosting("soft_locked", "2026-03-01", { isAdjustment: false, canAdjust: true });
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("costing_period_soft_locked");
  });

  it("blocks a soft-lock adjustment from an unauthorised user", () => {
    expect(
      checkPosting("soft_locked", "2026-03-01", { isAdjustment: true, canAdjust: false }).allowed,
    ).toBe(false);
  });

  it("allows an authorised, flagged soft-lock adjustment", () => {
    expect(
      checkPosting("soft_locked", "2026-03-01", { isAdjustment: true, canAdjust: true }).allowed,
    ).toBe(true);
  });

  it("never allows a hard-closed adjustment, even for finance admin", () => {
    expect(
      checkPosting("hard_closed", "2026-03-01", { isAdjustment: true, canAdjust: true }).allowed,
    ).toBe(false);
  });
});

// -------------------------------------------------------- state transitions
describe("period transitions", () => {
  it("treats a repeat of the current state as an idempotent no-op", () => {
    const r = checkPeriodTransition("soft_locked", "soft_locked", null);
    expect(r).toEqual({ ok: true, idempotent: true });
  });

  it("requires soft lock before hard close", () => {
    const r = checkPeriodTransition("open", "hard_closed", null);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("costing_period_invalid_transition");
  });

  it("requires a reason to reopen", () => {
    expect(checkPeriodTransition("hard_closed", "open", "  ").code).toBe(
      "costing_period_reason_required",
    );
    expect(checkPeriodTransition("hard_closed", "open", "audit adjustment").ok).toBe(true);
  });

  it("refuses to soft lock a hard-closed period without reopening first", () => {
    expect(checkPeriodTransition("hard_closed", "soft_locked", "x").ok).toBe(false);
  });

  it("rejects a reopen payload without a reason at the schema boundary", () => {
    const base = { companyId: UUID, period: "2026-03-01", target: "open" as const };
    expect(costingPeriodTransitionSchema.safeParse(base).success).toBe(false);
    expect(
      costingPeriodTransitionSchema.safeParse({ ...base, reason: "restating March" }).success,
    ).toBe(true);
  });

  it("rejects a period that is not a month start", () => {
    expect(
      costingPeriodTransitionSchema.safeParse({
        companyId: UUID,
        period: "2026-03-15",
        target: "soft_locked",
      }).success,
    ).toBe(false);
  });

  it("validates settings bounds", () => {
    expect(
      costingSettingsSchema.safeParse({
        companyId: UUID,
        reporting_timezone: "Asia/Amman",
        materiality_abs: 5000,
        materiality_pct: 5,
      }).success,
    ).toBe(true);
    expect(
      costingSettingsSchema.safeParse({
        companyId: UUID,
        reporting_timezone: "Asia/Amman",
        materiality_abs: -1,
        materiality_pct: 5,
      }).success,
    ).toBe(false);
  });
});

// ----------------------------------------------------------- materiality
describe("materiality", () => {
  it("is off entirely under the default policy", () => {
    expect(evaluateMateriality(100, 200, MATERIALITY_DEFAULTS).material).toBe(false);
  });

  it("flags an absolute breach", () => {
    const v = evaluateMateriality(100_000, 106_000, { abs: 5_000, pct: 0 });
    expect(v.material).toBe(true);
    expect(v.reasons).toContain("absolute");
    expect(v.delta).toBe(6000);
  });

  it("flags a percentage breach and computes the pct", () => {
    const v = evaluateMateriality(100_000, 110_000, { abs: 0, pct: 5 });
    expect(v.material).toBe(true);
    expect(v.deltaPct).toBeCloseTo(10, 6);
  });

  it("returns a null pct against a zero base", () => {
    expect(evaluateMateriality(0, 500, { abs: 0, pct: 5 }).deltaPct).toBeNull();
  });

  it("requires a written explanation only for a material movement", () => {
    const material = evaluateMateriality(100_000, 200_000, { abs: 1000, pct: 0 });
    expect(materialityExplanationRequired(material, "short")).toBe(true);
    expect(materialityExplanationRequired(material, "cable scope re-estimated")).toBe(false);
    const immaterial = evaluateMateriality(100_000, 100_010, { abs: 1000, pct: 0 });
    expect(materialityExplanationRequired(immaterial, null)).toBe(false);
  });
});

// ------------------------------------------------------------ readiness
const facts = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  period: "2026-03-01",
  accruals: [],
  forecasts: [],
  invoices: [],
  versions: [{ id: "v1", status: "approved" }],
  ...over,
});

describe("close readiness classification", () => {
  it("is ready with an approved forecast and nothing outstanding", () => {
    const r = evaluateCloseReadiness(facts());
    expect(r.ready).toBe(true);
    expect(r.items).toHaveLength(0);
  });

  it("blocks on draft accruals", () => {
    const r = evaluateCloseReadiness(
      facts({ accruals: [{ id: "a", status: "draft", fx_rate: 1, currency_code: "USD" }] }),
    );
    expect(r.ready).toBe(false);
    expect(r.items.find((i) => i.key === "draft_accruals")?.severity).toBe("blocker");
  });

  it("blocks on unrated approved accruals and forecasts, listing currencies", () => {
    const r = evaluateCloseReadiness(
      facts({
        accruals: [{ id: "a", status: "approved", fx_rate: 0, currency_code: "EUR" }],
        forecasts: [{ id: "f", fx_rate: 0, currency_code: "AED", cost_code_id: null }],
      }),
    );
    const item = r.items.find((i) => i.key === "missing_fx");
    expect(item?.count).toBe(2);
    expect(item?.currencies).toEqual(["AED", "EUR"]);
    expect(r.ready).toBe(false);
  });

  it("blocks on a pending submitted version and on no approved version", () => {
    expect(
      evaluateCloseReadiness(facts({ versions: [{ id: "v", status: "submitted" }] })).items.map(
        (i) => i.key,
      ),
    ).toEqual(["pending_forecast_versions", "no_approved_forecast"]);
  });

  it("keeps uncoded actuals and working versions advisory only", () => {
    const r = evaluateCloseReadiness(
      facts({
        invoices: [{ id: "i", status: "booked", cost_code_id: null }],
        versions: [
          { id: "v1", status: "approved" },
          { id: "v2", status: "working" },
        ],
      }),
    );
    expect(r.ready).toBe(true);
    expect(r.items.every((i) => i.severity === "warning")).toBe(true);
    expect(r.items.map((i) => i.key)).toEqual(["uncoded_actuals", "working_forecast_versions"]);
  });
});

// ------------------------------------------------------ version lifecycle
const line = (over: Partial<ForecastSnapshotLine> = {}): ForecastSnapshotLine => ({
  cost_code_id: "cc-1",
  cost_code_key: "cc-1",
  cost_code: "01-100",
  cost_code_name: "Civil works",
  currency_code: "USD",
  base_currency_code: "USD",
  fx_rate: 1,
  fx_rate_date: "2026-03-01",
  fx_source: "parity",
  fx_override_reason: null,
  etc_amount: 1000,
  etc_amount_base: 1000,
  budget_current: 5000,
  committed: 2000,
  actual: 1500,
  accruals: 250,
  eac: 2750,
  vac: 2250,
  ...over,
});

describe("forecast versions", () => {
  it("numbers the next version above the highest existing", () => {
    expect(nextVersionNumber([{ version_no: 1 }, { version_no: 4 }])).toBe(5);
    expect(nextVersionNumber([])).toBe(1);
  });

  it("keys unassigned lines under a stable bucket", () => {
    expect(costCodeKey(null)).toBe(UNASSIGNED_COST_CODE_KEY);
    expect(costCodeKey("cc-1")).toBe("cc-1");
  });

  it("rolls snapshot totals as actual + accruals + ETC", () => {
    const t = snapshotTotals([line(), line({ cost_code_key: "cc-2", cost_code_id: "cc-2" })], "USD");
    expect(t.actual).toBe(3000);
    expect(t.accruals).toBe(500);
    expect(t.etc).toBe(2000);
    expect(t.eac).toBe(5500);
    expect(t.vac).toBe(4500);
    expect(t.line_count).toBe(2);
  });

  it("picks the earliest approved version as the baseline and the latest as current", () => {
    const versions = [
      { id: "c", status: "approved", version_no: 3, reporting_period: "2026-03-01" },
      { id: "a", status: "superseded", version_no: 1, reporting_period: "2026-01-01" },
      { id: "b", status: "approved", version_no: 2, reporting_period: "2026-02-01" },
    ];
    expect(pickBaselineVersion(versions)?.id).toBe("a");
    expect(pickCurrentApproved(versions)?.id).toBe("c");
  });

  it("diffs two frozen snapshots and explains the EAC movement", () => {
    const from = [line()];
    const to = [line({ actual: 2500, eac: 3750, vac: 1250 })];
    const d = diffSnapshots(from, to);
    expect(d.changed_count).toBe(1);
    expect(d.totals.delta_eac).toBe(1000);
    expect(d.totals.delta_actual).toBe(1000);
    expect(d.rows[0].drivers[0]).toEqual({ key: "actual", delta: 1000 });
  });

  it("marks added and removed cost codes", () => {
    const d = diffSnapshots([line()], [line({ cost_code_id: "cc-9", cost_code_key: "cc-9" })]);
    expect(d.rows.map((r) => r.kind).sort()).toEqual(["added", "removed"]);
  });

  it("blocks approving anything that is not submitted", () => {
    const g = checkVersionApproval({
      status: "working",
      previousEac: 100,
      nextEac: 100,
      policy: MATERIALITY_DEFAULTS,
      explanation: null,
    });
    expect(g.ok).toBe(false);
    expect(g.code).toBe("forecast_invalid_transition");
  });

  it("requires an explanation for a material EAC movement, then approves", () => {
    const args = {
      status: "submitted" as const,
      previousEac: 100_000,
      nextEac: 130_000,
      policy: { abs: 10_000, pct: 0 },
    };
    expect(checkVersionApproval({ ...args, explanation: "too short" }).code).toBe(
      "forecast_materiality_explanation_required",
    );
    const ok = checkVersionApproval({ ...args, explanation: "MV cable re-estimated after survey" });
    expect(ok.ok).toBe(true);
    expect(ok.material).toBe(true);
    expect(ok.delta).toBe(30_000);
  });

  it("approves a first version with no previous approved EAC", () => {
    expect(
      checkVersionApproval({
        status: "submitted",
        previousEac: null,
        nextEac: 5_000_000,
        policy: { abs: 1, pct: 1 },
        explanation: null,
      }).ok,
    ).toBe(true);
  });
});

// ------------------------------------------------------------- reversals
describe("reversal snapshots never re-rate", () => {
  it("negates the transaction and base amounts at the locked rate", () => {
    const r = reverseSnapshot({
      amount: 1000,
      amount_base: 710,
      fx_rate: 0.71,
      fx_rate_date: "2026-02-11",
      fx_source: "table",
    });
    expect(r).toEqual({
      amount: -1000,
      amount_base: -710,
      fx_rate: 0.71,
      fx_rate_date: "2026-02-11",
      fx_source: "table",
    });
  });

  it("a reversal of a hard-closed month targets the next month", () => {
    // The reversal is posted forward; the original month stays frozen.
    expect(nextPeriodMonth(periodMonthOf("2026-03-18"))).toBe("2026-04-01");
  });
});
