// GC-10 — Portfolio finance alerts: rule families, boundaries, dedupe,
// lifecycle, summary, CSV and configuration validation.
import { describe, expect, it } from "vitest";

import {
  ALERT_RULE_TYPES,
  ALERT_CSV_HEADER,
  DEFAULT_ALERT_CONFIGS,
  alertConfigUpdateSchema,
  alertFilterSchema,
  ackDueAt,
  buildAlertCsv,
  daysBetween,
  effectiveStatus,
  escalationTier,
  evaluatePortfolioAlerts,
  fingerprintOf,
  isAckOverdue,
  mergeConfigs,
  summarize,
  transitionOnSeen,
  type AlertRecord,
  type AlertRuleConfig,
  type AlertRuleType,
  type EvaluationInput,
} from "@/lib/portfolio-alerts.rules";

const PERIOD = "2026-05-01";
const PERIOD_END = "2026-05-31";
const TODAY = "2026-05-20";

function configs(
  overrides: Partial<Record<AlertRuleType, Partial<AlertRuleConfig>>> = {},
): Record<AlertRuleType, AlertRuleConfig> {
  return mergeConfigs(
    ALERT_RULE_TYPES.map((r) => ({
      ...DEFAULT_ALERT_CONFIGS[r],
      ...(overrides[r] ?? {}),
      rule_type: r,
    })),
  );
}

function projectRow(over: Record<string, unknown> = {}): any {
  return {
    project_id: "11111111-1111-1111-1111-111111111111",
    code: "EAM-001",
    name: "East Amman",
    currency: "JOD",
    basis: "approved",
    version: {
      id: "22222222-2222-2222-2222-222222222222",
      version_no: 3,
      status: "approved",
      approved_at: "2026-05-01T00:00:00.000Z",
    },
    rate: { missing: false, stale: false, as_of: "2026-05-31", source: "frankfurter" },
    ledger_fx_missing: [],
    project: { budget_current: 1000, eac: 500, committed: 400, actual: 200, accruals: 50 },
    variance: { delta_eac_prior: 0, delta_pct_prior: 0, explanation: null },
    close: {
      state: "open",
      ready: true,
      owners: ["33333333-3333-3333-3333-333333333333"],
      checklist_total: 10,
      checklist_done: 10,
      checklist_overdue: 0,
      blockers: [],
    },
    ...over,
  };
}

function input(over: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    period: PERIOD,
    today: TODAY,
    period_end: PERIOD_END,
    reporting_currency: "USD",
    rows: [projectRow()],
    configs: configs(),
    exceptions: [],
    reopened: [],
    audit_gaps: 0,
    ...over,
  };
}

const ruleTypes = (out: { rule_type: string }[]) => out.map((c) => c.rule_type);

describe("alert configuration", () => {
  it("ships a safe default for every rule family", () => {
    // 15 costing/liquidity families + the 13 GC-15 recognition families.
    expect(ALERT_RULE_TYPES).toHaveLength(28);
    for (const r of ALERT_RULE_TYPES) {
      const cfg = DEFAULT_ALERT_CONFIGS[r];
      expect(cfg.enabled).toBe(true);
      expect(cfg.ack_sla_hours).toBeGreaterThan(0);
      expect(cfg.notify_roles.length).toBeGreaterThan(0);
    }
  });

  it("accepts an in-range threshold and rejects an out-of-range one", () => {
    const base = {
      rule_type: "budget_breach" as const,
      enabled: true,
      severity: "high" as const,
      lead_days: 5,
      ack_sla_hours: 24,
      notify_roles: ["finance_admin"],
      escalate_roles: ["company_admin"],
    };
    expect(alertConfigUpdateSchema.safeParse({ ...base, threshold_value: 1 }).success).toBe(true);
    expect(alertConfigUpdateSchema.safeParse({ ...base, threshold_value: 99 }).success).toBe(false);
    expect(alertConfigUpdateSchema.safeParse({ ...base, threshold_value: -1 }).success).toBe(false);
  });

  it("requires a threshold when the default rule has one", () => {
    const res = alertConfigUpdateSchema.safeParse({
      rule_type: "eac_deterioration",
      enabled: true,
      severity: "high",
      threshold_value: null,
      lead_days: 0,
      ack_sla_hours: 24,
      notify_roles: ["finance_admin"],
      escalate_roles: [],
    });
    expect(res.success).toBe(false);
    expect(res.success === false && res.error.issues[0]?.message).toBe("threshold_required");
  });

  it("rejects out-of-bound SLA and lead times and unknown keys", () => {
    const base = {
      rule_type: "audit_gap" as const,
      enabled: true,
      severity: "low" as const,
      threshold_value: 0,
      lead_days: 0,
      notify_roles: ["finance_admin"],
      escalate_roles: [],
    };
    expect(alertConfigUpdateSchema.safeParse({ ...base, ack_sla_hours: 0 }).success).toBe(false);
    expect(alertConfigUpdateSchema.safeParse({ ...base, ack_sla_hours: 721 }).success).toBe(false);
    expect(
      alertConfigUpdateSchema.safeParse({ ...base, ack_sla_hours: 24, lead_days: 91 }).success,
    ).toBe(false);
    expect(
      alertConfigUpdateSchema.safeParse({ ...base, ack_sla_hours: 24, extra: 1 }).success,
    ).toBe(false);
  });

  it("merges stored rows over defaults and pins the unit", () => {
    const merged = mergeConfigs([
      { rule_type: "budget_breach", threshold_value: 0.9, threshold_unit: "days" as never },
      { rule_type: "nonsense" as never },
    ]);
    expect(merged.budget_breach.threshold_value).toBe(0.9);
    expect(merged.budget_breach.threshold_unit).toBe("ratio");
    expect(merged.audit_gap).toEqual(DEFAULT_ALERT_CONFIGS.audit_gap);
  });
});

