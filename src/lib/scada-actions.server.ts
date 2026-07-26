/**
 * P-176 — SCADA→O&M action engine (server only).
 *
 * Governance, non-negotiable:
 *  - The P-111 approval engine is the FINAL authority. Contractual /
 *    safety-critical actions can never execute without an approved instance.
 *  - AI recommends only. `ai_suggestion` is advisory JSON; no code path here
 *    lets it change `status`, call `decide_approval`, or execute anything.
 *  - The frontend is never the authority: every check below runs server-side.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { Database, Json } from "@/integrations/supabase/types";
import { writeAuditLog } from "@/lib/civil.server";
import { nextIncidentNumber } from "@/lib/hse.rules";
import {
  actionConfigSchema,
  actionRequiresApproval,
  isContractualAction,
  missingConfigKeys,
  planEventActions,
  type ActionConfig,
  type EventActionType,
  type MatchableEvent,
  type MatchableRule,
} from "@/lib/scada/action-rules";
import { generateTicketNumber } from "@/lib/service-tickets.server";
import { generateClaimNumber } from "@/lib/warranties.server";
import { generateWoNumber } from "@/lib/work-orders.server";

export type Db = SupabaseClient<Database>;

export interface EngineEvent extends MatchableEvent {
  id: string;
  company_id: string;
  project_id: string;
}

export interface EngineOptions {
  /** Service-role (or otherwise privileged) client used for log writes. */
  db: Db;
  /** Present when a signed-in user triggered evaluation. Enables approval routing. */
  auth?: AuthContext;
}

export interface EvaluationResult {
  matched: number;
  created: number;
  executed: number;
  pendingApproval: number;
  failed: number;
}

interface LogRow {
  id: string;
  company_id: string;
  project_id: string;
  rule_id: string | null;
  scada_event_id: string | null;
  action_type: EventActionType;
  status: string;
  approval_instance_id: string | null;
  result_entity: string | null;
  result_entity_id: string | null;
}

export async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const cid = (data as { company_id: string | null } | null)?.company_id;
  if (!cid) throw Object.assign(new Error("no_company"), { statusCode: 400 });
  return cid;
}

/** Rules that could fire for this event (deterministic filtering happens in the pure module). */
async function candidateRules(db: Db, event: EngineEvent): Promise<MatchableRule[]> {
  const { data, error } = await db
    .from("event_action_rules")
    .select(
      "id, project_id, event_type, min_severity, match, action_type, action_config, requires_approval, approval_rule_key, ai_assist, enabled",
    )
    .eq("company_id", event.company_id)
    .eq("enabled", true)
    .eq("event_type", event.event_type as never);
  if (error) throw error;
  return (data ?? []) as unknown as MatchableRule[];
}

/**
 * Evaluate every enabled rule against one event. Idempotent on
 * (rule_id, scada_event_id): replaying the same event never duplicates work.
 */
