// GC-12 — Comprehensive EVM rules coverage: every progress method, allocation
// reconciliation, PV phasing, all measures and EAC/ETC/VAC/TCPI variants,
// null/zero semantics, FX translation, quality gates, lifecycle and portfolio
// consolidation.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GATE_POLICY,
  DEFAULT_PERFORMANCE_POLICY,
  PROGRESS_METHODS,
  analyseTrend,
  applyOverride,
  assessQuality,
  buildAppendix,
  buildDetailCsv,
  buildFormulaComparisonCsv,
  calculateProgress,
  canTransition,
  checkTransition,
  computeMeasures,
  consolidateEvm,
  earnedDelayDays,
  evmMappingSchema,
  evmOverrideSchema,
  plannedPercent,
  plannedValue,
  quadrantOf,
  reconcileAllocations,
  scopeKeyOf,
  supersedePlan,
  topAdverseMovers,
  translateMeasures,
  type EvmCore,
  type EvmFx,
  type EvmMeasures,
  type EvmNode,
  type MappingRow,
  type PortfolioEvmRow,
} from "@/lib/evm.report.rules";

const core = (over: Partial<EvmCore> = {}): EvmCore => ({
  bac: 1000,
  pv: 500,
  ev: 400,
  ac: 500,
  bottom_up_etc: 700,
  ...over,
});

