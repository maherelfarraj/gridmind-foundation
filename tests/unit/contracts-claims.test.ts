// GC-16 — deterministic contract & claims rules: state machine, delegation,
// deadline calendar arithmetic, exposure math, reconciliation and snapshot
// checksums. Pure functions only — no database, no network.
import { describe, expect, it } from "vitest";

import {
  CLAIM_STATUSES,
  DEFAULT_CALENDAR,
  DEFAULT_DELEGATION,
  MENA_CALENDAR,
  addBusinessDays,
  addCalendarDays,
  assertClaimTransition,
  canTransitionClaim,
  claimExposure,
  computeDueDate,
  concentrationBy,
  daysUntil,
  evaluateDeadline,
  exposureWaterfall,
  emptyTotals,
  reconcile,
  requiresApprovalRole,
  rollupClaims,
  rollupPortfolio,
  snapshotChecksum,
  violatesSegregation,
  withinDelegation,
  type ClaimRecord,
} from "@/lib/contracts-claims.rules";

function claim(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: over.id ?? "c1",
    claim_ref: over.claim_ref ?? "CL-001",
    title: over.title ?? "Grid delay",
    kind: over.kind ?? "variation",
    status: over.status ?? "submitted",
    currency_code: over.currency_code ?? "USD",
    clause_ref: over.clause_ref ?? null,
    entitlement_basis: over.entitlement_basis ?? null,
    asserted_amount: over.asserted_amount ?? 100_000,
    submitted_amount: over.submitted_amount ?? 100_000,
    assessed_amount: over.assessed_amount ?? 0,
    approved_amount: over.approved_amount ?? 0,
    forecast_amount: over.forecast_amount ?? 0,
    certified_amount: over.certified_amount ?? 0,
    paid_amount: over.paid_amount ?? 0,
    at_risk_amount: over.at_risk_amount ?? 0,
    eot_days_claimed: over.eot_days_claimed ?? 0,
    eot_days_assessed: over.eot_days_assessed ?? 0,
    eot_days_approved: over.eot_days_approved ?? 0,
    ld_exposure: over.ld_exposure ?? 0,
    ...over,
  } as ClaimRecord;
}

describe("claim state machine", () => {
  it("allows the governed forward path", () => {
    expect(canTransitionClaim("draft", "notified")).toBe(true);
    expect(canTransitionClaim("submitted", "under_assessment")).toBe(true);
  });

  it("blocks skipping straight from draft to paid", () => {
    expect(canTransitionClaim("draft", "paid")).toBe(false);
    expect(() => assertClaimTransition("draft", "paid")).toThrow();
  });

  it("treats terminal statuses as closed for onward movement", () => {
    for (const s of CLAIM_STATUSES) {
      expect(canTransitionClaim("withdrawn", s)).toBe(false);
    }
  });

  it("marks approval-grade transitions as role gated", () => {
    expect(requiresApprovalRole("approved")).toBe(true);
    expect(requiresApprovalRole("draft")).toBe(false);
  });
});

describe("segregation of duties and delegation", () => {
  it("rejects self-approval by the submitter", () => {
    expect(violatesSegregation({ to: "approved", actorId: "u1", preparedBy: "u1" })).toBe(true);
    expect(
      violatesSegregation({ to: "approved", actorId: "u1", preparedBy: "u0", submittedBy: "u1" }),
    ).toBe(true);
    expect(violatesSegregation({ to: "approved", actorId: null, preparedBy: "u0" })).toBe(true);
  });

  it("permits a different approver", () => {
    expect(
      violatesSegregation({ to: "approved", actorId: "u2", preparedBy: "u1", submittedBy: "u1" }),
    ).toBe(false);
    // Non-approval transitions are never segregation-gated.
    expect(violatesSegregation({ to: "draft", actorId: "u1", preparedBy: "u1" })).toBe(false);
  });

  it("enforces the delegation bands", () => {
    const low = DEFAULT_DELEGATION[0]!;
    expect(withinDelegation(low.limit, [low.role], DEFAULT_DELEGATION)).toBe(true);
    expect(withinDelegation(low.limit + 1, [low.role], DEFAULT_DELEGATION)).toBe(false);
    expect(withinDelegation(low.limit + 1, ["finance_admin"], DEFAULT_DELEGATION)).toBe(true);
    expect(withinDelegation(1, [], DEFAULT_DELEGATION)).toBe(false);
  });
});

