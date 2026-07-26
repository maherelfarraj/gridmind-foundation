// P-176 — SCADA→O&M action rule matching + governance floor.
import { describe, expect, it } from "vitest";

import {
  actionRequiresApproval,
  isContractualAction,
  planEventActions,
  ruleMatchesEvent,
  type MatchableRule,
  type MatchableEvent,
} from "@/lib/scada/action-rules";

const event: MatchableEvent = {
  project_id: "p1",
  event_type: "trip",
  severity: "major",
  code: "INV-27",
  message: "Inverter 3 tripped on DC overvoltage",
  source: "scada",
  asset_node_id: "3f1b1c9e-2f7a-4f9c-9b2a-0f1d5a6c7e88",
  payload: { inverter: "INV-03" },
};

function rule(overrides: Partial<MatchableRule> = {}): MatchableRule {
  return {
    id: "r1",
    project_id: null,
    event_type: "trip",
    min_severity: "warning",
    match: {},
    action_type: "create_work_order",
    action_config: {},
    requires_approval: false,
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
    expect(ruleMatchesEvent(rule({ match: { message_contains: "overvoltage" } }), event)).toBe(
      true,
    );
    expect(ruleMatchesEvent(rule({ match: { source_in: ["operator"] } }), event)).toBe(false);
    expect(
      ruleMatchesEvent(
        rule({ match: { asset_node_ids: ["3f1b1c9e-2f7a-4f9c-9b2a-0f1d5a6c7e88"] } }),
        event,
      ),
    ).toBe(true);
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
    expect(plans[0]).toMatchObject({ rule_id: "r1", requires_approval: false });
    expect(plans[1]).toMatchObject({ rule_id: "r2", requires_approval: true });
  });
});

/* ------------------------------------------------------------------ */
/* P-178 — engine routing against a mocked Supabase client              */
/* ------------------------------------------------------------------ */

import { beforeEach, vi } from "vitest";

import { createFakeSupabase, type FakeSupabase } from "../helpers/fake-supabase";
import {
  evaluateEventActions,
  executeEventAction,
  settleEventActionsForInstance,
  type Db,
  type EngineEvent,
} from "@/lib/scada-actions.server";
import type { AuthContext } from "@/integrations/supabase/auth-attacher";

const COMPANY = "co-1";
const PROJECT = "p1";

const engineEvent: EngineEvent = {
  id: "ev-1",
  company_id: COMPANY,
  project_id: PROJECT,
  ...event,
};

function dbRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    company_id: COMPANY,
    project_id: null,
    event_type: "trip",
    min_severity: "warning",
    match: {},
    action_type: "create_work_order",
    action_config: {},
    requires_approval: false,
    approval_rule_key: "scada_event_action",
    ai_assist: false,
    enabled: true,
    name: "Trip → WO",
    ...overrides,
  };
}

function fake(rules: Record<string, unknown>[], extra: Record<string, unknown[]> = {}) {
  return createFakeSupabase({
    event_action_rules: rules as never,
    event_action_log: [],
    work_orders: [],
    warranty_claims: [],
    warranties: [{ id: "w1", company_id: COMPANY }],
    scada_events: [
      {
        id: "ev-1",
        message: engineEvent.message,
        severity: engineEvent.severity,
        code: engineEvent.code,
        scada_asset_id: null,
        asset_node_id: null,
        occurred_at: "2026-03-01T00:00:00.000Z",
      },
    ],
    equipment_registry: [],
    approval_instances: [],
    ...(extra as never),
  });
}

function authFor(client: FakeSupabase): AuthContext {
  return {
    supabase: client as never,
    user: { id: "user-1" } as never,
  } as unknown as AuthContext;
}

