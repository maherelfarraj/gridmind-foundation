// GC-10 — Portfolio Finance Alerts: evaluation, persistence, routing and reads.
//
// Reuses the authoritative portfolio aggregation (`buildPortfolioCosting`) and
// the existing in-app `notifications` inbox. It adds no second notification
// engine, stores no duplicate financial balances, and never re-rates approved
// snapshots — alerts only reference figures the close modules already froze.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasCloseRole } from "@/lib/costing.close.server";
import { costingAudit, costingHttpError } from "@/lib/costing.server";
import {
  ALERT_RULE_TYPES,
  ackDueAt,
  buildAlertCsv,
  effectiveStatus,
  escalationTier,
  evaluatePortfolioAlerts,
  isAckOverdue,
  mergeConfigs,
  summarize,
  transitionOnSeen,
  type AlertCandidate,
  type AlertConfigUpdate,
  type AlertFilter,
  type AlertRecord,
  type AlertRuleConfig,
  type AlertRuleType,
  type AlertSummary,
  type OpenException,
} from "@/lib/portfolio-alerts.rules";
import { specOf } from "@/lib/portfolio-audit.rules";
import { buildPortfolioCosting, currentCompanyId } from "@/lib/portfolio-costing.server";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202";
}

async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return (data ?? []) as T[];
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export async function loadAlertConfigs(
  ctx: AuthContext,
  companyId: string,
): Promise<Record<AlertRuleType, AlertRuleConfig>> {
  const data = await rows<Partial<AlertRuleConfig>>(
    sbOf(ctx)
      .from("portfolio_alert_configs")
      .select(
        "rule_type, enabled, severity, threshold_value, threshold_unit, lead_days, ack_sla_hours, notify_roles, escalate_roles",
      )
      .eq("company_id", companyId),
  );
  return mergeConfigs(
    data.map((d) => ({
      ...d,
      threshold_value: d.threshold_value === null ? null : Number(d.threshold_value),
    })),
  );
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
export interface EvaluationResult {
  company_id: string;
  period: string;
  evaluated: number;
  created: number;
  reopened: number;
  updated: number;
  resolved: number;
  escalated: number;
  notified: number;
  locked_out?: boolean;
}

interface ExistingRow extends AlertRecord {}

const ALERT_COLUMNS =
  "id, company_id, project_id, period_month, rule_type, fingerprint, severity, status, escalation_tier, entity_table, entity_id, current_value, threshold_value, value_unit, currency_code, owner_id, title, detail, deep_link, context, first_seen_at, last_seen_at, occurrence_count, reopen_count, ack_due_at, acknowledged_by, acknowledged_at, snoozed_until, escalated_at, resolved_at";

/**
 * One company, one deterministic pass. Every read is set-based (a fixed number
 * of queries regardless of project count) and every write is batched, so a
 * repeat run touches the same rows instead of creating new ones.
 */
export async function evaluateCompanyAlerts(
  ctx: AuthContext,
  companyId: string,
  opts: { period?: string; now?: string; notify?: boolean; actorId?: string | null } = {},
): Promise<EvaluationResult> {
  const nowIso = opts.now ?? new Date().toISOString();
  const data = await buildPortfolioCosting(
    ctx,
    companyId,
    opts.period ? { period: opts.period } : {},
    { audit: false },
  );
  const period = data.period;
  const configs = await loadAlertConfigs(ctx, companyId);

  const [exceptions, reopenLogs, auditLogs] = await Promise.all([
    rows<OpenException>(
      sbOf(ctx)
        .from("costing_exceptions")
        .select("id, project_id, period_month, title, severity, status, first_seen_at, owner_id")
        .eq("company_id", companyId)
        .in("status", ["open", "in_progress", "waiver_requested"]),
    ),
    rows<{ created_at: string; metadata: Record<string, unknown> | null }>(
      sbOf(ctx)
        .from("audit_logs")
        .select("created_at, metadata")
        .eq("company_id", companyId)
        .eq("action", "period.reopen")
        .order("created_at", { ascending: false })
        .limit(50),
    ),
    rows<{ action: string; actor_id: string | null; entity_id: string | null }>(
      sbOf(ctx)
        .from("audit_logs")
        .select("action, actor_id, entity_id, metadata")
        .eq("company_id", companyId)
        .contains("metadata", { period })
        .order("created_at", { ascending: false })
        .limit(500),
    ),
  ]);

  const reopened = reopenLogs
    .map((l) => ({
      project_id: (l.metadata?.["project_id"] as string | null) ?? null,
      period_month: String(l.metadata?.["period"] ?? l.metadata?.["period_month"] ?? ""),
      at: l.created_at,
    }))
    .filter((r) => r.period_month === period);

  const audit_gaps = auditLogs.filter((l) => {
    const spec = specOf(l.action);
    if (!spec) return false;
    return !l.actor_id || (spec.expectsEntity && !l.entity_id);
  }).length;

  const candidates = evaluatePortfolioAlerts({
    period,
    today: data.today,
    period_end: data.period_end,
    reporting_currency: data.reporting_currency,
    rows: data.rows,
    configs,
    exceptions,
    reopened,
    audit_gaps,
  });

  const existing = await rows<ExistingRow>(
    sbOf(ctx).from("portfolio_alerts").select(ALERT_COLUMNS).eq("company_id", companyId),
  );
  const byFingerprint = new Map(existing.map((e) => [e.fingerprint, e]));
  const seen = new Set(candidates.map((c) => c.fingerprint));

  const upserts: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const notifyOf: { candidate: AlertCandidate; kind: "created" | "reopened" }[] = [];
  let created = 0;
  let reopenedCount = 0;
  let updated = 0;

  for (const c of candidates) {
    const cfg = configs[c.rule_type];
    const prev = byFingerprint.get(c.fingerprint) ?? null;
    if (!prev) {
      created += 1;
      notifyOf.push({ candidate: c, kind: "created" });
      upserts.push({
        company_id: companyId,
        project_id: c.project_id,
        period_month: c.period_month,
        rule_type: c.rule_type,
        fingerprint: c.fingerprint,
        severity: c.severity,
        status: "open",
        escalation_tier: 0,
        entity_table: c.entity_table,
        entity_id: c.entity_id,
        current_value: c.current_value,
        threshold_value: c.threshold_value,
        value_unit: c.value_unit,
        currency_code: c.currency_code,
        owner_id: c.owner_id,
        title: c.title,
        detail: c.detail,
        deep_link: c.deep_link,
        context: c.context,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        occurrence_count: 1,
        reopen_count: 0,
        ack_due_at: ackDueAt(nowIso, cfg.ack_sla_hours),
        resolved_at: null,
        next_evaluation_at: null,
      });
      continue;
    }
    const t = transitionOnSeen(prev, nowIso);
    if (t.reopened) {
      reopenedCount += 1;
      notifyOf.push({ candidate: c, kind: "reopened" });
    } else {
      updated += 1;
    }
    upserts.push({
      id: prev.id,
      company_id: companyId,
      project_id: c.project_id,
      period_month: c.period_month,
      rule_type: c.rule_type,
      fingerprint: c.fingerprint,
      severity: c.severity,
      status: t.status,
      escalation_tier: t.reopened ? 0 : prev.escalation_tier,
      entity_table: c.entity_table,
      entity_id: c.entity_id,
      current_value: c.current_value,
      threshold_value: c.threshold_value,
      value_unit: c.value_unit,
      currency_code: c.currency_code,
      owner_id: c.owner_id ?? prev.owner_id,
      title: c.title,
      detail: c.detail,
      deep_link: c.deep_link,
      context: c.context,
      // first_seen_at is never rewritten: occurrence history is preserved.
      first_seen_at: prev.first_seen_at,
      last_seen_at: nowIso,
      occurrence_count: t.occurrence_count,
      reopen_count: t.reopen_count,
      ack_due_at: t.reopened ? ackDueAt(nowIso, cfg.ack_sla_hours) : prev.ack_due_at,
      acknowledged_by: t.reopened ? null : prev.acknowledged_by,
      acknowledged_at: t.reopened ? null : prev.acknowledged_at,
      snoozed_until: t.reopened ? null : prev.snoozed_until,
      escalated_at: t.reopened ? null : prev.escalated_at,
      resolved_at: null,
    });
  }

  if (upserts.length > 0) {
    const { error } = await sbOf(ctx)
      .from("portfolio_alerts")
      .upsert(upserts, { onConflict: "company_id,fingerprint" });
    if (error && !isMissingObject(error)) throw error;
  }

  // --- auto-resolution: the condition no longer holds ------------------------
  const toResolve = existing.filter((e) => e.status !== "resolved" && !seen.has(e.fingerprint));
  if (toResolve.length > 0) {
    const { error } = await sbOf(ctx)
      .from("portfolio_alerts")
      .update({ status: "resolved", resolved_at: nowIso, escalation_tier: 0 })
      .in(
        "id",
        toResolve.map((e) => e.id),
      );
    if (error && !isMissingObject(error)) throw error;
  }

  // --- escalation of unacknowledged, overdue alerts --------------------------
  let escalated = 0;
  const escalations = new Map<number, string[]>();
  for (const e of existing) {
    if (!seen.has(e.fingerprint)) continue;
    if (effectiveStatus(e, nowIso) !== "open") continue;
    const tier = escalationTier(e, nowIso, configs[e.rule_type]?.ack_sla_hours ?? 48);
    if (tier > e.escalation_tier) {
      escalations.set(tier, [...(escalations.get(tier) ?? []), e.id]);
      escalated += 1;
    }
  }
  for (const [tier, ids] of escalations) {
    const { error } = await sbOf(ctx)
      .from("portfolio_alerts")
      .update({ escalation_tier: tier, escalated_at: nowIso })
      .in("id", ids);
    if (error && !isMissingObject(error)) throw error;
  }

  // --- history + notifications ----------------------------------------------
  const persisted = await rows<{ id: string; fingerprint: string; rule_type: AlertRuleType }>(
    sbOf(ctx)
      .from("portfolio_alerts")
      .select("id, fingerprint, rule_type")
      .eq("company_id", companyId)
      .in("fingerprint", candidates.length > 0 ? candidates.map((c) => c.fingerprint) : ["__none__"]),
  );
  const idByFingerprint = new Map(persisted.map((p) => [p.fingerprint, p.id]));

  for (const c of candidates) {
    const id = idByFingerprint.get(c.fingerprint);
    if (!id) continue;
    const kind = notifyOf.find((n) => n.candidate.fingerprint === c.fingerprint)?.kind;
    events.push({
      alert_id: id,
      company_id: companyId,
      event_type: kind ?? "seen",
      actor_id: opts.actorId ?? null,
      severity: c.severity,
      metadata: {
        rule_type: c.rule_type,
        current_value: c.current_value,
        threshold_value: c.threshold_value,
        unit: c.value_unit,
      },
    });
  }
  for (const e of toResolve) {
    events.push({
      alert_id: e.id,
      company_id: companyId,
      event_type: "resolved",
      actor_id: opts.actorId ?? null,
      severity: e.severity,
      metadata: { rule_type: e.rule_type, auto: true },
    });
  }
  for (const [tier, ids] of escalations) {
    for (const id of ids) {
      events.push({
        alert_id: id,
        company_id: companyId,
        event_type: "escalated",
        actor_id: null,
        metadata: { tier },
      });
    }
  }

  let notified = 0;
  if (opts.notify !== false && (notifyOf.length > 0 || escalations.size > 0)) {
    notified = await dispatchNotifications(ctx, companyId, {
      configs,
      created: notifyOf,
      escalatedIds: [...escalations.values()].flat(),
      alertsById: new Map(existing.map((e) => [e.id, e])),
      idByFingerprint,
      period,
    });
  }

  if (events.length > 0) {
    const { error } = await sbOf(ctx).from("portfolio_alert_events").insert(events);
    if (error && !isMissingObject(error)) throw error;
  }

  await writeAudit(ctx, companyId, "costing.portfolio.alerts_evaluated", null, {
    company_id: companyId,
    period,
    evaluated: candidates.length,
    created,
    reopened: reopenedCount,
    resolved: toResolve.length,
    escalated,
    notified,
  });

  return {
    company_id: companyId,
    period,
    evaluated: candidates.length,
    created,
    reopened: reopenedCount,
    updated,
    resolved: toResolve.length,
    escalated,
    notified,
  };
}

// ---------------------------------------------------------------------------
// Routing — least privilege, company/project scoped, set-based
// ---------------------------------------------------------------------------
async function dispatchNotifications(
  ctx: AuthContext,
  companyId: string,
  args: {
    configs: Record<AlertRuleType, AlertRuleConfig>;
    created: { candidate: AlertCandidate; kind: "created" | "reopened" }[];
    escalatedIds: string[];
    alertsById: Map<string, AlertRecord>;
    idByFingerprint: Map<string, string>;
    period: string;
  },
): Promise<number> {
  const notifyRoles = new Set<string>();
  for (const cfg of Object.values(args.configs)) {
    cfg.notify_roles.forEach((r) => notifyRoles.add(r));
    cfg.escalate_roles.forEach((r) => notifyRoles.add(r));
  }

  const [roleRows, memberRows] = await Promise.all([
    rows<{ user_id: string; role: string }>(
      sbOf(ctx)
        .from("user_roles")
        .select("user_id, role")
        .eq("company_id", companyId)
        .in("role", [...notifyRoles]),
    ),
    rows<{ user_id: string; project_id: string }>(
      sbOf(ctx).from("project_members").select("user_id, project_id"),
    ),
  ]);

  const usersByRole = new Map<string, string[]>();
  for (const r of roleRows) {
    usersByRole.set(r.role, [...(usersByRole.get(r.role) ?? []), r.user_id]);
  }
  const membersByProject = new Map<string, Set<string>>();
  for (const m of memberRows) {
    const set = membersByProject.get(m.project_id) ?? new Set<string>();
    set.add(m.user_id);
    membersByProject.set(m.project_id, set);
  }
  const inCompany = new Set(roleRows.map((r) => r.user_id));

  const notifications: Record<string, unknown>[] = [];
  const seenPairs = new Set<string>();
  const push = (
    userId: string,
    alertId: string,
    title: string,
    body: string,
    link: string,
    severity: string,
    kind: string,
  ) => {
    const key = `${userId}:${alertId}:${kind}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    notifications.push({
      user_id: userId,
      company_id: companyId,
      type: "portfolio.alert",
      title,
      body,
      link,
      metadata: { alert_id: alertId, severity, kind, period: args.period },
    });
  };

  for (const { candidate, kind } of args.created) {
    const alertId = args.idByFingerprint.get(candidate.fingerprint);
    if (!alertId) continue;
    const cfg = args.configs[candidate.rule_type];
    const recipients = new Set<string>();
    for (const role of cfg.notify_roles) {
      (usersByRole.get(role) ?? []).forEach((u) => recipients.add(u));
    }
    // Project cost owner / close checklist owner — only when in company scope.
    if (candidate.owner_id && inCompany.has(candidate.owner_id)) recipients.add(candidate.owner_id);
    if (candidate.project_id) {
      const members = membersByProject.get(candidate.project_id);
      if (candidate.owner_id && members?.has(candidate.owner_id)) recipients.add(candidate.owner_id);
    }
    const value =
      candidate.current_value === null
        ? "n/a"
        : candidate.value_unit === "percent" || candidate.value_unit === "ratio"
          ? `${(candidate.current_value * 100).toFixed(1)}%`
          : `${candidate.current_value} ${candidate.value_unit}`;
    const threshold =
      candidate.threshold_value === null
        ? "n/a"
        : candidate.value_unit === "percent" || candidate.value_unit === "ratio"
          ? `${(candidate.threshold_value * 100).toFixed(1)}%`
          : `${candidate.threshold_value} ${candidate.value_unit}`;
    const body =
      `${candidate.detail} Current ${value} vs threshold ${threshold} for ${args.period}. ` +
      `Acknowledge within ${cfg.ack_sla_hours}h.`;
    for (const uid of recipients) {
      push(
        uid,
        alertId,
        `${kind === "reopened" ? "Reopened" : "New"} ${candidate.severity} finance alert`,
        body,
        candidate.deep_link,
        candidate.severity,
        kind,
      );
    }
  }

  for (const alertId of args.escalatedIds) {
    const alert = args.alertsById.get(alertId);
    if (!alert) continue;
    const cfg = args.configs[alert.rule_type];
    const recipients = new Set<string>();
    for (const role of cfg.escalate_roles) {
      (usersByRole.get(role) ?? []).forEach((u) => recipients.add(u));
    }
    for (const uid of recipients) {
      push(
        uid,
        alertId,
        `Escalated finance alert: ${alert.title}`,
        `Unacknowledged past the ${cfg.ack_sla_hours}h SLA for ${args.period}. ${alert.detail ?? ""}`,
        alert.deep_link ?? "/portfolio/costing/alerts",
        alert.severity,
        "escalated",
      );
    }
  }

  if (notifications.length === 0) return 0;
  const { error } = await sbOf(ctx).from("notifications").insert(notifications);
  if (error && !isMissingObject(error)) throw error;
  return notifications.length;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
const AUDIT_METADATA_KEYS = new Set([
  "company_id",
  "project_id",
  "period",
  "rule_type",
  "severity",
  "status",
  "alert_id",
  "fingerprint",
  "current_value",
  "threshold_value",
  "unit",
  "evaluated",
  "created",
  "reopened",
  "resolved",
  "escalated",
  "notified",
  "rows",
  "enabled",
  "lead_days",
  "ack_sla_hours",
  "snoozed_until",
  "tier",
]);

/** Allowlisted metadata only — free-form notes never reach the audit trail. */
function redact(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => AUDIT_METADATA_KEYS.has(k)));
}

async function writeAudit(
  ctx: AuthContext,
  companyId: string,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  await costingAudit(ctx, action, "portfolio_alerts", entityId, {
    company_id: companyId,
    ...redact(metadata),
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface PortfolioAlertRow extends AlertRecord {
  project_code: string | null;
  project_name: string | null;
  owner_name: string | null;
  ack_overdue: boolean;
  age_days: number;
  effective_status: AlertRecord["status"];
}

export interface PortfolioAlertsData {
  company_id: string;
  now: string;
  alerts: PortfolioAlertRow[];
  total: number;
  page: number;
  page_size: number;
  summary: AlertSummary;
  trend: { date: string; opened: number; resolved: number }[];
  configs: AlertRuleConfig[];
  projects: { id: string; code: string; name: string }[];
  owners: { id: string; name: string }[];
  can_configure: boolean;
  rule_types: string[];
}

export async function requireAlertAccess(ctx: AuthContext): Promise<string> {
  if (!(await hasCloseRole(ctx))) {
    costingHttpError(403, "forbidden", "Portfolio finance alerts are restricted to finance leadership.");
  }
  return currentCompanyId(ctx);
}

function decorate(a: AlertRecord, nowIso: string): Omit<PortfolioAlertRow, "project_code" | "project_name" | "owner_name"> {
  const status = effectiveStatus(a, nowIso);
  return {
    ...a,
    effective_status: status,
    ack_overdue: isAckOverdue({ status, ack_due_at: a.ack_due_at }, nowIso),
    age_days: Math.max(
      0,
      Math.floor((Date.parse(nowIso) - Date.parse(a.first_seen_at)) / 86_400_000),
    ),
  };
}

export async function loadPortfolioAlerts(
  ctx: AuthContext,
  filter: AlertFilter,
): Promise<PortfolioAlertsData> {
  const companyId = await requireAlertAccess(ctx);
  const nowIso = new Date().toISOString();
  const from = (filter.page - 1) * filter.page_size;
  const to = from + filter.page_size - 1;

  let query = sbOf(ctx)
    .from("portfolio_alerts")
    .select(ALERT_COLUMNS, { count: "exact" })
    .eq("company_id", companyId)
    .order("severity", { ascending: true })
    .order("last_seen_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.severity) query = query.eq("severity", filter.severity);
  if (filter.rule_type) query = query.eq("rule_type", filter.rule_type);
  if (filter.project_id) query = query.eq("project_id", filter.project_id);
  if (filter.period) query = query.eq("period_month", filter.period);
  if (filter.owner_id) query = query.eq("owner_id", filter.owner_id);
  if (filter.min_age_days !== undefined) {
    query = query.lte(
      "first_seen_at",
      new Date(Date.parse(nowIso) - filter.min_age_days * 86_400_000).toISOString(),
    );
  }
  // Overdue acknowledgement is a set-based predicate, not a post-page filter,
  // so `count` always describes the same rows the page shows.
  if (filter.overdue_only) query = query.eq("status", "open").lt("ack_due_at", nowIso);

  const [pageRes, allRes, projectsRes, profilesRes, configs] = await Promise.all([
    query,
    sbOf(ctx)
      .from("portfolio_alerts")
      .select(
        "id, company_id, project_id, period_month, rule_type, fingerprint, severity, status, escalation_tier, value_unit, owner_id, first_seen_at, last_seen_at, occurrence_count, reopen_count, ack_due_at, snoozed_until, resolved_at, title",
      )
      .eq("company_id", companyId)
      .limit(5000),
    sbOf(ctx).from("projects").select("id, code, name").eq("company_id", companyId).order("code"),
    sbOf(ctx).from("profiles").select("id, full_name").eq("company_id", companyId),
    loadAlertConfigs(ctx, companyId),
  ]);
  if (pageRes.error && !isMissingObject(pageRes.error)) throw pageRes.error;

  const projects = (projectsRes.data ?? []) as { id: string; code: string; name: string }[];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const profiles = (profilesRes.data ?? []) as { id: string; full_name: string | null }[];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name ?? p.id]));

  const page = ((pageRes.data ?? []) as AlertRecord[]).map((a) => {
    const project = a.project_id ? (projectById.get(a.project_id) ?? null) : null;
    return {
      ...decorate(a, nowIso),
      project_code: project?.code ?? null,
      project_name: project?.name ?? null,
      owner_name: a.owner_id ? (nameById.get(a.owner_id) ?? null) : null,
    } satisfies PortfolioAlertRow;
  });

  const all = ((allRes.data ?? []) as AlertRecord[]).map((a) => ({
    ...a,
    context: {},
    detail: null,
    deep_link: null,
    entity_table: null,
    entity_id: null,
    current_value: null,
    threshold_value: null,
    currency_code: null,
    acknowledged_by: null,
    acknowledged_at: null,
    escalated_at: null,
  })) as AlertRecord[];

  const since = new Date(Date.parse(nowIso) - 7 * 86_400_000).toISOString();

  return {
    company_id: companyId,
    now: nowIso,
    alerts: page,
    total: (pageRes.count as number | null) ?? page.length,
    page: filter.page,
    page_size: filter.page_size,
    summary: summarize(all, nowIso, since),
    trend: buildTrend(all, nowIso),
    configs: ALERT_RULE_TYPES.map((r) => configs[r]),
    projects,
    owners: [...new Set(all.map((a) => a.owner_id).filter((x): x is string => Boolean(x)))]
      .map((id) => ({ id, name: nameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    can_configure: true,
    rule_types: [...ALERT_RULE_TYPES],
  };
}

/** 14-day opened/resolved counts, derived from the register's own timestamps. */
export function buildTrend(
  alerts: readonly AlertRecord[],
  nowIso: string,
): { date: string; opened: number; resolved: number }[] {
  const days: { date: string; opened: number; resolved: number }[] = [];
  const end = Date.parse(nowIso.slice(0, 10) + "T00:00:00Z");
  for (let i = 13; i >= 0; i -= 1) {
    days.push({ date: new Date(end - i * 86_400_000).toISOString().slice(0, 10), opened: 0, resolved: 0 });
  }
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const a of alerts) {
    const o = index.get(a.first_seen_at.slice(0, 10));
    if (o !== undefined) days[o]!.opened += 1;
    if (a.resolved_at) {
      const r = index.get(a.resolved_at.slice(0, 10));
      if (r !== undefined) days[r]!.resolved += 1;
    }
  }
  return days;
}

export async function loadAlertsCsv(
  ctx: AuthContext,
  filter: AlertFilter,
): Promise<{ filename: string; csv: string }> {
  const companyId = await requireAlertAccess(ctx);
  const payload = await loadPortfolioAlerts(ctx, { ...filter, page: 1, page_size: 200 });
  await writeAudit(ctx, companyId, "costing.portfolio.alerts_export", null, {
    rows: payload.alerts.length,
    period: filter.period ?? null,
  });
  return {
    filename: `portfolio-alerts-${filter.period ?? "all"}.csv`,
    csv: buildAlertCsv(payload.alerts),
  };
}

/** Compact appendix for the printable management pack. */
export async function loadAlertAppendix(
  ctx: AuthContext,
  period: string,
): Promise<{
  summary: AlertSummary;
  critical: PortfolioAlertRow[];
  generated_basis: { period: string; rules: number; enabled: number };
}> {
  const data = await loadPortfolioAlerts(ctx, {
    period,
    page: 1,
    page_size: 50,
  } as AlertFilter);
  const critical = data.alerts
    .filter(
      (a) =>
        a.effective_status !== "resolved" && (a.severity === "critical" || a.severity === "high"),
    )
    .slice(0, 20);
  return {
    summary: data.summary,
    critical,
    generated_basis: {
      period,
      rules: data.configs.length,
      enabled: data.configs.filter((c) => c.enabled).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Lifecycle mutations
// ---------------------------------------------------------------------------
async function loadOne(ctx: AuthContext, companyId: string, alertId: string): Promise<AlertRecord> {
  const { data, error } = await sbOf(ctx)
    .from("portfolio_alerts")
    .select(ALERT_COLUMNS)
    .eq("company_id", companyId)
    .eq("id", alertId)
    .maybeSingle();
  if (error) throw error;
  if (!data) costingHttpError(404, "not_found", "Alert not found.");
  return data as AlertRecord;
}

export async function acknowledgeAlert(
  ctx: AuthContext,
  alertId: string,
): Promise<{ ok: true; status: string }> {
  const companyId = await requireAlertAccess(ctx);
  const alert = await loadOne(ctx, companyId, alertId);
  const nowIso = new Date().toISOString();
  const { error } = await sbOf(ctx)
    .from("portfolio_alerts")
    .update({
      status: "acknowledged",
      acknowledged_by: ctx.user?.id ?? null,
      acknowledged_at: nowIso,
      snoozed_until: null,
    })
    .eq("id", alertId)
    .eq("company_id", companyId);
  if (error) throw error;
  await sbOf(ctx).from("portfolio_alert_events").insert({
    alert_id: alertId,
    company_id: companyId,
    event_type: "acknowledged",
    actor_id: ctx.user?.id ?? null,
    severity: alert.severity,
    metadata: { rule_type: alert.rule_type },
  });
  await writeAudit(ctx, companyId, "costing.portfolio.alert_acknowledged", alertId, {
    alert_id: alertId,
    rule_type: alert.rule_type,
    severity: alert.severity,
    period: alert.period_month,
  });
  return { ok: true, status: "acknowledged" };
}

export async function snoozeAlert(
  ctx: AuthContext,
  alertId: string,
  until: string,
): Promise<{ ok: true; status: string }> {
  const companyId = await requireAlertAccess(ctx);
  const alert = await loadOne(ctx, companyId, alertId);
  const ts = Date.parse(until);
  if (Number.isNaN(ts)) costingHttpError(400, "invalid_snooze", "Invalid snooze date.");
  if (ts <= Date.now()) costingHttpError(400, "invalid_snooze", "Snooze must be in the future.");
  if (ts > Date.now() + 90 * 86_400_000) {
    costingHttpError(400, "invalid_snooze", "Snooze cannot exceed 90 days.");
  }
  const iso = new Date(ts).toISOString();
  const { error } = await sbOf(ctx)
    .from("portfolio_alerts")
    .update({ status: "snoozed", snoozed_until: iso })
    .eq("id", alertId)
    .eq("company_id", companyId);
  if (error) throw error;
  await sbOf(ctx).from("portfolio_alert_events").insert({
    alert_id: alertId,
    company_id: companyId,
    event_type: "snoozed",
    actor_id: ctx.user?.id ?? null,
    severity: alert.severity,
    metadata: { snoozed_until: iso },
  });
  await writeAudit(ctx, companyId, "costing.portfolio.alert_snoozed", alertId, {
    alert_id: alertId,
    rule_type: alert.rule_type,
    snoozed_until: iso,
  });
  return { ok: true, status: "snoozed" };
}

export async function updateAlertConfig(
  ctx: AuthContext,
  input: AlertConfigUpdate,
): Promise<{ ok: true }> {
  const companyId = await requireAlertAccess(ctx);
  const { error } = await sbOf(ctx)
    .from("portfolio_alert_configs")
    .upsert(
      {
        company_id: companyId,
        rule_type: input.rule_type,
        enabled: input.enabled,
        severity: input.severity,
        threshold_value: input.threshold_value,
        lead_days: input.lead_days,
        ack_sla_hours: input.ack_sla_hours,
        notify_roles: input.notify_roles,
        escalate_roles: input.escalate_roles,
        updated_by: ctx.user?.id ?? null,
      },
      { onConflict: "company_id,rule_type" },
    );
  if (error) throw error;
  await writeAudit(ctx, companyId, "costing.portfolio.alert_config_updated", null, {
    rule_type: input.rule_type,
    enabled: input.enabled,
    severity: input.severity,
    threshold_value: input.threshold_value,
    lead_days: input.lead_days,
    ack_sla_hours: input.ack_sla_hours,
  });
  return { ok: true };
}

/** On-demand evaluation from an authorized finance session. */
export async function evaluateNow(
  ctx: AuthContext,
  period?: string,
): Promise<EvaluationResult> {
  const companyId = await requireAlertAccess(ctx);
  return evaluateCompanyAlerts(ctx, companyId, {
    period,
    actorId: ctx.user?.id ?? null,
  });
}