export async function evaluateEventActions(
  opts: EngineOptions,
  event: EngineEvent,
): Promise<EvaluationResult> {
  const { db, auth } = opts;
  const result: EvaluationResult = {
    matched: 0,
    created: 0,
    executed: 0,
    pendingApproval: 0,
    failed: 0,
  };

  const rules = await candidateRules(db, event);
  const byId = new Map(rules.map((r) => [r.id, r as MatchableRule & Record<string, unknown>]));
  const plans = planEventActions(rules, event);
  result.matched = plans.length;
  if (plans.length === 0) return result;

  for (const plan of plans) {
    const rule = byId.get(plan.rule_id)!;

    // One log row per (rule, event). `upsert ... ignoreDuplicates` keeps
    // replays idempotent; we then read the row back to learn its state.
    await db.from("event_action_log").upsert(
      {
        company_id: event.company_id,
        project_id: event.project_id,
        rule_id: plan.rule_id,
        scada_event_id: event.id,
        action_type: plan.action_type,
        status: "pending_approval",
      } as never,
      { onConflict: "rule_id,scada_event_id", ignoreDuplicates: true },
    );

    const { data: existing } = await db
      .from("event_action_log")
      .select(
        "id, company_id, project_id, rule_id, scada_event_id, action_type, status, approval_instance_id, result_entity, result_entity_id",
      )
      .eq("rule_id", plan.rule_id)
      .eq("scada_event_id", event.id)
      .maybeSingle();
    const log = existing as LogRow | null;
    if (!log) {
      result.failed += 1;
      continue;
    }

    const isFresh =
      log.status === "pending_approval" &&
      !log.approval_instance_id &&
      !log.result_entity_id &&
      // a previously-settled row is never re-planned
      true;
    if (!isFresh) continue;
    result.created += 1;

    // Advisory-only AI recommendation — stored, never acted on.
    if (rule.ai_assist === true) {
      const suggestion = await suggestEventAction(event, plan.action_type);
      if (suggestion) {
        await db
          .from("event_action_log")
          .update({ ai_suggestion: suggestion as unknown as Json } as never)
          .eq("id", log.id);
      }
    }

    const requires = actionRequiresApproval(plan.action_type, rule.requires_approval);
    if (requires) {
      const instanceId = auth
        ? await startApprovalFor(auth, log, String(rule.approval_rule_key ?? ""), event)
        : null;
      if (instanceId) {
        await db
          .from("event_action_log")
          .update({ approval_instance_id: instanceId } as never)
          .eq("id", log.id);
      }
      result.pendingApproval += 1;
      await auditEngine(opts, "scada.event_action_routed", log.id, {
        rule_id: plan.rule_id,
        event_id: event.id,
        action_type: plan.action_type,
        contractual: isContractualAction(plan.action_type),
        approval_instance_id: instanceId,
      });
      continue;
    }

    // Operational action with requires_approval = false: execute immediately.
    await db.from("event_action_log").update({ status: "approved" } as never).eq("id", log.id);
    const outcome = await executeEventAction(db, log.id, auth?.user?.id ?? null);
    if (outcome.status === "executed") result.executed += 1;
    else result.failed += 1;
    await auditEngine(opts, "scada.event_action_execute", log.id, {
      rule_id: plan.rule_id,
      event_id: event.id,
      action_type: plan.action_type,
      status: outcome.status,
      result_entity: outcome.result_entity,
      result_entity_id: outcome.result_entity_id,
      error: outcome.error,
    });
  }

  return result;
}

async function auditEngine(
  opts: EngineOptions,
  action: string,
  logId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  if (opts.auth) {
    await writeAuditLog(opts.auth, action, "event_action_log", logId, metadata);
    return;
  }
  // Unauthenticated ingestion path: audit through the privileged client.
  try {
    await opts.db.rpc("write_audit_log", {
      p_action: action,
      p_entity: "event_action_log",
      p_entity_id: logId,
      p_metadata: metadata as never,
    } as never);
  } catch {
    // audit must never fail ingestion
  }
}