describe("rule families", () => {
  it("stays silent on a healthy portfolio", () => {
    expect(evaluatePortfolioAlerts(input())).toEqual([]);
  });

  it("flags a missing project FX rate and lists the currencies", () => {
    const out = evaluatePortfolioAlerts(
      input({ rows: [projectRow({ rate: { missing: true, stale: false, as_of: null } })] }),
    );
    expect(ruleTypes(out)).toEqual(["fx_missing"]);
    expect(out[0]!.context["missing_currencies"]).toEqual(["JOD"]);
  });

  it("merges ledger FX gaps into one deduplicated alert", () => {
    const out = evaluatePortfolioAlerts(
      input({
        rows: [
          projectRow({
            rate: { missing: true, stale: false, as_of: null },
            ledger_fx_missing: ["EUR", "JOD"],
          }),
        ],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.context["missing_currencies"]).toEqual(["EUR", "JOD"]);
  });

  it("prefers the missing-rate alert over the stale-rate alert", () => {
    const out = evaluatePortfolioAlerts(
      input({
        rows: [projectRow({ rate: { missing: true, stale: true, as_of: "2026-01-01" } })],
      }),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.context["missing_currencies"]).toBeDefined();
  });

  it("flags a stale rate with its age in days", () => {
    const out = evaluatePortfolioAlerts(
      input({
        rows: [projectRow({ rate: { missing: false, stale: true, as_of: "2026-05-21" } })],
      }),
    );
    expect(ruleTypes(out)).toEqual(["fx_missing"]);
    expect(out[0]!.current_value).toBe(10);
    expect(out[0]!.value_unit).toBe("days");
  });

  it("flags a project with no approved forecast", () => {
    const out = evaluatePortfolioAlerts(
      input({ rows: [projectRow({ basis: "draft", version: null })] }),
    );
    expect(ruleTypes(out)).toContain("forecast_stale");
    expect(out.find((o) => o.rule_type === "forecast_stale")!.fingerprint).toContain("missing");
  });

  it("holds the forecast-age boundary at exactly the limit", () => {
    const at = projectRow({
      version: {
        id: "v",
        version_no: 2,
        status: "approved",
        approved_at: "2026-04-05T00:00:00.000Z", // 45 days before 2026-05-20
      },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [at] })))).toEqual([]);
    const over = projectRow({
      version: { id: "v", version_no: 2, status: "approved", approved_at: "2026-04-04T00:00:00Z" },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [over] })))).toEqual(["forecast_stale"]);
  });

  it("fires EAC deterioration at the threshold, not below it", () => {
    const row = (pct: number) =>
      projectRow({ variance: { delta_eac_prior: 100, delta_pct_prior: pct, explanation: null } });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [row(0.0499)] })))).toEqual([]);
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [row(0.05)] })))).toEqual([
      "eac_deterioration",
    ]);
  });

  it("ignores EAC improvement and projects with no snapshot basis", () => {
    const better = projectRow({
      variance: { delta_eac_prior: -500, delta_pct_prior: -0.4, explanation: null },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [better] })))).toEqual([]);
    const none = projectRow({
      basis: "none",
      version: null,
      variance: { delta_eac_prior: 900, delta_pct_prior: 0.9, explanation: null },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [none] })))).not.toContain(
      "eac_deterioration",
    );
  });

  it("fires budget, commitment and actual breaches independently", () => {
    const row = projectRow({
      project: { budget_current: 1000, eac: 1000, committed: 999, actual: 500, accruals: 500 },
    });
    const out = ruleTypes(evaluatePortfolioAlerts(input({ rows: [row] })));
    expect(out).toContain("budget_breach");
    expect(out).toContain("actual_breach");
    expect(out).toContain("commitment_breach");

    // Just below every configured ratio: nothing fires.
    const quiet = projectRow({
      project: { budget_current: 1000, eac: 100, committed: 100, actual: 50, accruals: 0 },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [quiet] })))).toEqual([]);
  });

  it("cannot divide by a zero or negative budget", () => {
    const row = projectRow({
      project: { budget_current: 0, eac: 100, committed: 100, actual: 100, accruals: 0 },
    });
    const out = ruleTypes(evaluatePortfolioAlerts(input({ rows: [row] })));
    expect(out).not.toContain("budget_breach");
    expect(out).not.toContain("actual_breach");
  });

  it("respects a company-tuned breach threshold", () => {
    const row = projectRow({
      project: { budget_current: 1000, eac: 910, committed: 0, actual: 0, accruals: 0 },
    });
    const tuned = configs({ budget_breach: { threshold_value: 0.9 } });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [row] })))).toEqual([]);
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [row], configs: tuned })))).toEqual([
      "budget_breach",
    ]);
  });

  it("flags overdue close tasks and missing evidence separately", () => {
    const row = projectRow({
      close: {
        ...projectRow().close,
        checklist_overdue: 3,
        blockers: [{ key: "checklist.evidence_missing", count: 2 }],
      },
    });
    const out = ruleTypes(evaluatePortfolioAlerts(input({ rows: [row] })));
    expect(out).toContain("checklist_overdue");
    expect(out).toContain("evidence_missing");
  });

  it("fires close readiness only inside the configured lead window", () => {
    const row = projectRow({
      close: { ...projectRow().close, ready: false, blockers: [{ key: "x", count: 1 }] },
    });
    const lead = DEFAULT_ALERT_CONFIGS.close_readiness.lead_days;
    const inside = daysBetween(TODAY, PERIOD_END) <= lead;
    expect(
      ruleTypes(evaluatePortfolioAlerts(input({ rows: [row] }))).includes("close_readiness"),
    ).toBe(inside);
    const near = evaluatePortfolioAlerts(input({ rows: [row], today: "2026-05-30" }));
    expect(ruleTypes(near)).toContain("close_readiness");
    expect(near.find((a) => a.rule_type === "close_readiness")!.current_value).toBe(1);
  });

  it("does not raise close readiness once the period is closed", () => {
    const row = projectRow({
      close: { ...projectRow().close, ready: false, state: "closed", blockers: [] },
    });
    expect(ruleTypes(evaluatePortfolioAlerts(input({ rows: [row], today: "2026-05-30" })))).toEqual(
      [],
    );
  });

  it("ages open exceptions from the limit day onwards", () => {
    const ex = {
      id: "e1",
      project_id: projectRow().project_id,
      period_month: PERIOD,
      title: "Unmatched accrual",
      severity: "blocker",
      status: "open",
      first_seen_at: "2026-05-13",
      owner_id: null,
    };
    expect(ruleTypes(evaluatePortfolioAlerts(input({ exceptions: [ex] })))).toEqual([
      "exception_aging",
    ]);
    expect(
      ruleTypes(
        evaluatePortfolioAlerts(input({ exceptions: [{ ...ex, first_seen_at: "2026-05-14" }] })),
      ),
    ).toEqual([]);
  });

  it("downgrades non-blocker exception ageing to medium", () => {
    const out = evaluatePortfolioAlerts(
      input({
        exceptions: [
          {
            id: "e2",
            project_id: null,
            period_month: PERIOD,
            title: "Note",
            severity: "warning",
            status: "open",
            first_seen_at: "2026-05-01",
            owner_id: null,
          },
        ],
      }),
    );
    expect(out[0]!.severity).toBe("medium");
  });

  it("raises one alert per reopen event and per audit gap batch", () => {
    const out = evaluatePortfolioAlerts(
      input({
        reopened: [
          { project_id: projectRow().project_id, period_month: PERIOD, at: "2026-05-10T09:00:00Z" },
          { project_id: projectRow().project_id, period_month: PERIOD, at: "2026-05-11T09:00:00Z" },
        ],
        audit_gaps: 4,
      }),
    );
    expect(out.filter((a) => a.rule_type === "period_reopened")).toHaveLength(2);
    expect(out.filter((a) => a.rule_type === "audit_gap")).toHaveLength(1);
  });

  it("holds the audit-gap threshold at zero", () => {
    expect(ruleTypes(evaluatePortfolioAlerts(input({ audit_gaps: 0 })))).toEqual([]);
    expect(ruleTypes(evaluatePortfolioAlerts(input({ audit_gaps: 1 })))).toEqual(["audit_gap"]);
  });

  it("honours a disabled rule", () => {
    const off = configs({ fx_missing: { enabled: false } });
    const rows = [projectRow({ rate: { missing: true, stale: false, as_of: null } })];
    expect(evaluatePortfolioAlerts(input({ rows, configs: off }))).toEqual([]);
  });

  it("is deterministic and severity-ordered for identical input", () => {
    const rows = [
      projectRow({ rate: { missing: true, stale: false, as_of: null } }),
      projectRow({
        project_id: "44444444-4444-4444-4444-444444444444",
        code: "EAM-002",
        project: { budget_current: 100, eac: 200, committed: 0, actual: 0, accruals: 0 },
      }),
    ];
    const a = evaluatePortfolioAlerts(input({ rows }));
    const b = evaluatePortfolioAlerts(input({ rows }));
    expect(a).toEqual(b);
    expect(a.map((x) => x.severity)).toEqual([...a.map((x) => x.severity)].sort());
    expect(new Set(a.map((x) => x.fingerprint)).size).toBe(a.length);
  });

  it("emits a deep link for every candidate", () => {
    const rows = [
      projectRow({ rate: { missing: true, stale: false, as_of: null } }),
      projectRow({
        project_id: "55555555-5555-5555-5555-555555555555",
        basis: "none",
        version: null,
      }),
    ];
    for (const c of evaluatePortfolioAlerts(input({ rows, audit_gaps: 2 }))) {
      expect(c.deep_link.startsWith("/")).toBe(true);
    }
  });
});