describe("deadline calendar arithmetic", () => {
  it("adds calendar days across a month boundary", () => {
    expect(addCalendarDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("skips the default Sat/Sun weekend", () => {
    // 2026-03-06 is a Friday; +1 business day lands on Monday.
    expect(addBusinessDays("2026-03-06", 1, DEFAULT_CALENDAR)).toBe("2026-03-09");
  });

  it("skips the MENA Fri/Sat weekend", () => {
    // 2026-03-05 is a Thursday; +1 business day lands on Sunday.
    expect(addBusinessDays("2026-03-05", 1, MENA_CALENDAR)).toBe("2026-03-08");
  });

  it("computes a due date from a trigger and notice window", () => {
    expect(
      computeDueDate({
        kind: "notice",
        trigger_date: "2026-03-01",
        duration_days: 28,
        calendar: "calendar",
      }),
    ).toBe("2026-03-29");
    expect(
      computeDueDate({
        kind: "notice",
        trigger_date: "2026-03-05",
        duration_days: 1,
        calendar: "business",
        workCalendar: MENA_CALENDAR,
      }),
    ).toBe("2026-03-08");
  });

  it("counts days until deterministically", () => {
    expect(daysUntil("2026-03-10", "2026-03-01")).toBe(9);
    expect(daysUntil("2026-02-28", "2026-03-01")).toBe(-1);
  });

  it("flags an overdue open deadline", () => {
    const state = evaluateDeadline(
      { due_date: "2026-02-01", status: "open" } as never,
      "2026-03-01",
    );
    expect(state.overdue).toBe(true);
  });

  it("never flags a satisfied deadline as overdue", () => {
    const state = evaluateDeadline(
      { due_date: "2026-02-01", status: "open", satisfied_at: "2026-01-20" },
      "2026-03-01",
    );
    expect(state.overdue).toBe(false);
    expect(state.status).toBe("met");
  });

  it("records a late satisfaction as missed but not overdue", () => {
    const state = evaluateDeadline(
      { due_date: "2026-02-01", status: "open", satisfied_at: "2026-02-10" },
      "2026-03-01",
    );
    expect(state.status).toBe("missed");
    expect(state.overdue).toBe(false);
  });
});

describe("exposure math", () => {
  it("holds asserted-but-unapproved value outside live exposure", () => {
    const e = claimExposure(claim({ asserted_amount: 100_000, approved_amount: 0 }));
    expect(e.unapproved).toBe(100_000);
    expect(e.exposure).toBe(0);
  });

  it("counts approved-but-uncertified and certified-but-unpaid as exposure", () => {
    const e = claimExposure(
      claim({ approved_amount: 100_000, certified_amount: 60_000, paid_amount: 20_000 }),
    );
    expect(e.exposure).toBe(80_000);
    expect(e.recoverable).toBe(40_000);
  });

  it("zeroes exposure once a claim is settled", () => {
    const e = claimExposure(claim({ status: "withdrawn", approved_amount: 100_000 }));
    expect(e.settled).toBe(true);
    expect(e.exposure).toBe(0);
  });

  it("rolls up claims without float drift", () => {
    const totals = rollupClaims([
      claim({ id: "a", asserted_amount: 0.1, approved_amount: 0.1 }),
      claim({ id: "b", asserted_amount: 0.2, approved_amount: 0.2 }),
    ]);
    expect(totals.asserted).toBe(0.3);
    expect(totals.approved).toBe(0.3);
    expect(totals.claim_count).toBe(2);
  });

  it("returns a zeroed rollup for no claims", () => {
    expect(rollupClaims([])).toEqual(emptyTotals());
  });

  it("produces a waterfall ending at certified less paid", () => {
    const totals = rollupClaims([
      claim({
        asserted_amount: 100_000,
        submitted_amount: 100_000,
        assessed_amount: 80_000,
        approved_amount: 70_000,
        certified_amount: 50_000,
        paid_amount: 20_000,
      }),
    ]);
    const steps = exposureWaterfall(totals);
    expect(steps[0]!.key).toBe("asserted");
    expect(steps.at(-1)!.cumulative).toBeCloseTo(totals.certified - totals.paid, 2);
  });
});

describe("portfolio rollup and concentration", () => {
  const rows = [
    {
      project_id: "p1",
      project_name: "Alpha",
      currency: "USD",
      totals: rollupClaims([claim({ id: "a", approved_amount: 300 })]),
      open_alerts: 2,
      overdue_deadlines: 1,
    },
    {
      project_id: "p2",
      project_name: "Beta",
      currency: "USD",
      totals: rollupClaims([claim({ id: "b", approved_amount: 100 })]),
      open_alerts: 0,
      overdue_deadlines: 0,
    },
  ];

  it("sums project counts, alerts and overdue deadlines", () => {
    const r = rollupPortfolio(rows);
    expect(r.project_count).toBe(2);
    expect(r.open_alerts).toBe(2);
    expect(r.overdue_deadlines).toBe(1);
  });

  it("ranks concentration by live exposure and shares sum to 100", () => {
    const c = concentrationBy(rows, "live_exposure");
    expect(c[0]!.value).toBeGreaterThanOrEqual(c[1]!.value);
    expect(c.reduce((s, x) => s + x.share_pct, 0)).toBeCloseTo(100, 1);
  });

  it("handles an empty portfolio", () => {
    expect(rollupPortfolio([]).project_count).toBe(0);
    expect(concentrationBy([])).toEqual([]);
  });
});

describe("reconciliation", () => {
  it("passes when the variation register agrees with approved claims", () => {
    const totals = rollupClaims([claim({ approved_amount: 50_000 })]);
    const checks = reconcile({
      totals,
      approved_variations_register: totals.approved,
      forecast_claim_provision: totals.forecast,
    });
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("reports a break when the register diverges", () => {
    const totals = rollupClaims([claim({ approved_amount: 50_000 })]);
    const checks = reconcile({
      totals,
      approved_variations_register: 40_000,
      forecast_claim_provision: totals.forecast,
    });
    expect(checks.some((c) => !c.ok)).toBe(true);
  });
});

describe("snapshot checksum", () => {
  it("is stable for identical lines", () => {
    const lines = [{ claim_id: "a", exposure_amount: 10 }];
    expect(snapshotChecksum(lines)).toBe(snapshotChecksum([{ ...lines[0]! }]));
  });

  it("changes when any value changes", () => {
    expect(snapshotChecksum([{ claim_id: "a", exposure_amount: 10 }])).not.toBe(
      snapshotChecksum([{ claim_id: "a", exposure_amount: 11 }]),
    );
  });
});