describe("P-178 engine routing (mocked RPC)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) executes an operational action immediately and links the result entity", async () => {
    const client = fake([dbRule()]);
    const result = await evaluateEventActions({ db: client as unknown as Db }, engineEvent);

    expect(result.matched).toBe(1);
    expect(result.executed).toBe(1);
    expect(result.pendingApproval).toBe(0);
    const log = client.db.event_action_log[0];
    expect(log.status).toBe("executed");
    expect(log.result_entity).toBe("work_orders");
    expect(client.db.work_orders).toHaveLength(1);
  });

  it("(b) contractual hard floor: warranty_claim with requires_approval=false still routes to approval", async () => {
    const client = fake([
      dbRule({ id: "r2", action_type: "warranty_claim", requires_approval: false }),
    ]);
    const auth = authFor(client);

    const result = await evaluateEventActions(
      { db: client as unknown as Db, auth },
      engineEvent,
    );

    expect(result.pendingApproval).toBe(1);
    expect(result.executed).toBe(0);
    const log = client.db.event_action_log[0];
    expect(log.status).toBe("pending_approval");
    expect(client.rpcCalls.map((c) => c.name)).toContain("start_approval_instance");
    expect(client.rpcCalls.map((c) => c.name)).not.toContain("decide_approval");
    expect(client.db.warranty_claims).toHaveLength(0);
  });

  it("(c) approved decision executes; rejected decision creates nothing", async () => {
    // Approved
    const okClient = fake([
      dbRule({ id: "r2", action_type: "warranty_claim", action_config: { warranty_id: "w1" } }),
    ]);
    okClient.db.event_action_log.push({
      id: "log-1",
      company_id: COMPANY,
      project_id: PROJECT,
      rule_id: "r2",
      scada_event_id: "ev-1",
      action_type: "warranty_claim",
      status: "pending_approval",
      approval_instance_id: "ai-1",
      result_entity: null,
      result_entity_id: null,
    });
    okClient.db.approval_instances.push({
      id: "ai-1",
      status: "approved",
      entity_type: "event_action",
      entity_id: "log-1",
    });
    await settleEventActionsForInstance(okClient as unknown as Db, "ai-1", "user-1");
    expect(okClient.db.event_action_log[0].status).toBe("executed");
    expect(okClient.db.warranty_claims).toHaveLength(1);

    // Rejected
    const noClient = fake([
      dbRule({ id: "r2", action_type: "warranty_claim", action_config: { warranty_id: "w1" } }),
    ]);
    noClient.db.event_action_log.push({
      id: "log-1",
      company_id: COMPANY,
      project_id: PROJECT,
      rule_id: "r2",
      scada_event_id: "ev-1",
      action_type: "warranty_claim",
      status: "pending_approval",
      approval_instance_id: "ai-1",
      result_entity: null,
      result_entity_id: null,
    });
    noClient.db.approval_instances.push({
      id: "ai-1",
      status: "rejected",
      entity_type: "event_action",
      entity_id: "log-1",
    });
    await settleEventActionsForInstance(noClient as unknown as Db, "ai-1", "user-1");
    expect(noClient.db.event_action_log[0].status).toBe("rejected");
    expect(noClient.db.warranty_claims).toHaveLength(0);
  });

  it("(b′) execution is blocked without a genuinely approved instance", async () => {
    const client = fake([
      dbRule({ id: "r2", action_type: "warranty_claim", action_config: { warranty_id: "w1" } }),
    ]);
    client.db.event_action_log.push({
      id: "log-1",
      company_id: COMPANY,
      project_id: PROJECT,
      rule_id: "r2",
      scada_event_id: "ev-1",
      action_type: "warranty_claim",
      status: "approved",
      approval_instance_id: null,
      result_entity: null,
      result_entity_id: null,
    });
    const outcome = await executeEventAction(client as unknown as Db, "log-1", "user-1");
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toBe("approval_required");
    expect(client.db.warranty_claims).toHaveLength(0);
  });

  it("(d) replaying the same event never creates a second log row", async () => {
    const client = fake([dbRule()]);
    await evaluateEventActions({ db: client as unknown as Db }, engineEvent);
    const second = await evaluateEventActions({ db: client as unknown as Db }, engineEvent);

    expect(client.db.event_action_log).toHaveLength(1);
    expect(second.created).toBe(0);
    expect(second.executed).toBe(0);
    expect(client.db.work_orders).toHaveLength(1);
  });

  it("(e) AI assist is recommend-only: stored as ai_suggestion, never approved or executed by AI", async () => {
    process.env.LOVABLE_API_KEY = "test-key";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"recommended":true,"confidence":0.8,"rationale":"x"}',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const client = fake([
      dbRule({ id: "r2", action_type: "warranty_claim", ai_assist: true }),
    ]);
    const auth = authFor(client);
    await evaluateEventActions({ db: client as unknown as Db, auth }, engineEvent);

    const log = client.db.event_action_log[0];
    expect(log.ai_suggestion).toBeTruthy();
    expect((log.ai_suggestion as { advisory: boolean }).advisory).toBe(true);
    // The AI path provably never approves or executes.
    expect(client.rpcCalls.map((c) => c.name)).not.toContain("decide_approval");
    expect(log.status).toBe("pending_approval");
    expect(client.db.warranty_claims).toHaveLength(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    delete process.env.LOVABLE_API_KEY;
  });

  it("(f) min_severity gating follows info < warning < major < critical", async () => {
    const below = fake([dbRule({ min_severity: "critical" })]);
    const belowResult = await evaluateEventActions({ db: below as unknown as Db }, engineEvent);
    expect(belowResult.matched).toBe(0);

    const at = fake([dbRule({ min_severity: "major" })]);
    expect((await evaluateEventActions({ db: at as unknown as Db }, engineEvent)).matched).toBe(1);

    const under = fake([dbRule({ min_severity: "info" })]);
    expect((await evaluateEventActions({ db: under as unknown as Db }, engineEvent)).matched).toBe(
      1,
    );
  });
});