describe("fingerprint dedupe", () => {
  it("is stable across evaluations and distinct per scope", () => {
    const a = fingerprintOf({ rule_type: "budget_breach", project_id: "p1", period_month: PERIOD });
    const b = fingerprintOf({ rule_type: "budget_breach", project_id: "p1", period_month: PERIOD });
    const c = fingerprintOf({ rule_type: "budget_breach", project_id: "p2", period_month: PERIOD });
    const d = fingerprintOf({
      rule_type: "budget_breach",
      project_id: "p1",
      period_month: "2026-06-01",
    });
    expect(a).toBe(b);
    expect(new Set([a, c, d]).size).toBe(3);
  });

  it("changes when the FX gap currencies change", () => {
    const one = evaluatePortfolioAlerts(
      input({ rows: [projectRow({ ledger_fx_missing: ["EUR"] })] }),
    )[0]!.fingerprint;
    const two = evaluatePortfolioAlerts(
      input({ rows: [projectRow({ ledger_fx_missing: ["EUR", "GBP"] })] }),
    )[0]!.fingerprint;
    expect(one).not.toBe(two);
  });
});

const record = (over: Partial<AlertRecord> = {}): AlertRecord =>
  ({
    id: "a1",
    company_id: "c1",
    project_id: "p1",
    period_month: PERIOD,
    rule_type: "budget_breach",
    fingerprint: "f1",
    severity: "high",
    status: "open",
    escalation_tier: 0,
    entity_table: null,
    entity_id: null,
    current_value: 1.2,
    threshold_value: 1,
    value_unit: "ratio",
    currency_code: "JOD",
    owner_id: null,
    title: "Budget breach",
    detail: "d",
    deep_link: "/portfolio/costing",
    context: {},
    first_seen_at: "2026-05-01T00:00:00.000Z",
    last_seen_at: "2026-05-01T00:00:00.000Z",
    occurrence_count: 1,
    reopen_count: 0,
    ack_due_at: "2026-05-03T00:00:00.000Z",
    acknowledged_by: null,
    acknowledged_at: null,
    snoozed_until: null,
    escalated_at: null,
    resolved_at: null,
    ...over,
  }) as AlertRecord;