// ---------------------------------------------------------------------------
// Progress methods
// ---------------------------------------------------------------------------
describe("calculateProgress", () => {
  it("covers every configured progress method", () => {
    expect(PROGRESS_METHODS).toHaveLength(7);
  });

  it("physical_pct clamps and rounds reported progress", () => {
    expect(calculateProgress({ method: "physical_pct", physical_pct: 43.45678 }).calculated_pct).toBe(
      43.4568,
    );
    expect(calculateProgress({ method: "physical_pct", physical_pct: 140 }).calculated_pct).toBe(100);
    expect(calculateProgress({ method: "physical_pct", physical_pct: -5 }).calculated_pct).toBe(0);
  });

  it("physical_pct reports a gap when nothing was reported", () => {
    const r = calculateProgress({ method: "physical_pct" });
    expect(r.calculated_pct).toBeNull();
    expect(r.gap).toBe("no_physical");
  });

  it("weighted_milestone earns completed weights over total weight", () => {
    const r = calculateProgress({
      method: "weighted_milestone",
      milestones: [
        { key: "a", weight_pct: 30, complete: true },
        { key: "b", weight_pct: 50, complete: false },
        { key: "c", weight_pct: 20, complete: true },
      ],
    });
    expect(r.calculated_pct).toBe(50);
  });

  it("weighted_milestone with zero total weight is a gap, not a divide-by-zero", () => {
    const r = calculateProgress({
      method: "weighted_milestone",
      milestones: [{ key: "a", weight_pct: 0, complete: true }],
    });
    expect(r.calculated_pct).toBeNull();
    expect(r.gap).toBe("no_milestones");
  });

  it("units_complete divides done by planned units", () => {
    expect(
      calculateProgress({ method: "units_complete", units_complete: 30, planned_units: 120 })
        .calculated_pct,
    ).toBe(25);
    expect(
      calculateProgress({ method: "units_complete", units_complete: 5, planned_units: 0 }).gap,
    ).toBe("no_units");
  });

  it("zero_hundred, twenty_eighty and fifty_fifty step on start and completion", () => {
    expect(calculateProgress({ method: "zero_hundred", started: true }).calculated_pct).toBe(0);
    expect(calculateProgress({ method: "zero_hundred", complete: true }).calculated_pct).toBe(100);
    expect(calculateProgress({ method: "twenty_eighty", started: true }).calculated_pct).toBe(20);
    expect(calculateProgress({ method: "twenty_eighty", complete: true }).calculated_pct).toBe(100);
    expect(calculateProgress({ method: "fifty_fifty", started: true }).calculated_pct).toBe(50);
    expect(calculateProgress({ method: "fifty_fifty" }).calculated_pct).toBe(0);
  });

  it("level_of_effort mirrors the planned percent", () => {
    expect(calculateProgress({ method: "level_of_effort", planned_pct: 62.5 }).calculated_pct).toBe(
      62.5,
    );
    expect(calculateProgress({ method: "level_of_effort" }).gap).toBe("no_planned");
  });
});

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------
describe("applyOverride", () => {
  it("ignores an override without reason or evidence", () => {
    const r = applyOverride(40, { override_pct: 80, reason: "short", evidence_ref: "" });
    expect(r.overridden).toBe(false);
    expect(r.applied_pct).toBe(40);
  });

  it("applies an authorised override and keeps the calculated value visible", () => {
    const r = applyOverride(40, {
      override_pct: 80,
      reason: "Survey confirms installed quantities",
      evidence_ref: "DOC-1201",
    });
    expect(r.overridden).toBe(true);
    expect(r.applied_pct).toBe(80);
    expect(r.calculated_pct).toBe(40);
    expect(r.override_evidence).toBe("DOC-1201");
  });

  it("rejects an override payload missing evidence at the schema boundary", () => {
    const base = {
      project_id: "11111111-1111-4111-8111-111111111111",
      period: "2026-03-01",
      wbs_item_id: "22222222-2222-4222-8222-222222222222",
      override_pct: 50,
      reason: "Survey confirms installed quantities",
    };
    expect(evmOverrideSchema.safeParse({ ...base, evidence_ref: "DOC-1" }).success).toBe(true);
    expect(evmOverrideSchema.safeParse({ ...base, evidence_ref: "" }).success).toBe(false);
    expect(evmOverrideSchema.safeParse({ ...base, evidence_ref: "D", reason: "short" }).success).toBe(
      false,
    );
    expect(
      evmOverrideSchema.safeParse({
        ...base,
        wbs_item_id: null,
        schedule_task_id: null,
        evidence_ref: "DOC-1",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Allocations
// ---------------------------------------------------------------------------
describe("reconcileAllocations", () => {
  const map = (over: Partial<MappingRow>): MappingRow => ({
    id: over.id ?? "m1",
    wbs_item_id: over.wbs_item_id ?? null,
    schedule_task_id: over.schedule_task_id ?? null,
    cost_code_id: over.cost_code_id ?? "c1",
    allocation_pct: over.allocation_pct ?? 100,
    progress_method: over.progress_method ?? "physical_pct",
    milestone_weights: null,
    planned_units: null,
  });

  it("reports a scope that totals exactly 100% as reconciled", () => {
    const rows = reconcileAllocations([
      map({ id: "a", wbs_item_id: "w1", allocation_pct: 60 }),
      map({ id: "b", wbs_item_id: "w1", cost_code_id: "c2", allocation_pct: 40 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].total_pct).toBe(100);
  });

  it("flags over- and under-allocated scope separately", () => {
    const rows = reconcileAllocations([
      map({ id: "a", wbs_item_id: "w1", allocation_pct: 70 }),
      map({ id: "b", schedule_task_id: "t1", allocation_pct: 130 }),
    ]);
    const under = rows.find((r) => r.scope_key === "wbs:w1")!;
    const over = rows.find((r) => r.scope_key === "task:t1")!;
    expect(under.under).toBe(true);
    expect(over.over).toBe(true);
  });

  it("keys a task mapping by task even when a WBS item is also set", () => {
    expect(scopeKeyOf({ wbs_item_id: "w1", schedule_task_id: "t1" })).toBe("task:t1");
    expect(scopeKeyOf({ wbs_item_id: "w1", schedule_task_id: null })).toBe("wbs:w1");
  });

  it("accepts a valid mapping payload and rejects a scopeless one", () => {
    const ok = evmMappingSchema.safeParse({
      mapping_version_id: "33333333-3333-4333-8333-333333333333",
      wbs_item_id: "22222222-2222-4222-8222-222222222222",
      cost_code_id: "44444444-4444-4444-8444-444444444444",
      allocation_pct: 100,
      progress_method: "physical_pct",
    });
    expect(ok.success).toBe(true);
    const bad = evmMappingSchema.safeParse({
      mapping_version_id: "33333333-3333-4333-8333-333333333333",
      allocation_pct: 100,
      progress_method: "physical_pct",
    });
    expect(bad.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PV time phasing
// ---------------------------------------------------------------------------
describe("planned value phasing", () => {
  const win = { baseline_start: "2026-01-01", baseline_finish: "2026-01-11" };

  it("is 0 before the baseline start and 100 after the finish", () => {
    expect(plannedPercent({ bac: 100, ...win, data_date: "2025-12-31" })).toBe(0);
    expect(plannedPercent({ bac: 100, ...win, data_date: "2026-02-01" })).toBe(100);
  });

  it("phases linearly inside the baseline window", () => {
    expect(plannedPercent({ bac: 100, ...win, data_date: "2026-01-06" })).toBe(50);
    expect(plannedValue({ bac: 1000, ...win, data_date: "2026-01-06" })).toBe(500);
  });

  it("steps a milestone on its baseline date", () => {
    const ms = { bac: 250, ...win, is_milestone: true };
    expect(plannedValue({ ...ms, data_date: "2026-01-10" })).toBe(0);
    expect(plannedValue({ ...ms, data_date: "2026-01-11" })).toBe(250);
  });

  it("returns null when baseline dates are missing rather than phasing at zero", () => {
    expect(
      plannedPercent({ bac: 100, baseline_start: null, baseline_finish: null, data_date: "2026-01-06" }),
    ).toBeNull();
    expect(
      plannedValue({ bac: 100, baseline_start: "2026-01-01", baseline_finish: null, data_date: "2026-01-06" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Measures and formula variants
// ---------------------------------------------------------------------------
describe("computeMeasures", () => {
  it("derives SV, CV, SPI and CPI from EV, PV and AC", () => {
    const m = computeMeasures(core());
    expect(m.sv).toBe(-100);
    expect(m.cv).toBe(-100);
    expect(m.spi).toBe(0.8);
    expect(m.cpi).toBe(0.8);
    expect(m.percent_planned).toBe(50);
    expect(m.percent_complete).toBe(40);
    expect(m.percent_spent).toBe(50);
  });

  it("computes every EAC variant independently of the selected method", () => {
    const m = computeMeasures(core(), "cpi");
    expect(m.eac_bottom_up).toBe(1200); // AC 500 + bottom-up ETC 700
    expect(m.eac_cpi).toBe(1250); // BAC / CPI
    expect(m.eac_cpi_spi).toBe(1562.5); // BAC / (CPI x SPI)
    expect(m.eac_ac_plus_remaining).toBe(1100); // AC + (BAC - EV)
    expect(m.eac).toBe(m.eac_cpi);
    expect(m.eac_method).toBe("cpi");
  });

  it("selects each EAC method in turn", () => {
    expect(computeMeasures(core(), "bottom_up").eac).toBe(1200);
    expect(computeMeasures(core(), "cpi").eac).toBe(1250);
    expect(computeMeasures(core(), "cpi_spi").eac).toBe(1562.5);
    expect(computeMeasures(core(), "ac_plus_remaining").eac).toBe(1100);
  });

  it("derives ETC and VAC from the selected EAC", () => {
    const m = computeMeasures(core(), "cpi");
    expect(m.etc).toBe(750); // EAC 1250 - AC 500
    expect(m.vac).toBe(-250); // BAC 1000 - EAC 1250
  });

  it("computes TCPI against BAC and EAC", () => {
    const m = computeMeasures(core(), "cpi");
    expect(m.tcpi_bac).toBe(1.2); // (1000-400) / (1000-500)
    expect(m.tcpi_eac).toBe(0.8); // (1000-400) / (1250-500)
  });

  it("returns null TCPI when no funds remain", () => {
    const m = computeMeasures(core({ ac: 1000, bottom_up_etc: 0 }), "bottom_up");
    expect(m.tcpi_bac).toBeNull();
  });

  it("keeps nulls null instead of coercing to zero", () => {
    const m = computeMeasures({ bac: 1000, pv: null, ev: null, ac: null, bottom_up_etc: null });
    expect(m.sv).toBeNull();
    expect(m.cv).toBeNull();
    expect(m.spi).toBeNull();
    expect(m.cpi).toBeNull();
    expect(m.eac).toBeNull();
    expect(m.etc).toBeNull();
  });

  it("returns null indices on zero denominators", () => {
    const m = computeMeasures({ bac: 0, pv: 0, ev: 0, ac: 0, bottom_up_etc: 0 });
    expect(m.spi).toBeNull();
    expect(m.cpi).toBeNull();
    expect(m.eac_cpi).toBeNull();
    expect(m.eac_cpi_spi).toBeNull();
  });

  it("rounds money to two decimals deterministically", () => {
    const m = computeMeasures({ bac: 1000.005, pv: 333.333, ev: 333.335, ac: 111.111, bottom_up_etc: 0 });
    expect(m.bac).toBe(1000.01);
    expect(m.pv).toBe(333.33);
    expect(Number.isInteger(Math.round(m.ac! * 100))).toBe(true);
  });

  it("computes the same result for the same inputs", () => {
    expect(computeMeasures(core(), "cpi")).toEqual(computeMeasures(core(), "cpi"));
  });
});

describe("earnedDelayDays", () => {
  it("reports positive days when earned progress lags the baseline curve", () => {
    const d = earnedDelayDays({
      percent_complete: 25,
      baseline_start: "2026-01-01",
      baseline_finish: "2026-01-11",
      data_date: "2026-01-06",
    });
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("is null without a percent complete", () => {
    expect(
      earnedDelayDays({
        percent_complete: null,
        baseline_start: "2026-01-01",
        baseline_finish: "2026-01-11",
        data_date: "2026-01-06",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------
describe("translateMeasures", () => {
  const fx = (over: Partial<EvmFx> = {}): EvmFx => ({
    rate: 2,
    as_of: "2026-03-31",
    source: "table",
    stale: false,
    missing: false,
    ...over,
  });

  it("converts money once and leaves ratios untouched", () => {
    const m = computeMeasures(core(), "cpi");
    const out = translateMeasures(m, fx())!;
    expect(out.bac).toBe(2000);
    expect(out.ev).toBe(800);
    expect(out.eac).toBe(2500);
    expect(out.cpi).toBe(m.cpi);
    expect(out.spi).toBe(m.spi);
    expect(out.percent_complete).toBe(m.percent_complete);
  });

  it("does not double convert when applied to already converted measures", () => {
    const m = computeMeasures(core(), "cpi");
    const once = translateMeasures(m, fx())!;
    expect(once.bac).toBe(2000);
    expect(m.bac).toBe(1000);
  });

  it("excludes rather than falling back to parity when the rate is missing", () => {
    const m = computeMeasures(core());
    expect(translateMeasures(m, fx({ missing: true }))).toBeNull();
    expect(translateMeasures(m, fx({ rate: null }))).toBeNull();
    expect(translateMeasures(m, fx({ rate: 0 }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Quality gates
// ---------------------------------------------------------------------------
describe("assessQuality", () => {
  const input = {
    unmapped_bac: 0,
    total_bac: 1000,
    allocation_issues: [],
    missing_baseline_dates: 0,
    missing_budget: 0,
    stale_progress: 0,
    future_dated_progress: 0,
    missing_actuals: 0,
    fx_missing: [] as string[],
  };

  it("is ready to approve when nothing is wrong", () => {
    const r = assessQuality(input, DEFAULT_GATE_POLICY);
    expect(r.exceptions).toHaveLength(0);
    expect(r.blockers).toBe(0);
    expect(r.ready_to_approve).toBe(true);
  });

  it("blocks when unmapped budget exceeds the configured tolerance", () => {
    const r = assessQuality({ ...input, unmapped_bac: 200 }, DEFAULT_GATE_POLICY);
    expect(r.unmapped_pct).toBe(20);
    expect(r.blockers).toBeGreaterThan(0);
    expect(r.ready_to_approve).toBe(false);
  });

  it("warns instead of blocking when the gate is disabled", () => {
    const r = assessQuality(
      { ...input, unmapped_bac: 200 },
      { ...DEFAULT_GATE_POLICY, gate_block_on_unmapped: false },
    );
    expect(r.blockers).toBe(0);
    expect(r.warnings).toBeGreaterThan(0);
  });

  it("raises an exception for unreconciled allocations", () => {
    const r = assessQuality(
      {
        ...input,
        allocation_issues: [
          { scope_key: "wbs:w1", total_pct: 130, ok: false, over: true, under: false },
        ],
      },
      DEFAULT_GATE_POLICY,
    );
    expect(r.exceptions.some((e) => e.code === "allocation_over")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
describe("lifecycle", () => {
  it("allows only the documented transitions", () => {
    expect(canTransition("working", "submitted")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("approved", "working")).toBe(false);
    expect(canTransition("superseded", "approved")).toBe(false);
  });

  it("refuses self approval", () => {
    const r = checkTransition({
      from: "submitted",
      to: "approved",
      actorId: "u1",
      submittedBy: "u1",
    });
    expect(r.ok).toBe(false);
  });

  it("refuses approval with open gate blockers and submission into a locked period", () => {
    const base = {
      from: "submitted" as const,
      to: "approved" as const,
      actorId: "u2",
      submittedBy: "u1",
      gateReady: true,
    };
    expect(checkTransition(base).ok).toBe(true);
    expect(checkTransition({ ...base, gateReady: false }).ok).toBe(false);
    expect(
      checkTransition({ from: "working", to: "submitted", actorId: "u1", periodLocked: true }).ok,
    ).toBe(false);
  });

  it("only supersedes an approved report", () => {
    const cur = { id: "r1", version_no: 2 };
    const approved = supersedePlan({
      current: { ...cur, status: "approved" },
      reason: "Restated after cost correction",
    });
    expect(approved.ok).toBe(true);
    expect(approved.next_version_no).toBe(3);
    expect(
      supersedePlan({
        current: { ...cur, status: "working" },
        reason: "Restated after cost correction",
      }).ok,
    ).toBe(false);
    expect(supersedePlan({ current: { ...cur, status: "approved" }, reason: "no" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Portfolio consolidation and exports
// ---------------------------------------------------------------------------
describe("portfolio consolidation", () => {
  const measures = (over: Partial<EvmMeasures> = {}): EvmMeasures => ({
    ...computeMeasures(core(), "cpi"),
    ...over,
  });
  const row = (over: Partial<PortfolioEvmRow>): PortfolioEvmRow => ({
    project_id: over.project_id ?? "p1",
    code: over.code ?? "P-1",
    name: over.name ?? "Project one",
    period_month: "2026-03-01",
    status: "approved",
    currency: "JOD",
    project: measures(),
    fx: { rate: 1, as_of: "2026-03-31", source: "parity", stale: false, missing: false },
    reporting: over.reporting === undefined ? measures() : over.reporting,
    mapping_completeness_pct: 100,
    eac_method: "cpi",
    blockers: 0,
    warnings: 0,
    prior_cpi: 1,
    prior_spi: 1,
    ...over,
  });

  it("sums included projects and excludes those without an FX rate", () => {
    const totals = consolidateEvm(
      [row({ project_id: "p1" }), row({ project_id: "p2", code: "P-2", reporting: null })],
      "USD",
    );
    expect(totals.included).toBe(1);
    expect(totals.excluded).toHaveLength(1);
    expect(totals.excluded[0].reason).toBe("fx_rate_missing");
    expect(totals.bac).toBe(1000);
  });

  it("classifies performance quadrants against the policy", () => {
    expect(quadrantOf({ cpi: 1.05, spi: 1.02 }, DEFAULT_PERFORMANCE_POLICY)).toBe("on_track");
    expect(quadrantOf({ cpi: 0.8, spi: 1.02 }, DEFAULT_PERFORMANCE_POLICY)).toBe("cost_risk");
    expect(quadrantOf({ cpi: 1.05, spi: 0.8 }, DEFAULT_PERFORMANCE_POLICY)).toBe("schedule_risk");
    expect(quadrantOf({ cpi: 0.8, spi: 0.8 }, DEFAULT_PERFORMANCE_POLICY)).toBe("both_risk");
    expect(quadrantOf({ cpi: null, spi: null }, DEFAULT_PERFORMANCE_POLICY)).toBe("unknown");
  });

  it("ranks adverse movers by CPI deterioration", () => {
    const movers = topAdverseMovers([
      row({ project_id: "p1", code: "P-1", prior_cpi: 1.2, prior_spi: 1 }),
      row({ project_id: "p2", code: "P-2", prior_cpi: 0.81, prior_spi: 1 }),
    ]);
    expect(movers[0].code).toBe("P-1");
  });
});

describe("exports and appendix", () => {
  const node = (over: Partial<EvmNode> = {}): EvmNode => ({
    key: "n1",
    parent_key: null,
    label: "Civil works",
    level: 1,
    wbs_item_id: "w1",
    cost_code_id: "c1",
    schedule_task_id: null,
    progress_method: "physical_pct",
    allocation_pct: 100,
    calculated_pct: 40,
    applied_pct: 40,
    overridden: false,
    core: core(),
    measures: computeMeasures(core(), "cpi"),
    ...over,
  });

  it("writes one CSV row per node plus a header", () => {
    const csv = buildDetailCsv([node(), node({ key: "n2", label: "Electrical" })]);
    expect(csv.trim().split("\n")).toHaveLength(3);
  });

  it("writes a formula comparison row per EAC variant", () => {
    const csv = buildFormulaComparisonCsv(computeMeasures(core(), "cpi"));
    expect(csv).toContain("cpi");
    expect(csv.split("\n").length).toBeGreaterThan(4);
  });

  it("sorts appendix quality gaps deterministically", () => {
    const appendix = buildAppendix({
      period_month: "2026-03-01",
      data_date: "2026-03-31",
      status: "approved",
      basis: {
        cost_basis: "posted_actuals",
        ac_basis: "actual_only",
        eac_method: "cpi",
        schedule_baseline: "BL-2",
      },
      fx: {
        reporting_currency: "USD",
        project_currency: "JOD",
        rate: 1.41,
        as_of: "2026-03-31",
        source: "table",
      },
      approvals: {
        prepared_by: "u1",
        submitted_by: "u1",
        approved_by: "u2",
        approved_at: "2026-04-02T09:00:00Z",
      },
      measures: computeMeasures(core(), "cpi"),
      quality_gaps: [
        { code: "stale_progress", severity: "warning", title: "Stale progress" },
        { code: "missing_budget", severity: "warning", title: "Missing budget" },
      ],
      reconciliation: { ok: true, difference: 0 },
    });
    expect(appendix.quality_gaps.map((g) => g.code)).toEqual(["missing_budget", "stale_progress"]);
  });

  it("analyses period-over-period deltas", () => {
    const points = [
      { period_month: "2026-02-01", pv: 400, ev: 350, ac: 380, cpi: 0.92, spi: 0.88, eac: 1100, bac: 1000 },
      { period_month: "2026-03-01", pv: 500, ev: 400, ac: 500, cpi: 0.8, spi: 0.8, eac: 1250, bac: 1000 },
    ];
    const a = analyseTrend(points, DEFAULT_PERFORMANCE_POLICY);
    expect(a.points).toHaveLength(2);
    expect(a.cpi_delta).not.toBeNull();
    expect(a.eac_delta).not.toBeNull();
  });
});
