// GC-11 — Portfolio scenario & risk forecasting rules.
import { describe, expect, it } from "vitest";

import { sumMoney } from "@/lib/costing.fx";
import {
  deriveMeasures,
  translateMeasures,
  type ConsolidationRate,
  type PortfolioProjectRow,
} from "@/lib/portfolio-costing.rules";
import {
  assumptionImpact,
  assumptionSaveSchema,
  buildBridge,
  buildScenarioCsv,
  buildScenarioProject,
  compareScenarios,
  consolidateScenario,
  overlayMeasures,
  riskBand,
  scenarioCreateSchema,
  stressRate,
  type ScenarioAssumption,
} from "@/lib/portfolio-scenarios.rules";

const rate = (r: number | null): ConsolidationRate => ({
  rate: r,
  as_of: r === null ? null : "2026-03-31",
  source: r === 1 ? "parity" : "table",
  stale: false,
  missing: r === null,
});

const ledger = {
  budget_original: 1000,
  budget_approved_changes: 100,
  paid: 200,
  fx_missing: [] as string[],
};

const totals = {
  budget_current: 1100,
  committed: 700,
  actual: 400,
  accruals: 50,
  etc: 300,
  eac: 750,
  vac: 350,
};

function projectRow(over: Partial<PortfolioProjectRow> = {}): PortfolioProjectRow {
  const project = deriveMeasures(totals, ledger);
  const r = over.rate ?? rate(1);
  return {
    project_id: over.project_id ?? "p1",
    code: over.code ?? "P-1",
    name: over.name ?? "Project One",
    currency: over.currency ?? "USD",
    basis: over.basis ?? "approved",
    version: null,
    project,
    rate: r,
    reporting: over.reporting !== undefined ? over.reporting : translateMeasures(project, r),
    ledger_fx_missing: [],
    close: {
      state: "soft_locked",
      ready: true,
      checklist_total: 0,
      checklist_done: 0,
      checklist_overdue: 0,
      checklist_pct: null,
      exceptions_blockers: 0,
      exceptions_warnings: 0,
      blockers: [],
      owners: [],
      last_action_at: null,
    },
    variance: {
      delta_eac_prior: null,
      delta_eac_baseline: null,
      material: false,
      delta_pct_prior: null,
      explanation: null,
    },
    ...over,
  } as PortfolioProjectRow;
}

function assumption(over: Partial<ScenarioAssumption> = {}): ScenarioAssumption {
  return {
    id: over.id ?? "a1",
    scenario_id: "s1",
    project_id: null,
    cost_code_id: null,
    driver: "etc_adjust",
    period_month: null,
    label: null,
    amount: null,
    pct: null,
    probability: null,
    delay_months: null,
    currency_code: null,
    source_table: null,
    source_id: null,
    note: null,
    sort_order: 0,
    ...over,
  };
}

describe("assumptionImpact", () => {
  it("adds a flat ETC amount", () => {
    expect(assumptionImpact(assumption({ amount: 250 }), 300)).toBe(250);
  });

  it("takes percentages off the approved ETC anchor, not a moving target", () => {
    expect(assumptionImpact(assumption({ driver: "escalation", pct: 10 }), 300)).toBe(30);
    expect(assumptionImpact(assumption({ driver: "inflation", pct: 10 }), 300)).toBe(30);
  });

  it("weights risk and change lines by probability", () => {
    expect(
      assumptionImpact(assumption({ driver: "risk_threat", amount: 400, probability: 0.25 }), 300),
    ).toBe(100);
    expect(
      assumptionImpact(
        assumption({ driver: "change_probability", amount: 200, probability: 0.5 }),
        300,
      ),
    ).toBe(100);
  });

  it("treats opportunities and contingency releases as negative regardless of sign", () => {
    expect(
      assumptionImpact(
        assumption({ driver: "risk_opportunity", amount: 200, probability: 1 }),
        300,
      ),
    ).toBe(-200);
    expect(assumptionImpact(assumption({ driver: "contingency_release", amount: -50 }), 300)).toBe(
      -50,
    );
  });

  it("multiplies a delay by its monthly carrying cost", () => {
    expect(
      assumptionImpact(assumption({ driver: "schedule_delay", amount: 30, delay_months: 3 }), 300),
    ).toBe(90);
  });

  it("ignores pure timing drivers for cost", () => {
    expect(assumptionImpact(assumption({ driver: "cash_timing", amount: 900 }), 300)).toBe(0);
    expect(assumptionImpact(assumption({ driver: "commitment_timing", amount: 900 }), 300)).toBe(0);
  });

  it("clamps out-of-range probabilities instead of amplifying them", () => {
    expect(
      assumptionImpact(assumption({ driver: "risk_threat", amount: 100, probability: 5 }), 300),
    ).toBe(100);
    expect(
      assumptionImpact(assumption({ driver: "risk_threat", amount: 100, probability: -1 }), 300),
    ).toBe(0);
  });
});