describe("lifecycle", () => {
  const now = "2026-05-20T00:00:00.000Z";

  it("counts a re-seen open alert as one occurrence, not a new row", () => {
    const t = transitionOnSeen(record({ occurrence_count: 4 }), now);
    expect(t).toEqual({ status: "open", occurrence_count: 5, reopen_count: 0, reopened: false });
  });

  it("reopens a resolved alert and preserves its history", () => {
    const t = transitionOnSeen(record({ status: "resolved", reopen_count: 1 }), now);
    expect(t.reopened).toBe(true);
    expect(t.status).toBe("open");
    expect(t.reopen_count).toBe(2);
  });

  it("keeps an acknowledged alert acknowledged when the condition persists", () => {
    expect(transitionOnSeen(record({ status: "acknowledged" }), now).status).toBe("acknowledged");
  });

  it("treats an expired snooze as open again", () => {
    const expired = record({ status: "snoozed", snoozed_until: "2026-05-10T00:00:00.000Z" });
    const live = record({ status: "snoozed", snoozed_until: "2026-06-10T00:00:00.000Z" });
    expect(effectiveStatus(expired, now)).toBe("open");
    expect(effectiveStatus(live, now)).toBe("snoozed");
    expect(transitionOnSeen(live, now).status).toBe("snoozed");
  });

  it("computes the acknowledgement deadline from the SLA", () => {
    expect(ackDueAt("2026-05-01T00:00:00.000Z", 48)).toBe("2026-05-03T00:00:00.000Z");
  });

  it("marks only open alerts past their deadline as overdue", () => {
    expect(isAckOverdue({ status: "open", ack_due_at: "2026-05-19T00:00:00Z" }, now)).toBe(true);
    expect(isAckOverdue({ status: "open", ack_due_at: "2026-05-21T00:00:00Z" }, now)).toBe(false);
    expect(isAckOverdue({ status: "acknowledged", ack_due_at: "2026-01-01T00:00:00Z" }, now)).toBe(
      false,
    );
  });

  it("escalates one tier per SLA period and caps at three", () => {
    const at = (due: string) => escalationTier({ status: "open", ack_due_at: due }, now, 24);
    expect(at("2026-05-21T00:00:00.000Z")).toBe(0);
    expect(at("2026-05-19T12:00:00.000Z")).toBe(1);
    expect(at("2026-05-18T12:00:00.000Z")).toBe(2);
    expect(at("2026-05-01T00:00:00.000Z")).toBe(3);
  });
});

