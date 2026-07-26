// P-176 — Pure SCADA→O&M action-rule matching + governance floor.
// No React / Supabase imports: safe for unit tests and both runtimes.
import { z } from "zod";

import { SCADA_EVENT_SEVERITIES, SCADA_EVENT_TYPES } from "@/lib/scada/events";

export const EVENT_ACTION_TYPES = [
  "create_incident",
  "create_work_order",
  "assign_technician",
  "spare_parts_request",
  "warranty_claim",
  "hse_escalation",
  "client_notification",
  "lender_report_exception",
  "performance_ld_assessment",
] as const;
export type EventActionType = (typeof EVENT_ACTION_TYPES)[number];

export const EVENT_ACTION_STATUSES = [
  "pending_approval",
  "approved",
  "executed",
  "rejected",
  "failed",
  "skipped",
] as const;
export type EventActionStatus = (typeof EVENT_ACTION_STATUSES)[number];

/**
 * GOVERNANCE HARD FLOOR — contractual / safety-critical actions ALWAYS route
 * through the P-111 approval engine, whatever a rule's `requires_approval`
 * flag says. This list is enforced server-side; the UI only mirrors it.
 */
export const CONTRACTUAL_ACTION_TYPES = [
  "warranty_claim",
  "hse_escalation",
  "client_notification",
  "lender_report_exception",
  "performance_ld_assessment",
] as const satisfies readonly EventActionType[];

export function isContractualAction(action: EventActionType): boolean {
  return (CONTRACTUAL_ACTION_TYPES as readonly string[]).includes(action);
}

/** Final authority on whether an action may skip approval. */
export function actionRequiresApproval(
  action: EventActionType,
  ruleRequiresApproval: boolean,
): boolean {
  return isContractualAction(action) ? true : ruleRequiresApproval;
}

export const ACTION_LABELS: Record<EventActionType, string> = {
  create_incident: "Create service ticket",
  create_work_order: "Create work order",
  assign_technician: "Assign technician",
  spare_parts_request: "Spare-parts request",
  warranty_claim: "Warranty claim",
  hse_escalation: "HSE escalation",
  client_notification: "Client notification",
  lender_report_exception: "Lender report exception",
  performance_ld_assessment: "Performance LD assessment",
};

// ---- severity ordering -----------------------------------------------------
export const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warning: 1,
  major: 2,
  critical: 3,
};

export function meetsSeverity(eventSeverity: string, minSeverity: string): boolean {
  const a = SEVERITY_RANK[eventSeverity];
  const b = SEVERITY_RANK[minSeverity];
  if (a == null || b == null) return false;
  return a >= b;
}