async function startApprovalFor(
  auth: AuthContext,
  log: LogRow,
  ruleKey: string,
  event: EngineEvent,
): Promise<string | null> {
  const { data, error } = await auth.supabase.rpc("start_approval_instance", {
    p_rule_key: ruleKey || "scada_event_action",
    p_entity_type: "event_action",
    p_entity_id: log.id,
    p_metadata: {
      project_id: log.project_id,
      action_type: log.action_type,
      scada_event_id: event.id,
      title: `SCADA action — ${log.action_type}`,
      event_message: event.message ?? null,
      severity: event.severity,
    } as never,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

// ---- execution -------------------------------------------------------------
export interface ExecutionOutcome {
  status: "executed" | "failed";
  result_entity: string | null;
  result_entity_id: string | null;
  error: string | null;
}

/**
 * Execute a single logged action. Enforces the governance floor again here so
 * no caller — UI, RPC, or engine — can bypass P-111 for contractual actions.
 */
export async function executeEventAction(
  db: Db,
  logId: string,
  actorId: string | null,
): Promise<ExecutionOutcome> {
  const { data, error } = await db
    .from("event_action_log")
    .select(
      "id, company_id, project_id, rule_id, scada_event_id, action_type, status, approval_instance_id, result_entity, result_entity_id",
    )
    .eq("id", logId)
    .maybeSingle();
  if (error || !data) {
    return { status: "failed", result_entity: null, result_entity_id: null, error: "log_not_found" };
  }
  const log = data as LogRow;

  if (log.status === "executed") {
    return {
      status: "executed",
      result_entity: log.result_entity,
      result_entity_id: log.result_entity_id,
      error: null,
    };
  }
  if (log.status !== "approved") {
    return await fail(db, log.id, `not_approved:${log.status}`);
  }

  // HARD FLOOR: contractual actions require a genuinely approved P-111 instance.
  if (isContractualAction(log.action_type)) {
    const ok = await hasApprovedInstance(db, log.approval_instance_id, log.id);
    if (!ok) return await fail(db, log.id, "approval_required");
  }

  const rule = log.rule_id
    ? ((
        await db
          .from("event_action_rules")
          .select("action_config, name")
          .eq("id", log.rule_id)
          .maybeSingle()
      ).data as { action_config: unknown; name: string } | null)
    : null;
  const parsedConfig = actionConfigSchema.safeParse(rule?.action_config ?? {});
  const config: ActionConfig = parsedConfig.success ? parsedConfig.data : {};
  const missing = missingConfigKeys(log.action_type, config);
  if (missing.length > 0) return await fail(db, log.id, `missing_config:${missing.join(",")}`);

  const event = log.scada_event_id
    ? ((
        await db
          .from("scada_events")
          .select("id, message, severity, code, scada_asset_id, asset_node_id, occurred_at")
          .eq("id", log.scada_event_id)
          .maybeSingle()
      ).data as {
        id: string;
        message: string;
        severity: string;
        code: string | null;
        scada_asset_id: string | null;
        asset_node_id: string | null;
        occurred_at: string;
      } | null)
    : null;

  try {
    const outcome = await performAction(db, log, config, event, rule?.name ?? "SCADA rule", actorId);
    await db
      .from("event_action_log")
      .update({
        status: "executed",
        result_entity: outcome.entity,
        result_entity_id: outcome.entityId,
        executed_by: actorId,
        executed_at: new Date().toISOString(),
        error: null,
      } as never)
      .eq("id", log.id);
    return {
      status: "executed",
      result_entity: outcome.entity,
      result_entity_id: outcome.entityId,
      error: null,
    };
  } catch (e) {
    return await fail(db, log.id, e instanceof Error ? e.message : "execution_failed");
  }
}

async function fail(db: Db, logId: string, message: string): Promise<ExecutionOutcome> {
  await db
    .from("event_action_log")
    .update({ status: "failed", error: message } as never)
    .eq("id", logId);
  return { status: "failed", result_entity: null, result_entity_id: null, error: message };
}

async function hasApprovedInstance(
  db: Db,
  instanceId: string | null,
  logId: string,
): Promise<boolean> {
  const q = db
    .from("approval_instances")
    .select("id, status")
    .eq("entity_type", "event_action")
    .eq("entity_id", logId)
    .eq("status", "approved");
  const { data } = instanceId ? await q.eq("id", instanceId) : await q;
  return ((data ?? []) as Array<{ id: string }>).length > 0;
}

interface ActionResult {
  entity: string;
  entityId: string;
}

async function performAction(
  db: Db,
  log: LogRow,
  config: ActionConfig,
  event: {
    id: string;
    message: string;
    severity: string;
    code: string | null;
    scada_asset_id: string | null;
    occurred_at: string;
  } | null,
  ruleName: string,
  actorId: string | null,
): Promise<ActionResult> {
  const title = config.title ?? `${ruleName}: ${event?.message ?? "SCADA event"}`.slice(0, 200);
  const description = config.description ?? event?.message ?? null;

  switch (log.action_type) {
    case "create_work_order":
      return await createWorkOrder(db, log, config, event, title, description, actorId);

    case "create_incident": {
      const ticketNumber = await generateTicketNumber(db, log.company_id);
      const { data, error } = await db
        .from("service_tickets")
        .insert({
          company_id: log.company_id,
          project_id: log.project_id,
          ticket_number: ticketNumber,
          title,
          description,
          category: "corrective",
          priority: config.priority ?? "medium",
          reported_by: actorId,
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { entity: "service_tickets", entityId: (data as { id: string }).id };
    }

    case "assign_technician": {
      const { data: wo } = await db
        .from("work_orders")
        .select("id")
        .eq("project_id", log.project_id)
        .not("status", "in", "(closed,cancelled)")
        .order("created_at", { ascending: false })
        .limit(1);
      const target = ((wo ?? []) as Array<{ id: string }>)[0];
      if (!target) throw new Error("no_open_work_order");
      const { error } = await db
        .from("work_orders")
        .update({ assigned_to: config.user_id! } as never)
        .eq("id", target.id);
      if (error) throw new Error(error.message);
      return { entity: "work_orders", entityId: target.id };
    }

    case "spare_parts_request": {
      const qty = config.quantity ?? 1;
      const { data: part, error: partErr } = await db
        .from("spare_parts")
        .select("id, name, part_number, qty_on_hand")
        .eq("id", config.spare_part_id!)
        .maybeSingle();
      if (partErr || !part) throw new Error("spare_part_not_found");
      const row = part as { id: string; name: string; part_number: string; qty_on_hand: number };
      // Reservation note: hold stock against the triggered event.
      const { error: updErr } = await db
        .from("spare_parts")
        .update({ qty_on_hand: Math.max(0, (row.qty_on_hand ?? 0) - qty) } as never)
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);

      const woResult = await createWorkOrder(
        db,
        log,
        config,
        event,
        `Parts request — ${row.part_number}`,
        `Reserved ${qty} × ${row.name} (${row.part_number}) for ${event?.message ?? "SCADA event"}.`,
        actorId,
        [{ part_id: row.id, part_number: row.part_number, name: row.name, qty, reserved: true }],
      );
      // The WO carries the parts line; the log points at the reserved part.
      void woResult;
      return { entity: "spare_parts", entityId: row.id };
    }

    case "warranty_claim": {
      const claimNumber = await generateClaimNumber(db, log.company_id);
      const { data, error } = await db
        .from("warranty_claims")
        .insert({
          company_id: log.company_id,
          warranty_id: config.warranty_id!,
          claim_number: claimNumber,
          title,
          description,
          status: "draft",
          claimed_amount: config.claimed_amount ?? null,
          created_by: actorId,
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { entity: "warranty_claims", entityId: (data as { id: string }).id };
    }

    case "hse_escalation": {
      const { data: existing } = await db
        .from("hse_incidents")
        .select("incident_number")
        .eq("company_id", log.company_id)
        .order("incident_number", { ascending: false })
        .limit(200);
      const number = nextIncidentNumber(
        ((existing ?? []) as Array<{ incident_number: string }>).map((r) => r.incident_number),
      );
      const { data, error } = await db
        .from("hse_incidents")
        .insert({
          company_id: log.company_id,
          project_id: log.project_id,
          incident_number: number,
          incident_type: (config.incident_type ?? "near_miss") as never,
          severity: (config.severity ?? "minor") as never,
          occurred_at: event?.occurred_at ?? new Date().toISOString(),
          description: description ?? title,
          created_by: actorId,
        } as never)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { entity: "hse_incidents", entityId: (data as { id: string }).id };
    }

    case "client_notification":
    case "lender_report_exception":
    case "performance_ld_assessment": {
      const recipients = await notificationRecipients(db, log.company_id, config);
      if (recipients.length === 0) throw new Error("no_recipients");
      const rows = recipients.map((userId) => ({
        company_id: log.company_id,
        user_id: userId,
        type: `scada.${log.action_type}`,
        title,
        body: description,
        link: `/om/scada/action-rules?log=${log.id}`,
      }));
      const { data, error } = await db
        .from("notifications")
        .insert(rows as never)
        .select("id");
      if (error) throw new Error(error.message);
      const first = ((data ?? []) as Array<{ id: string }>)[0];
      return { entity: "notifications", entityId: first.id };
    }

    default:
      throw new Error(`unsupported_action:${log.action_type}`);
  }
}

async function createWorkOrder(
  db: Db,
  log: LogRow,
  config: ActionConfig,
  event: { scada_asset_id: string | null } | null,
  title: string,
  description: string | null,
  actorId: string | null,
  parts?: Array<Record<string, unknown>>,
): Promise<ActionResult> {
  const equipmentId = await equipmentForAsset(db, event?.scada_asset_id ?? null);
  let lastError = "wo_create_failed";
  for (let attempt = 0; attempt < 5; attempt++) {
    const woNumber = await generateWoNumber(db, log.company_id);
    const { data, error } = await db
      .from("work_orders")
      .insert({
        company_id: log.company_id,
        project_id: log.project_id,
        equipment_id: equipmentId,
        wo_number: woNumber,
        title,
        description,
        type: "corrective",
        priority: config.priority ?? "medium",
        source: "alarm",
        assigned_to: config.user_id ?? null,
        parts: (parts ?? []) as never,
        created_by: actorId,
      } as never)
      .select("id")
      .single();
    if (!error && data) return { entity: "work_orders", entityId: (data as { id: string }).id };
    lastError = error?.message ?? lastError;
    if (error && !error.message.includes("duplicate")) break;
  }
  throw new Error(lastError);
}

async function equipmentForAsset(db: Db, scadaAssetId: string | null): Promise<string | null> {
  if (!scadaAssetId) return null;
  const { data } = await db
    .from("scada_assets")
    .select("equipment_id")
    .eq("id", scadaAssetId)
    .maybeSingle();
  return (data as { equipment_id: string | null } | null)?.equipment_id ?? null;
}

async function notificationRecipients(
  db: Db,
  companyId: string,
  config: ActionConfig,
): Promise<string[]> {
  const explicit = [...(config.user_ids ?? []), ...(config.user_id ? [config.user_id] : [])];
  if (explicit.length > 0) return Array.from(new Set(explicit));
  const { data } = await db
    .from("user_roles")
    .select("user_id, role")
    .eq("company_id", companyId)
    .in("role", ["om_admin", "company_admin"]);
  return Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));
}

// ---- P-111 decision hook ---------------------------------------------------
/**
 * Called from the approval-inbox decision path once `decide_approval` returned.
 * Executes actions whose instance is approved; blocks the rest. Approval state
 * is re-read from the database — never trusted from the caller.
 */
export async function settleEventActionsForInstance(
  db: Db,
  instanceId: string,
  actorId: string | null,
): Promise<{ settled: number }> {
  const { data: instance } = await db
    .from("approval_instances")
    .select("id, status, entity_type, entity_id")
    .eq("id", instanceId)
    .maybeSingle();
  const inst = instance as { status: string; entity_type: string; entity_id: string } | null;
  if (!inst || inst.entity_type !== "event_action") return { settled: 0 };

  const { data: logs } = await db
    .from("event_action_log")
    .select("id, status")
    .eq("id", inst.entity_id);
  const rows = (logs ?? []) as Array<{ id: string; status: string }>;
  let settled = 0;

  for (const row of rows) {
    if (row.status === "executed" || row.status === "rejected") continue;
    if (inst.status === "approved") {
      await db.from("event_action_log").update({ status: "approved" } as never).eq("id", row.id);
      await executeEventAction(db, row.id, actorId);
      settled += 1;
    } else if (inst.status === "rejected" || inst.status === "cancelled") {
      await db
        .from("event_action_log")
        .update({ status: "rejected", error: `approval_${inst.status}` } as never)
        .eq("id", row.id);
      settled += 1;
    }
  }
  return { settled };
}

// ---- AI assist (advisory only) --------------------------------------------
/**
 * Lovable AI recommendation for an already-matched rule. The result is stored
 * verbatim in `ai_suggestion` and shown with an "advisory only" badge. It is
 * never read back by the engine, never changes `status`, and never executes.
 */
export async function suggestEventAction(
  event: EngineEvent,
  candidate: EventActionType,
): Promise<Record<string, unknown> | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "You advise renewable-plant O&M engineers. You never approve or execute actions; you only recommend. Reply with strict JSON: {\"recommended\":boolean,\"confidence\":number,\"rationale\":string,\"suggested_priority\":\"low\"|\"medium\"|\"high\"|\"urgent\"}.",
          },
          {
            role: "user",
            content: JSON.stringify({
              event: {
                type: event.event_type,
                severity: event.severity,
                code: event.code ?? null,
                message: event.message ?? null,
              },
              candidate_action: candidate,
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      return { advisory: true, error: `gateway_${response.status}` };
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      parsed = { text: content };
    }
    return {
      advisory: true,
      model: "google/gemini-2.5-flash",
      generated_at: new Date().toISOString(),
      suggestion: parsed,
    };
  } catch {
    return null;
  }
}

// ---- admin/CRUD helpers ----------------------------------------------------
import { createServiceRoleClient } from "@/integrations/supabase/server";

export function privilegedDb(): Db {
  return createServiceRoleClient() as unknown as Db;
}

export async function canManageRules(context: AuthContext): Promise<boolean> {
  for (const role of ["om_admin", "scada_admin", "company_admin"] as const) {
    const { data } = await context.supabase.rpc("has_company_role", { p_role: role as never });
    if (data === true) return true;
  }
  return false;
}

export async function assertRuleWriter(context: AuthContext): Promise<void> {
  if (!(await canManageRules(context))) {
    throw Object.assign(new Error("forbidden_role"), { statusCode: 403 });
  }
}

export interface ActionRuleRow {
  id: string;
  company_id: string;
  project_id: string | null;
  project_name: string | null;
  name: string;
  event_type: string;
  min_severity: string;
  match: Json;
  action_type: EventActionType;
  action_config: Json;
  requires_approval: boolean;
  approval_rule_key: string;
  ai_assist: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export async function listRules(context: AuthContext): Promise<ActionRuleRow[]> {
  const { data, error } = await context.supabase
    .from("event_action_rules")
    .select(
      "id, company_id, project_id, name, event_type, min_severity, match, action_type, action_config, requires_approval, approval_rule_key, ai_assist, enabled, created_at, updated_at, project:projects(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    ...(r as unknown as ActionRuleRow),
    project_name: (r.project as { name: string } | null)?.name ?? null,
  }));
}

export interface ActionLogRow {
  id: string;
  project_id: string;
  project_name: string | null;
  rule_id: string | null;
  rule_name: string | null;
  scada_event_id: string | null;
  event_message: string | null;
  event_severity: string | null;
  event_occurred_at: string | null;
  action_type: EventActionType;
  status: string;
  approval_instance_id: string | null;
  approval_status: string | null;
  ai_suggestion: Json | null;
  result_entity: string | null;
  result_entity_id: string | null;
  executed_at: string | null;
  error: string | null;
  created_at: string;
}

export async function listActionLogRows(
  context: AuthContext,
  limit = 100,
): Promise<ActionLogRow[]> {
  const { data, error } = await context.supabase
    .from("event_action_log")
    .select(
      "id, project_id, rule_id, scada_event_id, action_type, status, approval_instance_id, ai_suggestion, result_entity, result_entity_id, executed_at, error, created_at, project:projects(name), rule:event_action_rules(name), event:scada_events(message, severity, occurred_at), instance:approval_instances(status)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const event = r.event as { message: string; severity: string; occurred_at: string } | null;
    return {
      ...(r as unknown as ActionLogRow),
      project_name: (r.project as { name: string } | null)?.name ?? null,
      rule_name: (r.rule as { name: string } | null)?.name ?? null,
      event_message: event?.message ?? null,
      event_severity: event?.severity ?? null,
      event_occurred_at: event?.occurred_at ?? null,
      approval_status: (r.instance as { status: string } | null)?.status ?? null,
    };
  });
}

/** Manual re-evaluation of one event from the timeline / log view. */
export async function evaluateEventById(
  context: AuthContext,
  eventId: string,
): Promise<EvaluationResult> {
  const companyId = await currentCompanyId(context);
  const { data, error } = await context.supabase
    .from("scada_events")
    .select(
      "id, company_id, project_id, event_type, severity, code, message, source, asset_node_id, payload",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  const event = data as EngineEvent | null;
  if (!event || event.company_id !== companyId) {
    throw Object.assign(new Error("event_not_found"), { statusCode: 404 });
  }
  return await evaluateEventActions({ db: privilegedDb(), auth: context }, event);
}