describe("summary, filters and CSV", () => {
  const now = "2026-05-20T00:00:00.000Z";

  it("summarises by effective status and severity", () => {
    const s = summarize(
      [
        record({ id: "1", severity: "critical", ack_due_at: "2026-05-01T00:00:00Z" }),
        record({ id: "2", status: "acknowledged", severity: "high", project_id: "p2" }),
        record({
          id: "3",
          status: "snoozed",
          snoozed_until: "2026-05-01T00:00:00.000Z",
          severity: "low",
        }),
        record({ id: "4", status: "resolved", resolved_at: "2026-05-19T00:00:00.000Z" }),
        record({ id: "5", status: "resolved", resolved_at: "2026-01-01T00:00:00.000Z" }),
      ],
      now,
      "2026-05-13T00:00:00.000Z",
    );
    expect(s.open).toBe(2); // one open + one expired snooze
    expect(s.acknowledged).toBe(1);
    expect(s.snoozed).toBe(0);
    expect(s.by_severity.critical).toBe(1);
    // An expired snooze is open again, so its blown deadline counts too.
    expect(s.ack_overdue).toBe(2);
    expect(s.resolved_recent).toBe(1);
    expect(s.projects_affected).toBe(2);
    expect(s.oldest_age_days).toBe(19);
  });

  it("normalises filters and rejects invalid pagination", () => {
    const f = alertFilterSchema.parse({});
    expect(f).toEqual({ page: 1, page_size: 50 });
    expect(alertFilterSchema.safeParse({ page_size: 33 }).success).toBe(false);
    expect(alertFilterSchema.safeParse({ period: "2026-05" }).success).toBe(false);
    expect(alertFilterSchema.safeParse({ project_id: "not-a-uuid" }).success).toBe(false);
    expect(alertFilterSchema.safeParse({ nope: true }).success).toBe(false);
  });

  it("exports a deterministic CSV with a fixed header and escaped cells", () => {
    const csv = buildAlertCsv([
      { ...record({ title: 'Breach, "urgent"' }), project_code: "EAM-001" },
    ]);
    const [header, row] = csv.split("\n");
    expect(header).toBe(ALERT_CSV_HEADER.join(","));
    expect(row).toContain('"Breach, ""urgent"""');
    expect(buildAlertCsv([{ ...record(), project_code: null }])).toBe(
      buildAlertCsv([{ ...record(), project_code: null }]),
    );
  });
});