// ---- match filters ---------------------------------------------------------
export const matchFilterSchema = z
  .object({
    code_in: z.array(z.string().trim().min(1)).optional(),
    message_contains: z.string().trim().min(1).optional(),
    source_in: z.array(z.string().trim().min(1)).optional(),
    asset_node_ids: z.array(z.string().uuid()).optional(),
    payload_equals: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type MatchFilter = z.infer<typeof matchFilterSchema>;

export interface MatchableEvent {
  project_id: string;
  event_type: string;
  severity: string;
  code?: string | null;
  message?: string | null;
  source?: string | null;
  asset_node_id?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface MatchableRule {
  id: string;
  project_id?: string | null;
  event_type: string;
  min_severity: string;
  match: unknown;
  action_type: EventActionType;
  requires_approval: boolean;
  enabled: boolean;
}

/** Parse a stored `match` jsonb; unknown/invalid shapes degrade to "no filter". */
export function parseMatchFilter(raw: unknown): MatchFilter {
  const parsed = matchFilterSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/** Deterministic rule match — no AI, no side effects. */
export function ruleMatchesEvent(rule: MatchableRule, event: MatchableEvent): boolean {
  if (!rule.enabled) return false;
  if (rule.project_id && rule.project_id !== event.project_id) return false;
  if (rule.event_type !== event.event_type) return false;
  if (!meetsSeverity(event.severity, rule.min_severity)) return false;

  const f = parseMatchFilter(rule.match);
  if (f.code_in && f.code_in.length > 0) {
    if (!event.code || !f.code_in.includes(event.code)) return false;
  }
  if (f.message_contains) {
    const hay = (event.message ?? "").toLowerCase();
    if (!hay.includes(f.message_contains.toLowerCase())) return false;
  }
  if (f.source_in && f.source_in.length > 0) {
    if (!event.source || !f.source_in.includes(event.source)) return false;
  }
  if (f.asset_node_ids && f.asset_node_ids.length > 0) {
    if (!event.asset_node_id || !f.asset_node_ids.includes(event.asset_node_id)) return false;
  }
  if (f.payload_equals) {
    const payload = event.payload ?? {};
    for (const [k, v] of Object.entries(f.payload_equals)) {
      if (payload[k] !== v) return false;
    }
  }
  return true;
}

export interface PlannedAction {
  rule_id: string;
  action_type: EventActionType;
  requires_approval: boolean;
  /** Initial log status: operational auto-exec rules start as `approved`. */
  initial_status: EventActionStatus;
}

/**
 * Deterministic planner: which rules fire for an event and whether each one
 * must wait for a P-111 decision. Pure — the caller performs the writes.
 */
export function planEventActions(
  rules: readonly MatchableRule[],
  event: MatchableEvent,
): PlannedAction[] {
  return rules
    .filter((rule) => ruleMatchesEvent(rule, event))
    .map((rule) => {
      const requires = actionRequiresApproval(rule.action_type, rule.requires_approval);
      return {
        rule_id: rule.id,
        action_type: rule.action_type,
        requires_approval: requires,
        initial_status: requires ? "pending_approval" : "approved",
      } satisfies PlannedAction;
    });
}

// ---- action configuration --------------------------------------------------
export const actionConfigSchema = z
  .object({
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    /** assign_technician / client_notification recipients */
    user_id: z.string().uuid().optional(),
    user_ids: z.array(z.string().uuid()).optional(),
    /** spare_parts_request */
    spare_part_id: z.string().uuid().optional(),
    quantity: z.number().int().positive().max(10_000).optional(),
    /** warranty_claim */
    warranty_id: z.string().uuid().optional(),
    claimed_amount: z.number().nonnegative().optional(),
    /** hse_escalation */
    incident_type: z.string().trim().max(64).optional(),
    severity: z.string().trim().max(32).optional(),
  })
  .strict();
export type ActionConfig = z.infer<typeof actionConfigSchema>;

/** Config keys that are mandatory before a rule of this type can execute. */
export const REQUIRED_CONFIG_KEYS: Partial<Record<EventActionType, Array<keyof ActionConfig>>> = {
  assign_technician: ["user_id"],
  spare_parts_request: ["spare_part_id", "quantity"],
  warranty_claim: ["warranty_id"],
};

export function missingConfigKeys(action: EventActionType, config: ActionConfig): string[] {
  const required = REQUIRED_CONFIG_KEYS[action] ?? [];
  return required.filter((k) => config[k] === undefined || config[k] === null).map(String);
}

// ---- form schema (UI) ------------------------------------------------------
export const actionRuleFormSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    project_id: z.string().uuid().nullable().optional(),
    event_type: z.enum(SCADA_EVENT_TYPES),
    min_severity: z.enum(SCADA_EVENT_SEVERITIES),
    match: matchFilterSchema.default({}),
    action_type: z.enum(EVENT_ACTION_TYPES),
    action_config: actionConfigSchema.default({}),
    requires_approval: z.boolean().default(true),
    approval_rule_key: z.string().trim().min(2).max(80).default("scada_event_action"),
    ai_assist: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .transform((v) => ({
    ...v,
    // Governance floor mirrored client-side; the server re-applies it.
    requires_approval: actionRequiresApproval(v.action_type, v.requires_approval),
  }));
export type ActionRuleFormValues = z.input<typeof actionRuleFormSchema>;
