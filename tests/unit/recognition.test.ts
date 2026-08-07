// GC-15 — Recognition (revenue / WIP / PoC) deterministic core tests.
import { describe, expect, it } from "vitest";

import portfolioAr from "@/lib/i18n/portfolio.ar.json";
import portfolioEn from "@/lib/i18n/portfolio.en.json";
import {
  ageBucket,
  ageWip,
  applySensitivity,
  approvalBlockers,
  canApprove,
  canTransition,
  computeLine,
  computeProgress,
  concentrationBy,
  costToCostProgress,
  DEFAULT_POLICY,
  deriveExceptions,
  evaluateRecognitionAlerts,
  fingerprint,
  isFrozen,
  milestoneProgress,
  RECOGNITION_ALERT_RULES,
  RECOGNITION_DISCLAIMER,
  RECOGNITION_METHODS,
  reconcile,
  reconciliationFailures,
  rollupLines,
  rollupPortfolio,
  safeRatio,
  sourceRank,
  timeProgress,
  violatesSegregation,
  type ObligationInput,
  type PortfolioProjectInput,
  type RecognitionPolicy,
} from "@/lib/recognition.rules";

const AS_OF = "2026-06-30";

const policy: RecognitionPolicy = { ...DEFAULT_POLICY };

function obligation(over: Partial<ObligationInput> = {}): ObligationInput {
  return {
    id: "o1",
    code: "PO-01",
    label: "EPC works",
    contract_id: "c1",
    currency_code: "USD",
    method: "cost_to_cost",
    base_price: 1_000_000,
    cost_incurred: 400_000,
    cost_to_complete: 400_000,
    prior_revenue: 300_000,
    billed_to_date: 350_000,
    cash_received: 200_000,
    fx_rate: 1,
    fx_rate_date: "2026-06-30",
    fx_source: "ecb",
    ...over,
  };
}

describe("progress bases", () => {
  it("cost-to-cost is incurred / EAC and never divides by zero", () => {
    expect(costToCostProgress(400_000, 800_000)).toBeCloseTo(0.5, 10);
    expect(costToCostProgress(1, 0)).toBeNull();
  });

  it("milestone progress weights by value, not count", () => {
    expect(
      milestoneProgress([
        { code: "m1", value: 900, achieved: true },
        { code: "m2", value: 100, achieved: false },
      ]),
    ).toBeCloseTo(0.9, 10);
    expect(milestoneProgress([])).toBeNull();
  });

  it("time progress clamps to the contract window", () => {
    expect(timeProgress("2026-01-01", "2026-12-31", "2027-06-30")).toBe(1);
    expect(timeProgress(null, "2026-12-31", AS_OF)).toBeNull();
  });

  it("computeProgress honours the declared basis", () => {
    const p = computeProgress(
      obligation({ progress_basis: "cost" }),
      "cost_to_cost",
      AS_OF,
      800_000,
    );
    expect(p).toBeCloseTo(0.5, 10);
  });

  it("safeRatio and sourceRank are total functions", () => {
    expect(safeRatio(1, 0)).toBeNull();
    expect(sourceRank("contract")).toBeLessThan(sourceRank("forecast"));
  });
});

describe("computeLine — cost-to-cost", () => {
  const line = computeLine(obligation(), policy, AS_OF);

  it("prices, progresses and recognises deterministically", () => {
    expect(line.transaction_price).toBe(1_000_000);
    expect(line.eac).toBe(800_000);
    expect(line.progress_pct).toBeCloseTo(0.5, 10);
    expect(line.cumulative_revenue).toBe(500_000);
    expect(line.period_revenue).toBe(200_000);
    expect(line.gross_profit).toBe(100_000);
  });

  it("derives the WIP identity: asset − liability = revenue − billed", () => {
    expect(line.contract_asset - line.contract_liability).toBe(
      line.cumulative_revenue - line.billed_to_date,
    );
    expect(line.contract_asset).toBe(150_000);
    expect(line.contract_liability).toBe(0);
  });

  it("is idempotent for identical inputs", () => {
    expect(computeLine(obligation(), policy, AS_OF)).toEqual(line);
  });
});

