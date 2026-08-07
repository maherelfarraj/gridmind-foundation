// GC-15 verification — recognition alert persistence semantics (fingerprint
// stability, deduplication, config gating, escalation inputs) and the saved
// views that scope the portfolio revenue & WIP dashboard.
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ALERT_CONFIGS,
  RECOGNITION_ALERT_PREFIX,
  recognitionAlertCandidates,
} from "@/lib/portfolio-alerts.rules";
import {
  DEFAULT_SAVED_VIEW_CONFIG,
  parseSavedViewConfig,
  revenueWipConfigToSearch,
  revenueWipSearchToConfig,
  savedViewConfigSchema,
  viewsInScope,
  type SavedView,
} from "@/lib/portfolio-views.rules";
import {
  DEFAULT_ALERT_THRESHOLDS,
  evaluateRecognitionAlerts,
  fingerprint,
  RECOGNITION_ALERT_RULES,
  type PortfolioProjectInput,
  type RecognitionTotals,
} from "@/lib/recognition.rules";

const P1 = "aaaaaaaa-1111-4111-8111-111111111111";
const P2 = "bbbbbbbb-2222-4222-8222-222222222222";

const totals = (over: Partial<RecognitionTotals> = {}): RecognitionTotals =>
  ({
    transaction_price: 1_000_000,
    approved_variations: 0,
    constrained_consideration: 0,
    cost_incurred: 500_000,
    cost_to_complete: 500_000,
    eac: 1_000_000,
    progress_pct: 50,
    cumulative_revenue: 500_000,
    prior_revenue: 400_000,
    period_revenue: 100_000,
    gross_profit: 0,
    margin_pct: 20,
    loss_provision: 0,
    billed_to_date: 500_000,
    cash_received: 400_000,
    contract_asset: 0,
    contract_liability: 0,
    retention_receivable: 0,
    advance_balance: 0,
    unbilled_receivable: 0,
    remaining_revenue: 500_000,
    cumulative_revenue_reporting: 500_000,
    period_revenue_reporting: 100_000,
    contract_asset_reporting: 0,
    contract_liability_reporting: 0,
    ...over,
  }) as RecognitionTotals;

const row = (over: Partial<PortfolioProjectInput> = {}): PortfolioProjectInput => ({
  project_id: P1,
  project_name: "East Amman",
  customer: "NEPCO",
  currency_code: "USD",
  method: "cost_to_cost",
  status: "approved",
  period_month: "2026-06-01",
  data_date: "2026-06-30",
  totals: totals(),
  fx_missing: false,
  reconciliation_ok: true,
  pending_adjustments: 0,
  last_billing_date: "2026-06-20",
  retention_due_date: null,
  submitted_at: null,
  ...over,
});

const AS_OF = "2026-07-05";