describe("riskBand", () => {
  it("returns expected value and an 80th-percentile uplift", () => {
    const band = riskBand(
      [
        assumption({ id: "r1", driver: "risk_threat", amount: 1000, probability: 0.5 }),
        assumption({ id: "r2", driver: "risk_threat", amount: 500, probability: 0.5 }),
      ],
      300,
    );
    expect(band.expected).toBe(750);
    expect(band.p50).toBe(750);
    expect(band.p80).toBeGreaterThan(band.p50);
  });

  it("collapses to a point estimate when everything is certain", () => {
    const band = riskBand(
      [assumption({ driver: "risk_threat", amount: 1000, probability: 1 })],
      300,
    );
    expect(band.sigma).toBe(0);
    expect(band.p80).toBe(band.p50);
  });
});

describe("overlayMeasures", () => {
  it("moves ETC, EAC and VAC only — never the approved actuals or budget", () => {
    const base = deriveMeasures(totals, ledger);
    const out = overlayMeasures(base, 100);
    expect(out.etc).toBe(400);
    expect(out.eac).toBe(850);
    expect(out.vac).toBe(250);
    expect(out.actual).toBe(base.actual);
    expect(out.committed).toBe(base.committed);
    expect(out.budget_current).toBe(base.budget_current);
  });
});

describe("stressRate", () => {
  it("never stresses a parity rate", () => {
    expect(stressRate(rate(1), "shock", 25, true).rate).toBe(1);
  });

  it("applies the shock to a translated pair", () => {
    expect(stressRate(rate(1.1), "shock", 10, false).rate).toBeCloseTo(1.21, 8);
  });

  it("leaves rates untouched in snapshot and current modes", () => {
    expect(stressRate(rate(1.1), "snapshot", 50, false).rate).toBe(1.1);
    expect(stressRate(rate(1.1), "current", 50, false).rate).toBe(1.1);
  });

  it("keeps a missing rate missing rather than inventing parity", () => {
    expect(stressRate(rate(null), "shock", 10, false).missing).toBe(true);
  });
});

describe("buildBridge", () => {
  it("ties from approved EAC to scenario EAC exactly", () => {
    const assumptions = [
      assumption({ id: "a1", amount: 100 }),
      assumption({ id: "a2", driver: "escalation", pct: 10 }),
      assumption({ id: "a3", driver: "risk_threat", amount: 400, probability: 0.5 }),
    ];
    const steps = buildBridge(750, assumptions, 300);
    expect(steps[0]!.driver).toBe("base");
    expect(steps.at(-1)!.driver).toBe("scenario");
    expect(steps.at(-1)!.cumulative).toBe(750 + 100 + 30 + 200);
  });

  it("omits zero-impact drivers", () => {
    const steps = buildBridge(750, [assumption({ driver: "cash_timing", amount: 500 })], 300);
    expect(steps).toHaveLength(2);
  });
});

describe("buildScenarioProject", () => {
  it("applies only assumptions scoped to the project or to all projects", () => {
    const row = projectRow();
    const res = buildScenarioProject(
      row,
      [
        assumption({ id: "g", amount: 50 }),
        assumption({ id: "own", project_id: "p1", amount: 25 }),
        assumption({ id: "other", project_id: "p2", amount: 1000 }),
      ],
      { reportingCurrency: "USD", fxMode: "snapshot", fxShockPct: 0 },
    );
    expect(res.delta_etc).toBe(75);
    expect(res.scenario_project.eac).toBe(825);
    expect(res.assumption_count).toBe(2);
  });

  it("never treats a missing rate as parity", () => {
    const res = buildScenarioProject(projectRow({ rate: rate(null), reporting: null }), [], {
      reportingCurrency: "USD",
      fxMode: "snapshot",
      fxShockPct: 0,
    });
    expect(res.scenario_reporting).toBeNull();
    expect(res.excluded_reason).toBe("fx_rate_missing");
  });

  it("marks projects without a snapshot as excluded", () => {
    const res = buildScenarioProject(projectRow({ basis: "none" }), [], {
      reportingCurrency: "USD",
      fxMode: "snapshot",
      fxShockPct: 0,
    });
    expect(res.excluded_reason).toBe("no_snapshot");
  });

  it("translates the overlay once at the stressed rate", () => {
    const res = buildScenarioProject(
      projectRow({ currency: "EUR", rate: rate(1.1) }),
      [assumption({ amount: 100 })],
      { reportingCurrency: "USD", fxMode: "shock", fxShockPct: 10 },
    );
    // 850 project EAC at 1.21
    expect(res.scenario_reporting!.eac).toBe(1028.5);
  });
});