describe("computeLine — policy behaviours", () => {
  it("excludes unapproved consideration unless the policy constrains it in", () => {
    const strict = computeLine(obligation({ unapproved_variations: 200_000 }), policy, AS_OF);
    expect(strict.transaction_price).toBe(1_000_000);
    expect(strict.flags).toContain("unapproved_exposure");

    const permissive = computeLine(
      obligation({ unapproved_variations: 200_000 }),
      { ...policy, include_unapproved_variations: true, constraint_pct: 50 },
      AS_OF,
    );
    expect(permissive.transaction_price).toBe(1_100_000);
  });

  it("raises a loss provision when EAC exceeds the transaction price", () => {
    const l = computeLine(
      obligation({ cost_incurred: 700_000, cost_to_complete: 600_000 }),
      policy,
      AS_OF,
    );
    expect(l.loss_provision).toBeGreaterThan(0);
    expect(l.flags).toContain("loss_making");
  });

  it("caps progress at 100% when configured", () => {
    const l = computeLine(
      obligation({ cost_incurred: 900_000, cost_to_complete: 0 }),
      policy,
      AS_OF,
    );
    expect(l.progress_pct).toBeLessThanOrEqual(1);
    expect(l.progress_capped || l.progress_pct === 1).toBe(true);
  });

  it("flags reversals and over-billing", () => {
    const reversal = computeLine(obligation({ prior_revenue: 900_000 }), policy, AS_OF);
    expect(reversal.period_revenue).toBeLessThan(0);
    expect(reversal.flags).toContain("revenue_reversal");

    const over = computeLine(obligation({ billed_to_date: 900_000 }), policy, AS_OF);
    expect(over.contract_liability).toBeGreaterThan(0);
    expect(over.flags).toContain("overbilled");
  });

  it("flags missing and stale FX and keeps reporting figures separate", () => {
    const missing = computeLine(obligation({ fx_rate: null }), policy, AS_OF);
    expect(missing.flags).toContain("missing_fx");

    const stale = computeLine(obligation({ fx_stale: true }), policy, AS_OF);
    expect(stale.flags).toContain("stale_fx");

    const fx = computeLine(obligation({ fx_rate: 2 }), policy, AS_OF);
    expect(fx.cumulative_revenue_reporting).toBe(fx.cumulative_revenue * 2);
    expect(fx.cumulative_revenue).toBe(500_000);
  });

  it("supports every declared method without throwing", () => {
    for (const method of RECOGNITION_METHODS) {
      const l = computeLine(
        obligation({
          method,
          milestones: [{ code: "m", value: 1, achieved: true }],
          output_progress: 0.4,
          manual_progress: 0.4,
          start_date: "2026-01-01",
          end_date: "2026-12-31",
          is_complete: method === "completed_contract",
        }),
        policy,
        AS_OF,
      );
      expect(Number.isFinite(l.cumulative_revenue)).toBe(true);
      expect(l.method).toBe(method);
    }
  });
});

describe("rollup and reconciliation", () => {
  const lines = [
    computeLine(obligation(), policy, AS_OF),
    computeLine(obligation({ id: "o2", code: "PO-02", base_price: 500_000 }), policy, AS_OF),
  ];
  const totals = rollupLines(lines);

  it("totals equal the sum of the lines", () => {
    expect(totals.obligations).toBe(2);
    expect(totals.cumulative_revenue).toBe(lines.reduce((a, l) => a + l.cumulative_revenue, 0));
  });

  it("every reconciliation identity holds on a clean snapshot", () => {
    const checks = reconcile(lines, totals);
    expect(reconciliationFailures(checks)).toEqual([]);
    expect(checks.map((c) => c.code)).toContain("wip_identity");
  });

  it("a tampered total is caught by reconciliation", () => {
    const checks = reconcile(lines, { ...totals, billed_to_date: totals.billed_to_date + 1 });
    expect(reconciliationFailures(checks).length).toBeGreaterThan(0);
  });
});

describe("exceptions, blockers and lifecycle", () => {
  it("critical exceptions block approval, warnings do not", () => {
    const lossLine = computeLine(
      obligation({ cost_incurred: 900_000, cost_to_complete: 500_000 }),
      policy,
      AS_OF,
    );
    const totals = rollupLines([lossLine]);
    const ex = deriveExceptions([lossLine], totals, policy, reconcile([lossLine], totals));
    expect(approvalBlockers(ex).length).toBeGreaterThan(0);
    expect(canApprove(ex)).toBe(false);

    const clean = computeLine(obligation(), policy, AS_OF);
    const cleanTotals = rollupLines([clean]);
    expect(
      canApprove(deriveExceptions([clean], cleanTotals, policy, reconcile([clean], cleanTotals))),
    ).toBe(true);
  });

  it("only valid lifecycle transitions are permitted", () => {
    expect(canTransition("working", "submitted")).toBe(true);
    expect(canTransition("submitted", "approved")).toBe(true);
    expect(canTransition("submitted", "working")).toBe(true);
    expect(canTransition("approved", "working")).toBe(false);
    expect(canTransition("approved", "superseded")).toBe(true);
    expect(canTransition("superseded", "approved")).toBe(false);
  });

  it("approved and superseded snapshots are frozen", () => {
    expect(isFrozen("approved")).toBe(true);
    expect(isFrozen("superseded")).toBe(true);
    expect(isFrozen("working")).toBe(false);
  });

  it("the preparer cannot approve their own snapshot", () => {
    expect(violatesSegregation({ prepared_by: "u1", submitted_by: "u1", approver_id: "u1" })).toBe(
      true,
    );
    expect(violatesSegregation({ prepared_by: "u1", submitted_by: "u1", approver_id: "u2" })).toBe(
      false,
    );
  });
});

