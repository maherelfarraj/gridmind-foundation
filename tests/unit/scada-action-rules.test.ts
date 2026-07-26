// P-176 — SCADA→O&M action rule matching + governance floor.
import { describe, expect, it } from "vitest";

import {
  actionRequiresApproval,
  isContractualAction,
  planEventActions,
  ruleMatchesEvent,
  type ActionRule,
  type MatchableEvent,
} from "@/lib/scada/action-rules";

const event: MatchableEvent = {
  id: "e1",
  company_id: "c1",
  project_id: "p1",
  event_type: "trip",
  severity: "major",
  code: "INV-27",
  message: "Inverter 3 tripped on DC overvoltage",
  source: "scada",
  asset_node_id: "a1",
  payload: { inverter: "INV-03" },
};

function rule(overrides: Partial<ActionRule> = {}): ActionRule {
  return {
    id: "r1",
    company_id: "c1",
    project_id: null,
    name: "Trip → WO",
    event_type: "trip",
    min_severity: "minor",
    match: {},
    action_type: "create_work_order",
    action_config: {},
    requires_approval: false,
    approval_rule_key: "scada_event_action",
    ai_assist: false,
    enabled: true,
    ...overrides,
  };
}

describe("ruleMatchesEvent", () => {
  it("matches on event type and severity floor", () => {
    expect(ruleMatchesEvent(rule(), event)).toBe(true);
    expect(ruleMatchesEvent(rule({ min_severity: "critical" }), event)).toBe(false);
  });

  it("ignores disabled rules and other event types", () => {
    expect(ruleMatchesEvent(rule({ enabled: false }), event)).toBe(false);
    expect(ruleMatchesEvent(rule({ event_type: "alarm" }), event)).toBe(false);
  });

  it("scopes by project when the rule is project-bound", () => {
    expect(ruleMatchesEvent(rule({ project_id: "p1" }), event)).toBe(true);
    expect(ruleMatchesEvent(rule({ project_id: "p2" }), event)).toBe(false);
  });

  it("applies match filters", () => {
    expect(ruleMatchesEvent(rule({ match: { code_in: ["INV-27"] } }), event)).toBe(true);
    expect(ruleMatchesEvent(rule({ match: { code_in: ["INV-99"] } }), event)).toBe(false);
    expect(ruleMatchesEvent(rule({ match: { message_contains: "overvoltage" } }), event)).toBe(true);
    expect(ruleMatchesEvent(rule({ match: { source_in: ["operator"] } }), event)).toBe(false);
    expect(ruleMatchesEvent(rule({ match: { asset_node_ids: ["a1"] } }), event)).toBe(true);
    expect(
      ruleMatchesEvent(rule({ match: { payload_equals: { inverter: "INV-03" } } }), event),
    ).toBe(true);
    expect(
      ruleMatchesEvent(rule({ match: { payload_equals: { inverter: "INV-04" } } }), event),
    ).toBe(false);
  });
});

describe("governance floor", () => {
  it("treats contractual and safety-critical actions as always approval-gated", () => {
    expect(isContractualAction("warranty_claim")).toBe(true);
    expect(isContractualAction("hse_escalation")).toBe(true);
    expect(isContractualAction("create_work_order")).toBe(false);
  });

  it("cannot be disabled by requires_approval=false", () => {
    expect(actionRequiresApproval("warranty_claim", false)).toBe(true);
    expect(actionRequiresApproval("hse_escalation", false)).toBe(true);
    expect(actionRequiresApproval("create_work_order", false)).toBe(false);
    expect(actionRequiresApproval("create_work_order", true)).toBe(true);
  });

  it("plans one action per matching rule with the floor applied", () => {
    const plans = planEventActions(
      [
        rule(),
        rule({ id: "r2", action_type: "warranty_claim", requires_approval: false }),
        rule({ id: "r3", enabled: false }),
      ],
      event,
    );
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ ruleId: "r1", requiresApproval: false });
    expect(plans[1]).toMatchObject({ ruleId: "r2", requiresApproval: true });
  });
});