describe("consolidateScenario", () => {
  const opts = { reportingCurrency: "USD", fxMode: "snapshot" as const, fxShockPct: 0 };

  it("excludes unrateable projects instead of summing them at 1.0", () => {
    const results = [
      buildScenarioProject(projectRow(), [assumption({ amount: 100 })], opts),
      buildScenarioProject(
        projectRow({ project_id: "p2", code: "P-2", rate: rate(null), reporting: null }),
        [],
        opts,
      ),
    ];
    const { totals: t } = consolidateScenario(results);
    expect(t.included).toBe(1);
    expect(t.excluded).toHaveLength(1);
    expect(t.scenario_eac).toBe(850);
    expect(t.delta_eac).toBe(100);
  });

  it("keeps the portfolio bridge tied to the consolidated scenario EAC", () => {
    const results = [
      buildScenarioProject(
        projectRow(),
        [
          assumption({ id: "a1", amount: 100 }),
          assumption({ id: "a2", driver: "risk_threat", amount: 200, probability: 0.5 }),
        ],
        opts,
      ),
      buildScenarioProject(
        projectRow({ project_id: "p2", code: "P-2", currency: "EUR", rate: rate(1.1) }),
        [assumption({ id: "a3", driver: "escalation", pct: 10 })],
        opts,
      ),
    ];
    const { totals: t, bridge } = consolidateScenario(results);
    expect(bridge.at(-1)!.cumulative).toBe(t.scenario_eac);
    expect(bridge[0]!.amount).toBe(t.base_eac);
  });

  it("is idempotent — recomputing the same inputs gives the same totals", () => {
    const build = () =>
      consolidateScenario([
        buildScenarioProject(projectRow(), [assumption({ amount: 123.45 })], opts),
      ]).totals;
    expect(build()).toEqual(build());
  });

  it("adds a P80 uplift above the point estimate when risks are uncertain", () => {
    const { totals: t } = consolidateScenario([
      buildScenarioProject(
        projectRow(),
        [assumption({ driver: "risk_threat", amount: 1000, probability: 0.5 })],
        opts,
      ),
    ]);
    expect(t.p80).toBeGreaterThan(t.scenario_eac);
  });

  it("leaves the approved basis untouched in every result", () => {
    const row = projectRow();
    const before = { ...row.project };
    buildScenarioProject(row, [assumption({ amount: 500 })], opts);
    expect(row.project).toEqual(before);
  });
});

describe("compareScenarios", () => {
  const opts = { reportingCurrency: "USD", fxMode: "snapshot" as const, fxShockPct: 0 };

  it("deltas matching projects and totals the movement", () => {
    const left = [buildScenarioProject(projectRow(), [assumption({ amount: 100 })], opts)];
    const right = [buildScenarioProject(projectRow(), [assumption({ amount: 250 })], opts)];
    const cmp = compareScenarios(left, right);
    expect(cmp.lines[0]!.delta).toBe(150);
    expect(cmp.delta_total).toBe(150);
  });

  it("reports an unmatched project as null rather than zero", () => {
    const left = [buildScenarioProject(projectRow(), [], opts)];
    const cmp = compareScenarios(left, []);
    expect(cmp.lines[0]!.right).toBeNull();
    expect(cmp.lines[0]!.delta).toBeNull();
  });
});

describe("buildScenarioCsv", () => {
  it("emits a deterministic header, one line per project and a total row", () => {
    const opts = { reportingCurrency: "USD", fxMode: "snapshot" as const, fxShockPct: 0 };
    const results = [buildScenarioProject(projectRow(), [assumption({ amount: 100 })], opts)];
    const { totals: t } = consolidateScenario(results);
    const csv = buildScenarioCsv(
      {
        name: "Downside, stressed",
        source_period: "2026-03-01",
        reporting_currency: "USD",
        fx_mode: "snapshot",
      },
      results,
      t,
    );
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("project_code");
    expect(lines[1]).toContain('"Downside, stressed"');
    expect(lines.at(-1)).toContain("TOTAL");
    expect(csv).toBe(
      buildScenarioCsv(
        {
          name: "Downside, stressed",
          source_period: "2026-03-01",
          reporting_currency: "USD",
          fx_mode: "snapshot",
        },
        results,
        t,
      ),
    );
  });
});

describe("schemas", () => {
  it("normalises currency case and rejects malformed periods", () => {
    expect(scenarioCreateSchema.parse({ name: " Base ", reporting_currency: " usd " }).name).toBe(
      "Base",
    );
    expect(scenarioCreateSchema.safeParse({ name: "x", source_period: "2026-03" }).success).toBe(
      false,
    );
    expect(scenarioCreateSchema.safeParse({ name: "", purpose: null }).success).toBe(false);
  });

  it("requires at least one quantified field on an assumption", () => {
    const base = { scenario_id: crypto.randomUUID(), driver: "etc_adjust" as const };
    expect(assumptionSaveSchema.safeParse(base).success).toBe(false);
    expect(assumptionSaveSchema.safeParse({ ...base, amount: 10 }).success).toBe(true);
  });

  it("bounds probability and FX shock", () => {
    expect(
      assumptionSaveSchema.safeParse({
        scenario_id: crypto.randomUUID(),
        driver: "risk_threat",
        amount: 10,
        probability: 1.5,
      }).success,
    ).toBe(false);
    expect(scenarioCreateSchema.safeParse({ name: "x", fx_shock_pct: 900 }).success).toBe(false);
  });
});

describe("money invariants", () => {
  it("sums scenario deltas in minor units, not binary floats", () => {
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    const steps = buildBridge(
      0,
      [assumption({ amount: 0.1 }), assumption({ id: "b", amount: 0.2 })],
      0,
    );
    expect(steps.at(-1)!.cumulative).toBe(0.3);
  });
});
