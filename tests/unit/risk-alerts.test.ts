// GC-17 — alert lifecycle & family coverage (deterministic, pure core only).
import { describe, expect, it } from "vitest";

import {
  ALERT_FAMILIES,
  alertDedupeKey,
  canTransitionAlert,
  evaluateAlerts,
  type AlertEvaluationInput,
  type AlertFamily,
} from "@/lib/risk-sim.rules";

const NOW = new Date("2026-03-01T00:00:00.000Z");

function baseInput(): AlertEvaluationInput {
  return {
    project_id: "p1",
    adequacy: { band: "adequate", cover_p80: 1.5, shortfall_p80: 0 } as AlertEvaluationInput["adequacy"],
    sim: {
      ran_at: "2026-02-25T00:00:00.000Z",
      prob_exceeds_budget: 0.01,
      prob_exceeds_finish: 0.01,
      converged: true,
      top_contributor: null,
      top_contributor_id: null,
    },
    burn: { per_day: 100, spike: false },
    unlinked_drawdowns: 0,
    overdue_mitigations: 0,
    input_problems: 0,
    missing_fx: 0,
    reserve_expiring: 0,
    escalated_risks: [],
    funding_gap: 0,
    sod_exceptions: [],
    now: NOW,
  };
}

/** One triggering mutation per family — every family must have a producer. */
const TRIGGERS: Record<AlertFamily, (i: AlertEvaluationInput) => void> = {
  high_exposure: (i) => {
    i.adequacy = { band: "watch", cover_p80: 1.02, shortfall_p80: 0 } as typeof i.adequacy;
  },
  contingency_inadequacy: (i) => {
    i.adequacy = { band: "inadequate", cover_p80: 0.5, shortfall_p80: 5000 } as typeof i.adequacy;
  },
  probability_impact_increase: (i) => {
    i.escalated_risks = [{ risk_id: "r1", title: "Cable delay" }];
  },
  new_top_contributor: (i) => {
    i.sim.top_contributor = "Cable delay";
    i.sim.top_contributor_id = "r1";
  },
  p80_budget_breach: (i) => {
    i.sim.prob_exceeds_budget = 0.44;
  },
  p90_schedule_breach: (i) => {
    i.sim.prob_exceeds_finish = 0.5;
  },
  burn_rate_spike: (i) => {
    i.burn = { per_day: 900, spike: true };
  },
  unlinked_drawdown: (i) => {
    i.unlinked_drawdowns = 3;
  },
  overdue_mitigation: (i) => {
    i.overdue_mitigations = 2;
  },
  stale_simulation: (i) => {
    i.sim.ran_at = null;
  },
  input_quality: (i) => {
    i.sim.converged = false;
  },
  fx_materiality: (i) => {
    i.missing_fx = 1;
  },
  double_count: (i) => {
    i.input_problems = 4;
  },
  funding_mismatch: (i) => {
    i.funding_gap = 250_000;
  },
  reserve_expiry: (i) => {
    i.reserve_expiring = 1;
  },
  sod_exception: (i) => {
    i.sod_exceptions = [{ run_id: "run-1" }];
  },
};

describe("GC-17 alert families", () => {
  it("declares 16 governed families", () => {
    expect(ALERT_FAMILIES).toHaveLength(16);
    expect(new Set(ALERT_FAMILIES).size).toBe(16);
  });

  it("produces no alerts for a healthy project", () => {
    expect(evaluateAlerts(baseInput())).toEqual([]);
  });

  for (const family of ALERT_FAMILIES) {
    it(`produces ${family} when its condition holds and not otherwise`, () => {
      const input = baseInput();
      TRIGGERS[family](input);
      const produced = evaluateAlerts(input).map((a) => a.family);
      expect(produced).toContain(family);
      expect(evaluateAlerts(baseInput()).map((a) => a.family)).not.toContain(family);
    });
  }

  it("is deterministic across repeated evaluation", () => {
    const input = baseInput();
    for (const family of ALERT_FAMILIES) TRIGGERS[family](input);
    const a = JSON.stringify(evaluateAlerts(input));
    const b = JSON.stringify(evaluateAlerts(input));
    expect(a).toBe(b);
  });

  it("emits every family at once with unique de-duplication keys", () => {
    const input = baseInput();
    for (const family of ALERT_FAMILIES) TRIGGERS[family](input);
    const alerts = evaluateAlerts(input);
    const families = new Set(alerts.map((a) => a.family));
    for (const family of ALERT_FAMILIES) expect(families).toContain(family);
    const keys = alerts.map((a) => alertDedupeKey(a.family, a.project_id, a.subject));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toMatch(/^gc17:/);
  });

  it("keeps de-duplication keys stable for the same subject", () => {
    expect(alertDedupeKey("fx_materiality", "p1", "fx")).toBe(
      alertDedupeKey("fx_materiality", "p1", "fx"),
    );
    expect(alertDedupeKey("fx_materiality", null, "fx")).toContain("portfolio");
  });
});

describe("GC-17 alert lifecycle transitions", () => {
  it("allows the governed transitions only", () => {
    expect(canTransitionAlert("open", "acknowledged")).toBe(true);
    expect(canTransitionAlert("open", "snoozed")).toBe(true);
    expect(canTransitionAlert("acknowledged", "resolved")).toBe(true);
    expect(canTransitionAlert("snoozed", "open")).toBe(true);
    expect(canTransitionAlert("resolved", "open")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionAlert("open", "open")).toBe(false);
    expect(canTransitionAlert("acknowledged", "open")).toBe(false);
    expect(canTransitionAlert("resolved", "acknowledged")).toBe(false);
    expect(canTransitionAlert("resolved", "snoozed")).toBe(false);
  });
});