describe("recognition alert evaluation", () => {
  it("is deterministic and byte-identical across repeated runs", () => {
    const rows = [row(), row({ project_id: P2, project_name: "Zarqa", fx_missing: true })];
    const a = evaluateRecognitionAlerts(rows, AS_OF);
    const b = evaluateRecognitionAlerts(rows, AS_OF);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits stable fingerprints keyed on family, project and period", () => {
    const alerts = evaluateRecognitionAlerts([row({ fx_missing: true })], AS_OF);
    const fx = alerts.find((a) => a.rule_type === "recognition_fx_missing");
    expect(fx?.fingerprint).toBe(fingerprint(["fx", P1, "2026-06-01"]));
    // A later evaluation of the SAME condition reuses the fingerprint, so the
    // register updates one row instead of creating duplicates.
    const later = evaluateRecognitionAlerts([row({ fx_missing: true })], "2026-08-09");
    expect(later.find((a) => a.rule_type === "recognition_fx_missing")?.fingerprint).toBe(
      fx?.fingerprint,
    );
  });

  it("deduplicates identical findings within one evaluation", () => {
    const dupes = [row({ fx_missing: true }), row({ fx_missing: true })];
    const alerts = evaluateRecognitionAlerts(dupes, AS_OF);
    const prints = alerts.map((a) => a.fingerprint);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it("raises each governance family from its own condition", () => {
    const alerts = evaluateRecognitionAlerts(
      [
        row({
          totals: totals({
            margin_pct: -3,
            loss_provision: 25_000,
            contract_asset: 300_000,
            contract_liability: 400_000,
            constrained_consideration: 250_000,
            period_revenue: -120_000,
            retention_receivable: 90_000,
          }),
          data_date: "2026-01-31",
          fx_missing: true,
          reconciliation_ok: false,
          pending_adjustments: 2,
          last_billing_date: "2026-01-05",
          retention_due_date: "2026-05-01",
          status: "submitted",
          submitted_at: "2026-06-01T00:00:00.000Z",
        }),
      ],
      AS_OF,
    );
    const families = new Set(alerts.map((a) => a.rule_type));
    for (const rule of RECOGNITION_ALERT_RULES) expect(families).toContain(rule);
    expect(alerts.filter((a) => a.severity === "critical").length).toBeGreaterThan(0);
  });

  it("stays silent for a healthy, current, reconciled snapshot", () => {
    expect(evaluateRecognitionAlerts([row()], "2026-07-01")).toEqual([]);
  });

  it("honours configured thresholds instead of hardcoded floors", () => {
    const soft = evaluateRecognitionAlerts([row({ totals: totals({ margin_pct: 4 }) })], AS_OF, {
      ...DEFAULT_ALERT_THRESHOLDS,
      margin_floor_pct: 1,
    });
    expect(soft.some((a) => a.rule_type === "revenue_margin_erosion")).toBe(false);
    const strict = evaluateRecognitionAlerts([row({ totals: totals({ margin_pct: 4 }) })], AS_OF);
    expect(strict.some((a) => a.rule_type === "revenue_margin_erosion")).toBe(true);
  });
});

describe("recognition alert candidates (register bridge)", () => {
  const configs = DEFAULT_ALERT_CONFIGS;

  it("namespaces fingerprints so recognition never collides with costing families", () => {
    const candidates = recognitionAlertCandidates({
      rows: [row({ fx_missing: true })],
      asOf: AS_OF,
      configs,
    });
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.fingerprint.startsWith(`${RECOGNITION_ALERT_PREFIX}:`)).toBe(true);
      expect(c.entity_table).toBe("recognition_snapshots");
      expect(c.project_id).toBe(P1);
      expect(c.period_month).toBe("2026-06-01");
      expect(c.currency_code).toBe("USD");
      expect(c.deep_link).toBe(`/projects/${P1}/costing/revenue`);
    }
    expect(new Set(candidates.map((c) => c.fingerprint)).size).toBe(candidates.length);
  });

  it("suppresses a family when its rule config is disabled", () => {
    const disabled = {
      ...configs,
      recognition_fx_missing: { ...configs.recognition_fx_missing, enabled: false },
    };
    const candidates = recognitionAlertCandidates({
      rows: [row({ fx_missing: true })],
      asOf: AS_OF,
      configs: disabled,
    });
    expect(candidates.some((c) => c.rule_type === "recognition_fx_missing")).toBe(false);
  });

  it("carries configured severity and the SLA that drives escalation", () => {
    const candidates = recognitionAlertCandidates({
      rows: [row({ reconciliation_ok: false })],
      asOf: AS_OF,
      configs,
    });
    const rec = candidates.find((c) => c.rule_type === "recognition_reconciliation_failed");
    expect(rec?.severity).toBe(configs.recognition_reconciliation_failed.severity);
    expect(configs.recognition_reconciliation_failed.ack_sla_hours).toBeGreaterThan(0);
  });
});

describe("revenue & WIP saved views", () => {
  const view = (over: Partial<SavedView> = {}): SavedView =>
    ({
      id: "cccccccc-3333-4333-8333-333333333333",
      company_id: "dddddddd-4444-4444-8444-444444444444",
      name: "Q2 revenue",
      config: savedViewConfigSchema.parse({ scope: "revenue_wip" }),
      is_shared: true,
      created_by: "eeeeeeee-5555-4555-8555-555555555555",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: "2026-07-01T00:00:00.000Z",
      ...over,
    }) as SavedView;

  it("round-trips revenue filters without leaking computed balances", () => {
    const search = {
      period: "2026-06-01",
      status: "approved",
      method: "cost_to_cost",
      customer: "NEPCO",
      project: "East Amman",
    };
    const config = revenueWipSearchToConfig(search);
    expect(config.scope).toBe("revenue_wip");
    expect(revenueWipConfigToSearch(config)).toEqual(search);
    expect(Object.keys(config)).not.toContain("totals");
  });

  it("drops empty filters instead of persisting blank strings", () => {
    const config = revenueWipSearchToConfig({});
    expect(revenueWipConfigToSearch(config)).toEqual({});
    expect(config.rec_status).toBeNull();
  });

  it("defaults legacy configs to the costing scope and rejects unknown keys", () => {
    expect(DEFAULT_SAVED_VIEW_CONFIG.scope).toBe("costing");
    expect(parseSavedViewConfig({ period: "2026-06-01" }).scope).toBe("costing");
    expect(savedViewConfigSchema.safeParse({ scope: "revenue_wip", bogus: 1 }).success).toBe(false);
    expect(savedViewConfigSchema.safeParse({ scope: "nope" }).success).toBe(false);
    // Corrupt persisted payloads degrade to defaults, never throw.
    expect(parseSavedViewConfig("not-an-object")).toEqual(DEFAULT_SAVED_VIEW_CONFIG);
  });

  it("shows each dashboard only its own scope", () => {
    const views = [
      view(),
      view({ id: "ffffffff-6666-4666-8666-666666666666", config: DEFAULT_SAVED_VIEW_CONFIG }),
    ];
    expect(viewsInScope(views, "revenue_wip")).toHaveLength(1);
    expect(viewsInScope(views, "costing")).toHaveLength(1);
    expect(viewsInScope(views, "revenue_wip")[0]?.config.scope).toBe("revenue_wip");
  });
});
