// GC-08 — Portfolio Cost & Close consolidation rules.
import { describe, expect, it } from "vitest";

import {
  buildConsolidationCsv,
  buildVariance,
  closeMatrixSummary,
  consolidate,
  deriveMeasures,
  officialGate,
  portfolioCostingQuerySchema,
  reconcile,
  topMovers,
  translateMeasures,
  type ConsolidationRate,
  type PortfolioProjectRow,
} from "@/lib/portfolio-costing.rules";

const rate = (r: number | null, extra: Partial<ConsolidationRate> = {}): ConsolidationRate => ({
  rate: r,
  as_of: r === null ? null : "2026-03-31",
  source: r === 1 ? "parity" : "table",
  stale: false,
  missing: r === null,
  ...extra,
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

function row(over: Partial<PortfolioProjectRow> = {}): PortfolioProjectRow {
  const project = deriveMeasures(totals, ledger);
  const r = over.rate ?? rate(1);
  return {
    project_id: over.project_id ?? "p1",
    code: over.code ?? "P-1",
    name: over.name ?? "Project One",
    currency: over.currency ?? "USD",
    basis: over.basis ?? "approved",
    version: over.version ?? null,
    project,
    rate: r,
    reporting: over.reporting !== undefined ? over.reporting : translateMeasures(project, r),
    variance:
      over.variance ??
      buildVariance({
        currentEac: project.eac,
        priorEac: 700,
        baselineEac: 600,
        policy: { thresholdPct: 0.05, thresholdAmount: 10000 },
        explanation: null,
      }),
    close: over.close ?? {
      state: "soft_locked",
      ready: true,
      checklist_total: 4,
      checklist_done: 4,
      checklist_overdue: 0,
      exceptions_blockers: 0,
      exceptions_warnings: 1,
      last_action_at: "2026-04-02T00:00:00Z",
    },
    ...over,
  } as PortfolioProjectRow;
}

describe("deriveMeasures", () => {
  it("uses the project module's available rule (max of committed and actual+accruals)", () => {
    expect(deriveMeasures(totals, ledger).available).toBe(1100 - 700);
  });

  it("returns null outstanding when paid is unavailable", () => {
    const m = deriveMeasures(totals, { ...ledger, paid: null });
    expect(m.paid).toBeNull();
    expect(m.outstanding).toBeNull();
  });
});

describe("translateMeasures", () => {
  it("never treats a missing rate as parity", () => {
    expect(translateMeasures(deriveMeasures(totals, ledger), rate(null))).toBeNull();
  });

  it("rejects non-positive rates", () => {
    expect(translateMeasures(deriveMeasures(totals, ledger), rate(0))).toBeNull();
  });

  it("translates money but leaves ratios alone", () => {
    const m = deriveMeasures(totals, ledger);
    const out = translateMeasures(m, rate(2))!;
    expect(out.eac).toBe(1500);
    expect(out.percent_consumed).toBe(m.percent_consumed);
  });
});

describe("consolidate", () => {
  it("excludes rows with a missing rate rather than summing them at 1.0", () => {
    const rows = [row(), row({ project_id: "p2", code: "P-2", rate: rate(null), reporting: null })];
    const c = consolidate(rows, "USD");
    expect(c.included).toBe(1);
    expect(c.excluded).toEqual([
      { project_id: "p2", code: "P-2", reason: "fx_rate_missing", currency: "USD" },
    ]);
    expect(c.totals.eac).toBe(750);
  });

  it("excludes projects without a snapshot", () => {
    const c = consolidate([row({ basis: "none", reporting: null })], "USD");
    expect(c.included).toBe(0);
    expect(c.excluded[0]!.reason).toBe("no_snapshot");
  });

  it("nulls a ledger total when any contributor is unavailable", () => {
    const p = deriveMeasures(totals, { ...ledger, paid: null });
    const rows = [row(), row({ project_id: "p2", code: "P-2", project: p, reporting: p })];
    const c = consolidate(rows, "USD");
    expect(c.totals.paid).toBeNull();
    expect(c.partial).toContain("paid");
  });

  it("adds translated amounts across currencies exactly once", () => {
    const eurProject = deriveMeasures(totals, ledger);
    const eurRate = rate(1.1);
    const rows = [
      row(),
      row({
        project_id: "p2",
        code: "P-2",
        currency: "EUR",
        rate: eurRate,
        project: eurProject,
        reporting: translateMeasures(eurProject, eurRate),
      }),
    ];
    expect(consolidate(rows, "USD").totals.eac).toBe(750 + 825);
  });
});

describe("officialGate", () => {
  it("is official only when nothing is excluded, indicative or open", () => {
    const rows = [row()];
    expect(officialGate(rows, consolidate(rows, "USD")).official).toBe(true);
  });

  it("flags indicative snapshots and open periods", () => {
    const rows = [
      row({ basis: "indicative" }),
      row({
        project_id: "p2",
        code: "P-2",
        close: { ...row().close, state: "open", ready: false },
      }),
    ];
    const gate = officialGate(rows, consolidate(rows, "USD"));
    expect(gate.official).toBe(false);
    expect(gate.reasons.map((r) => r.key)).toEqual(
      expect.arrayContaining(["indicative_snapshot", "period_open"]),
    );
  });
});

describe("closeMatrixSummary", () => {
  it("aggregates checklist and exception counts", () => {
    const s = closeMatrixSummary([
      row(),
      row({
        project_id: "p2",
        code: "P-2",
        close: {
          state: "open",
          ready: false,
          checklist_total: 6,
          checklist_done: 3,
          checklist_overdue: 2,
          exceptions_blockers: 1,
          exceptions_warnings: 0,
          last_action_at: null,
        },
      }),
    ]);
    expect(s).toMatchObject({
      projects: 2,
      ready: 1,
      blocked: 1,
      open: 1,
      overdue_items: 2,
      blocker_exceptions: 1,
      progress_pct: 70,
    });
  });
});

describe("topMovers", () => {
  it("sorts by absolute movement and skips flat projects", () => {
    const flat = buildVariance({
      currentEac: 700,
      priorEac: 700,
      baselineEac: 700,
      policy: { thresholdPct: 0.05, thresholdAmount: 10000 },
      explanation: null,
    });
    const big = buildVariance({
      currentEac: 900,
      priorEac: 700,
      baselineEac: 600,
      policy: { thresholdPct: 0.05, thresholdAmount: 10000 },
      explanation: null,
    });
    const movers = topMovers([
      row({ variance: flat }),
      row({ project_id: "p2", code: "P-2", variance: big }),
      row({ project_id: "p3", code: "P-3" }),
    ]);
    expect(movers.map((m) => m.code)).toEqual(["P-2", "P-3"]);
  });
});

describe("reconcile", () => {
  it("ties every line back to the published total", () => {
    const rows = [row(), row({ project_id: "p2", code: "P-2" })];
    const rec = reconcile(rows, consolidate(rows, "USD"));
    expect(rec.ok).toBe(true);
    expect(rec.difference).toBe(0);
    expect(rec.lines).toHaveLength(2);
  });
});

describe("buildConsolidationCsv", () => {
  it("emits one line per project plus a total row", () => {
    const rows = [row()];
    const csv = buildConsolidationCsv(rows, consolidate(rows, "USD"), "2026-03-01");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("project_code");
    expect(csv).toContain("P-1");
    expect(lines.at(-1)).toContain("TOTAL");
  });
});

describe("portfolioCostingQuerySchema", () => {
  it("rejects malformed periods and normalizes currency case", () => {
    expect(portfolioCostingQuerySchema.safeParse({ period: "2026-03" }).success).toBe(false);
    expect(portfolioCostingQuerySchema.safeParse({ currency: "usdd" }).success).toBe(false);
    expect(portfolioCostingQuerySchema.parse({ currency: " usd " }).currency).toBe("USD");
    expect(
      portfolioCostingQuerySchema.safeParse({
        period: "2026-03-01",
        currency: "USD",
        basis: "latest",
      }).success,
    ).toBe(true);
  });
});