// ---------------------------------------------------------------------------
// GC-13 — liquidity families
// ---------------------------------------------------------------------------
function liq(over: Record<string, unknown> = {}): any {
  return {
    project_id: "11111111-1111-1111-1111-111111111111",
    code: "EAM-001",
    snapshot_id: "44444444-4444-4444-4444-444444444444",
    currency_code: "USD",
    first_shortfall_bucket: null,
    minimum_liquidity: 1000,
    unfunded_requirement: 0,
    utilization_pct: 10,
    breached_covenants: [],
    ...over,
  };
}

describe("liquidity alert families", () => {
  it("stays quiet on a funded, positive position", () => {
    expect(ruleTypes(evaluatePortfolioAlerts(input({ liquidity: [liq()] })))).toEqual([]);
  });

  it("raises a cash shortfall when closing cash turns negative", () => {
    const out = evaluatePortfolioAlerts(
      input({
        liquidity: [liq({ first_shortfall_bucket: "2026-07-01", minimum_liquidity: -500 })],
      }),
    );
    const hit = out.find((c) => c.rule_type === "liquidity_shortfall")!;
    expect(hit.severity).toBe("critical");
    expect(hit.current_value).toBe(-500);
    expect(hit.entity_table).toBe("cashflow_snapshots");
    expect(hit.deep_link).toContain("/costing/cash-flow");
  });

  it("escalates an unfunded requirement above a headroom warning", () => {
    const out = evaluatePortfolioAlerts(input({ liquidity: [liq({ unfunded_requirement: 250 })] }));
    const hit = out.find((c) => c.rule_type === "funding_headroom")!;
    expect(hit.severity).toBe("critical");
    expect(hit.context["unfunded_requirement"]).toBe(250);
  });

  it("warns at the utilisation threshold and not below it", () => {
    expect(
      ruleTypes(evaluatePortfolioAlerts(input({ liquidity: [liq({ utilization_pct: 89.9 })] }))),
    ).toEqual([]);
    expect(
      ruleTypes(evaluatePortfolioAlerts(input({ liquidity: [liq({ utilization_pct: 90 })] }))),
    ).toEqual(["funding_headroom"]);
  });

  it("reports covenant breaches with a stable fingerprint per breach set", () => {
    const rows = [
      liq({
        breached_covenants: [
          { facility_id: "f2", code: "DSCR" },
          { facility_id: "f1", code: "GEARING" },
        ],
      }),
    ];
    const a = evaluatePortfolioAlerts(input({ liquidity: rows }));
    const b = evaluatePortfolioAlerts(input({ liquidity: rows }));
    const hit = a.find((c) => c.rule_type === "covenant_breach")!;
    expect(hit.current_value).toBe(2);
    expect(hit.fingerprint).toBe(b.find((c) => c.rule_type === "covenant_breach")!.fingerprint);
  });

  it("dedupes to one occurrence per project and family across re-evaluations", () => {
    const rows = [liq({ first_shortfall_bucket: "2026-07-01", unfunded_requirement: 100 })];
    const first = evaluatePortfolioAlerts(input({ liquidity: rows }));
    const second = evaluatePortfolioAlerts(input({ liquidity: rows }));
    expect(first.map((c) => c.fingerprint)).toEqual(second.map((c) => c.fingerprint));
    expect(new Set(first.map((c) => c.fingerprint)).size).toBe(first.length);
  });

  it("honours the disabled switch for every liquidity family", () => {
    const off = configs({
      liquidity_shortfall: { enabled: false },
      funding_headroom: { enabled: false },
      covenant_breach: { enabled: false },
    });
    const out = evaluatePortfolioAlerts(
      input({
        configs: off,
        liquidity: [
          liq({
            first_shortfall_bucket: "2026-07-01",
            unfunded_requirement: 100,
            breached_covenants: [{ facility_id: "f1", code: "DSCR" }],
          }),
        ],
      }),
    );
    expect(ruleTypes(out)).toEqual([]);
  });
});