describe("non-posting sensitivity", () => {
  const obligations = [obligation()];

  it("stresses EAC without mutating the inputs or the base result", () => {
    const snapshot = JSON.parse(JSON.stringify(obligations));
    const res = applySensitivity(obligations, policy, AS_OF, { eac_uplift_pct: 25 });
    expect(obligations).toEqual(snapshot);
    expect(res.base.cumulative_revenue).toBe(500_000);
    expect(res.stressed.cumulative_revenue).toBeLessThan(res.base.cumulative_revenue);
    expect(res.delta.cumulative_revenue).toBe(
      res.stressed.cumulative_revenue - res.base.cumulative_revenue,
    );
  });

  it("an empty scenario is a no-op", () => {
    const res = applySensitivity(obligations, policy, AS_OF, {});
    expect(res.stressed).toEqual(res.base);
  });
});

describe("portfolio roll-up", () => {
  const row = (over: Partial<PortfolioProjectInput> = {}): PortfolioProjectInput => {
    const totals = rollupLines([computeLine(obligation(), policy, AS_OF)]);
    return {
      project_id: "p1",
      project_name: "East Amman",
      customer: "NEPCO",
      currency_code: "USD",
      method: "cost_to_cost",
      status: "approved",
      period_month: "2026-06-01",
      data_date: AS_OF,
      totals,
      ...over,
    };
  };

  it("sums weighted, never averages ratios", () => {
    const rows = [row(), row({ project_id: "p2", project_name: "Zarqa" })];
    const r = rollupPortfolio(rows);
    expect(r.projects).toBe(2);
    expect(r.approved_projects).toBe(2);
    expect(r.revenue).toBe(rows[0]!.totals.cumulative_revenue * 2);
    expect(r.margin_pct).toBeCloseTo(rows[0]!.totals.margin_pct!, 6);
  });

  it("concentration shares sum to 100%", () => {
    const slices = concentrationBy(
      [row(), row({ project_id: "p2", project_name: "Zarqa", customer: "EDCO" })],
      "customer",
    );
    expect(slices).toHaveLength(2);
    expect(slices.reduce((a, s) => a + (s.share_pct ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it("ages WIP into inclusive buckets", () => {
    expect(ageBucket(30)).toBe("d0_30");
    expect(ageBucket(31)).toBe("d31_60");
    expect(ageBucket(91)).toBe("d90_plus");
    const aged = ageWip([{ amount: 100, since: "2026-01-01" }], AS_OF);
    expect(aged.d90_plus).toBe(100);
  });
});

describe("alerts", () => {
  const lossTotals = rollupLines([
    computeLine(obligation({ cost_incurred: 900_000, cost_to_complete: 500_000 }), policy, AS_OF),
  ]);
  const rows: PortfolioProjectInput[] = [
    {
      project_id: "p1",
      project_name: "East Amman",
      customer: "NEPCO",
      currency_code: "USD",
      method: "cost_to_cost",
      status: "working",
      period_month: "2026-01-01",
      data_date: "2026-01-31",
      totals: lossTotals,
    },
  ];

  it("fires evidence-linked alerts and deduplicates by fingerprint", () => {
    const alerts = evaluateRecognitionAlerts(rows, AS_OF);
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map((a) => a.fingerprint)).size).toBe(alerts.length);
    for (const a of alerts) {
      expect(a.evidence_url).toContain("/projects/p1/costing/revenue");
      expect(RECOGNITION_ALERT_RULES).toContain(a.rule_type as never);
    }
    // Re-running over the same rows twice must not double-report.
    const twice = evaluateRecognitionAlerts([...rows, ...rows], AS_OF);
    expect(twice.map((a) => a.fingerprint)).toEqual(alerts.map((a) => a.fingerprint));
  });

  it("fingerprints are stable and slug-safe", () => {
    expect(fingerprint(["Revenue Margin", "P 1"])).toBe("revenue-margin:p-1");
  });

  it("a healthy portfolio raises nothing", () => {
    const healthy = rollupLines([computeLine(obligation(), policy, AS_OF)]);
    expect(
      evaluateRecognitionAlerts(
        [{ ...rows[0]!, status: "approved", data_date: AS_OF, totals: healthy }],
        AS_OF,
      ),
    ).toEqual([]);
  });
});

describe("disclaimer and i18n coverage", () => {
  it("carries a non-posting disclaimer", () => {
    expect(RECOGNITION_DISCLAIMER.length).toBeGreaterThan(20);
  });

  it("portfolio revenue keys exist in both locales with identical shape", () => {
    const en = (portfolioEn as Record<string, any>)["costing"].revenue;
    const ar = (portfolioAr as Record<string, any>)["costing"].revenue;
    const shape = (o: unknown): unknown =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.fromEntries(
            Object.entries(o as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, shape(v)]),
          )
        : typeof o;
    expect(shape(ar)).toEqual(shape(en));
    expect(en.title).toBeTruthy();
    expect(ar.title).not.toBe(en.title);
  });
});
