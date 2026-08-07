// GC-09 — Portfolio Audit Trail: pure catalogue, redaction, filtering and CSV.
//
// No calculations live here: the audit trail reports events that other modules
// already wrote to `audit_logs`. This module only classifies, redacts and
// formats them so the server never ships raw metadata to the browser.
import { z } from "zod";

export const AUDIT_SEVERITIES = ["critical", "warning", "info"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export const AUDIT_GROUPS = [
  "forecast",
  "snapshot",
  "fx",
  "period",
  "checklist",
  "exception",
  "evidence",
  "policy",
  "export",
  "view",
  "alert",
] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

export interface AuditActionSpec {
  action: string;
  group: AuditGroup;
  severity: AuditSeverity;
  /** An event of this action is expected to reference a concrete entity row. */
  expectsEntity: boolean;
}

/**
 * Allowlist of actions surfaced by the portfolio audit trail. Anything not
 * listed here is a different module's event and is never displayed, so new
 * event types must be added deliberately rather than leaking by accident.
 */
export const PORTFOLIO_AUDIT_ACTIONS: readonly AuditActionSpec[] = [
  // Forecast versions and snapshots
  {
    action: "costing.forecast_version.create",
    group: "snapshot",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.forecast_version.refresh",
    group: "snapshot",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.forecast_version.submit",
    group: "forecast",
    severity: "warning",
    expectsEntity: true,
  },
  {
    action: "costing.forecast_version.recall",
    group: "forecast",
    severity: "warning",
    expectsEntity: true,
  },
  {
    action: "costing.forecast_version.approve",
    group: "forecast",
    severity: "critical",
    expectsEntity: true,
  },
  { action: "costing.forecast.upsert", group: "forecast", severity: "info", expectsEntity: false },
  {
    action: "costing.forecast.delete",
    group: "forecast",
    severity: "warning",
    expectsEntity: false,
  },
  // FX
  { action: "fx.rate.manual_upsert", group: "fx", severity: "critical", expectsEntity: false },
  { action: "fx.import", group: "fx", severity: "info", expectsEntity: false },
  { action: "fx.settings.update", group: "fx", severity: "warning", expectsEntity: false },
  { action: "fx.alerts.settings_update", group: "fx", severity: "info", expectsEntity: false },
  // Period lifecycle
  { action: "period.close", group: "period", severity: "critical", expectsEntity: false },
  { action: "period.reopen", group: "period", severity: "critical", expectsEntity: false },
  {
    action: "costing.period.adjustment",
    group: "period",
    severity: "warning",
    expectsEntity: false,
  },
  { action: "costing.period.blocked", group: "period", severity: "warning", expectsEntity: false },
  { action: "costing.close.ready", group: "period", severity: "info", expectsEntity: false },
  { action: "costing.settings.update", group: "policy", severity: "warning", expectsEntity: false },
  // Checklist, exceptions, evidence
  {
    action: "costing.checklist.assigned",
    group: "checklist",
    severity: "info",
    expectsEntity: true,
  },
  { action: "costing.checklist.ready", group: "checklist", severity: "info", expectsEntity: true },
  {
    action: "costing.exception.updated",
    group: "exception",
    severity: "warning",
    expectsEntity: true,
  },
  {
    action: "costing.checklist.evidence.linked",
    group: "evidence",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.checklist.evidence.unlinked",
    group: "evidence",
    severity: "warning",
    expectsEntity: true,
  },
  { action: "costing.accrual.create", group: "forecast", severity: "info", expectsEntity: false },
  {
    action: "costing.accrual.reverse",
    group: "forecast",
    severity: "warning",
    expectsEntity: false,
  },
  // Reporting and views
  { action: "costing.portfolio.view", group: "export", severity: "info", expectsEntity: false },
  { action: "costing.portfolio.export", group: "export", severity: "info", expectsEntity: false },
  { action: "costing.portfolio.pack", group: "export", severity: "info", expectsEntity: false },
  { action: "costing.portfolio.view_saved", group: "view", severity: "info", expectsEntity: true },
  {
    action: "costing.portfolio.view_updated",
    group: "view",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.portfolio.view_shared",
    group: "view",
    severity: "warning",
    expectsEntity: true,
  },
  {
    action: "costing.portfolio.view_default",
    group: "view",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.portfolio.view_deleted",
    group: "view",
    severity: "warning",
    expectsEntity: true,
  },
  // GC-10 — finance alerts & escalations
  {
    action: "costing.portfolio.alerts_evaluated",
    group: "alert",
    severity: "info",
    expectsEntity: false,
  },
  {
    action: "costing.portfolio.alerts_export",
    group: "alert",
    severity: "info",
    expectsEntity: false,
  },
  {
    action: "costing.portfolio.alert_acknowledged",
    group: "alert",
    severity: "info",
    expectsEntity: true,
  },
  {
    action: "costing.portfolio.alert_snoozed",
    group: "alert",
    severity: "warning",
    expectsEntity: true,
  },
  {
    action: "costing.portfolio.alert_config_updated",
    group: "alert",
    severity: "warning",
    expectsEntity: false,
  },
] as const;

const SPEC_BY_ACTION = new Map(PORTFOLIO_AUDIT_ACTIONS.map((s) => [s.action, s]));

export const AUDIT_ACTION_KEYS = PORTFOLIO_AUDIT_ACTIONS.map((s) => s.action);

export function specOf(action: string): AuditActionSpec | null {
  return SPEC_BY_ACTION.get(action) ?? null;
}

export function isPortfolioAuditAction(action: string): boolean {
  return SPEC_BY_ACTION.has(action);
}

/**
 * Resolves action/group/severity filters into the single allowlist the query
 * sends to Postgres. Severity MUST be resolved here rather than filtered off
 * the returned page: filtering after `range()` would leave `count` describing
 * a different result set, so page totals and the "matching events" KPI would
 * disagree with the rows on screen.
 */
export function actionsForFilter(
  filter: Pick<Partial<AuditFilter>, "action" | "group" | "severity">,
): string[] {
  return PORTFOLIO_AUDIT_ACTIONS.filter(
    (s) =>
      (!filter.action || s.action === filter.action) &&
      (!filter.group || s.group === filter.group) &&
      (!filter.severity || s.severity === filter.severity),
  ).map((s) => s.action);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Server-side allowlist. Anything outside it never reaches the browser, so a
 * module that starts logging a token, payload or free-form body cannot leak it
 * through the audit trail.
 */
export const AUDIT_METADATA_ALLOWLIST = [
  "company_id",
  "project_id",
  "project_code",
  "period",
  "period_month",
  "reporting_period",
  "reporting_currency",
  "base_currency_code",
  "quote_currency_code",
  "currency",
  "basis",
  "rate",
  "rate_date",
  "as_of",
  "source",
  "state",
  "from_state",
  "to_state",
  "status",
  "from_status",
  "to_status",
  "severity",
  "version_no",
  "item_id",
  "exception_id",
  "exception_type",
  "document_id",
  "view_id",
  "view_name",
  "is_shared",
  "is_default",
  "projects",
  "included",
  "excluded",
  "count",
  "code",
  "reason",
  "note",
  "resolution_note",
  "waiver_reason",
  "materiality_explanation",
  "attempted_date",
  "filename",
  "rows",
  "correlation_id",
  "request_id",
  // GC-10 — finance alerts
  "alert_id",
  "rule_type",
  "fingerprint",
  "current_value",
  "threshold_value",
  "unit",
  "enabled",
  "lead_days",
  "ack_sla_hours",
  "snoozed_until",
  "tier",
  "evaluated",
  "created",
  "reopened",
  "resolved",
  "escalated",
  "notified",
] as const;

const ALLOWED = new Set<string>(AUDIT_METADATA_ALLOWLIST);

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

export type AuditMetaValue =
  | string
  | number
  | boolean
  | null
  | AuditMetaValue[]
  | { [key: string]: AuditMetaValue };

function redactValue(value: unknown, depth: number): AuditMetaValue {
  if (value === null || isScalar(value)) return value;
  if (Array.isArray(value)) {
    if (depth === 0) return `[${value.length}]`;
    return value.slice(0, 20).map((v) => redactValue(v, depth - 1));
  }
  if (typeof value === "object" && depth > 0) {
    return redactMetadata(value as Record<string, unknown>, depth - 1);
  }
  return null;
}

/** Keep only allowlisted keys with scalar/simple values; drop everything else. */
export function redactMetadata(metadata: unknown, depth = 1): Record<string, AuditMetaValue> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const out: Record<string, AuditMetaValue> = {};
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (!ALLOWED.has(k) && k !== "before" && k !== "after") continue;
    const redacted = redactValue(v, k === "before" || k === "after" ? 1 : depth);
    out[k] = redacted;
  }
  return out;
}

export interface AuditDiffLine {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

/** Structured diff from either an explicit before/after pair or from_/to_ keys. */
export function buildDiff(metadata: Record<string, AuditMetaValue>): AuditDiffLine[] {
  const lines: AuditDiffLine[] = [];
  const before = metadata["before"];
  const after = metadata["after"];
  if (before && after && typeof before === "object" && typeof after === "object") {
    const keys = [
      ...new Set([
        ...Object.keys(before as Record<string, AuditMetaValue>),
        ...Object.keys(after as Record<string, AuditMetaValue>),
      ]),
    ].sort();
    for (const key of keys) {
      const b = (before as Record<string, AuditMetaValue>)[key];
      const a = (after as Record<string, AuditMetaValue>)[key];
      if (b === a) continue;
      lines.push({
        field: key,
        before: isScalar(b) ? b : b === undefined ? null : null,
        after: isScalar(a) ? a : a === undefined ? null : null,
      });
    }
  }
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith("from_")) continue;
    const field = k.slice(5);
    const to = metadata[`to_${field}`];
    if (!isScalar(v) && v !== null) continue;
    lines.push({ field, before: (v as string | null) ?? null, after: isScalar(to) ? to : null });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

export const auditFilterSchema = z
  .object({
    from: isoDate,
    to: isoDate,
    actor: z.string().uuid().optional(),
    action: z.string().max(120).optional(),
    group: z.enum(AUDIT_GROUPS).optional(),
    project_id: z.string().uuid().optional(),
    entity: z.string().max(120).optional(),
    severity: z.enum(AUDIT_SEVERITIES).optional(),
    period: z
      .string()
      .regex(/^\d{4}-\d{2}-01$/)
      .optional(),
    correlation_id: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    page_size: z.coerce.number().int().min(10).max(200).default(50),
  })
  .strict();

export type AuditFilter = z.infer<typeof auditFilterSchema>;

export interface AuditEvent {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  group: AuditGroup;
  severity: AuditSeverity;
  entity: string;
  entity_id: string | null;
  company_id: string;
  project_id: string | null;
  project_code: string | null;
  period: string | null;
  reason: string | null;
  correlation_id: string | null;
  metadata: Record<string, AuditMetaValue>;
  diff: AuditDiffLine[];
  /** Set when a referenced project/entity can no longer be resolved. */
  gap: "unknown_project" | "missing_entity" | "unattributed" | null;
}

export interface AuditReconciliation {
  total: number;
  page_count: number;
  by_group: { group: AuditGroup; count: number }[];
  by_severity: { severity: AuditSeverity; count: number }[];
  actors: number;
  gaps: number;
  gap_kinds: { kind: NonNullable<AuditEvent["gap"]>; count: number }[];
}

export function reconcileAudit(events: readonly AuditEvent[], total: number): AuditReconciliation {
  const count = <T extends string>(pick: (e: AuditEvent) => T) => {
    const m = new Map<T, number>();
    for (const e of events) m.set(pick(e), (m.get(pick(e)) ?? 0) + 1);
    return m;
  };
  const groups = count((e) => e.group);
  const severities = count((e) => e.severity);
  const gapped = events.filter((e) => e.gap !== null);
  const gapKinds = new Map<NonNullable<AuditEvent["gap"]>, number>();
  for (const e of gapped) gapKinds.set(e.gap!, (gapKinds.get(e.gap!) ?? 0) + 1);
  return {
    total,
    page_count: events.length,
    by_group: [...groups.entries()]
      .map(([group, c]) => ({ group, count: c }))
      .sort((a, b) => b.count - a.count),
    by_severity: AUDIT_SEVERITIES.filter((s) => severities.has(s)).map((severity) => ({
      severity,
      count: severities.get(severity)!,
    })),
    actors: new Set(events.map((e) => e.actor_id).filter(Boolean)).size,
    gaps: gapped.length,
    gap_kinds: [...gapKinds.entries()].map(([kind, c]) => ({ kind, count: c })),
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const AUDIT_CSV_HEADER = [
  "timestamp",
  "actor",
  "action",
  "group",
  "severity",
  "entity",
  "entity_id",
  "project_code",
  "period",
  "reason",
  "diff",
  "correlation_id",
  "gap",
] as const;

/** Deterministic export: fixed column order, events already sorted by the server. */
export function buildAuditCsv(events: readonly AuditEvent[]): string {
  const lines = [AUDIT_CSV_HEADER.join(",")];
  for (const e of events) {
    lines.push(
      [
        e.created_at,
        e.actor_name ?? e.actor_id ?? "",
        e.action,
        e.group,
        e.severity,
        e.entity,
        e.entity_id ?? "",
        e.project_code ?? "",
        e.period ?? "",
        e.reason ?? "",
        e.diff.map((d) => `${d.field}: ${d.before ?? "—"} → ${d.after ?? "—"}`).join("; "),
        e.correlation_id ?? "",
        e.gap ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
