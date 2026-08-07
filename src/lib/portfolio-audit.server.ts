// GC-09 — Portfolio Audit Trail: authorized, company-scoped, redacted reads.
//
// Reuses the existing immutable `audit_logs` trail. Nothing is written back
// here beyond the module's own view/export events, and no financial figure is
// recomputed — the trail reports what other modules already recorded.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import { hasCloseRole } from "@/lib/costing.close.server";
import { costingAudit, costingHttpError } from "@/lib/costing.server";
import {
  AUDIT_ACTION_KEYS,
  buildDiff,
  reconcileAudit,
  redactMetadata,
  specOf,
  type AuditEvent,
  type AuditFilter,
  type AuditReconciliation,
} from "@/lib/portfolio-audit.rules";
import { currentCompanyId } from "@/lib/portfolio-costing.server";

const sbOf = (ctx: AuthContext) => ctx.supabase as any;

export interface PortfolioAuditData {
  company_id: string;
  events: AuditEvent[];
  reconciliation: AuditReconciliation;
  page: number;
  page_size: number;
  actors: { id: string; name: string }[];
  projects: { id: string; code: string; name: string }[];
  actions: string[];
}

interface RawLog {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  company_id: string;
  metadata: Record<string, unknown> | null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function requirePortfolioAuditAccess(ctx: AuthContext): Promise<string> {
  if (!(await hasCloseRole(ctx))) {
    costingHttpError(
      403,
      "forbidden",
      "The portfolio audit trail is restricted to finance leadership.",
    );
  }
  return currentCompanyId(ctx);
}

/**
 * One set-based page query plus two small lookup queries — never per-event
 * fetches. Filtering happens in Postgres against the company/action/created_at
 * indexes added by GC-09.
 */
export async function loadPortfolioAudit(
  ctx: AuthContext,
  filter: AuditFilter,
): Promise<PortfolioAuditData> {
  const companyId = await requirePortfolioAuditAccess(ctx);

  const actions = filter.action
    ? AUDIT_ACTION_KEYS.filter((a) => a === filter.action)
    : filter.group
      ? AUDIT_ACTION_KEYS.filter((a) => specOf(a)?.group === filter.group)
      : AUDIT_ACTION_KEYS;

  const from = (filter.page - 1) * filter.page_size;
  const to = from + filter.page_size - 1;

  let query = sbOf(ctx)
    .from("audit_logs")
    .select("id, created_at, actor_id, action, entity, entity_id, company_id, metadata", {
      count: "exact",
    })
    .eq("company_id", companyId)
    .in("action", actions.length > 0 ? actions : ["__none__"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (filter.from) query = query.gte("created_at", `${filter.from}T00:00:00Z`);
  if (filter.to) query = query.lte("created_at", `${filter.to}T23:59:59.999Z`);
  if (filter.actor) query = query.eq("actor_id", filter.actor);
  if (filter.entity) query = query.eq("entity", filter.entity);
  if (filter.project_id) query = query.contains("metadata", { project_id: filter.project_id });
  if (filter.period) query = query.contains("metadata", { period: filter.period });
  if (filter.correlation_id)
    query = query.contains("metadata", { correlation_id: filter.correlation_id });

  const [{ data, error, count }, projectsRes, profilesRes] = await Promise.all([
    query,
    sbOf(ctx).from("projects").select("id, code, name").eq("company_id", companyId).order("code"),
    sbOf(ctx).from("profiles").select("id, full_name").eq("company_id", companyId),
  ]);
  if (error) throw error;

  const projects = (projectsRes.data ?? []) as { id: string; code: string; name: string }[];
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const profiles = (profilesRes.data ?? []) as { id: string; full_name: string | null }[];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name ?? null]));

  const raw = (data ?? []) as RawLog[];
  const events: AuditEvent[] = raw.map((log) => {
    const spec = specOf(log.action);
    const metadata = redactMetadata(log.metadata ?? {});
    const projectId = asString(metadata["project_id"]);
    const project = projectId ? (projectById.get(projectId) ?? null) : null;
    const gap: AuditEvent["gap"] =
      projectId && !project
        ? "unknown_project"
        : spec?.expectsEntity && !log.entity_id
          ? "missing_entity"
          : !log.actor_id
            ? "unattributed"
            : null;
    return {
      id: log.id,
      created_at: log.created_at,
      actor_id: log.actor_id,
      actor_name: log.actor_id ? (nameById.get(log.actor_id) ?? null) : null,
      action: log.action,
      group: spec?.group ?? "policy",
      severity: spec?.severity ?? "info",
      entity: log.entity,
      entity_id: log.entity_id,
      company_id: log.company_id,
      project_id: projectId,
      project_code: project?.code ?? null,
      period: asString(metadata["period"]) ?? asString(metadata["period_month"]),
      reason:
        asString(metadata["reason"]) ??
        asString(metadata["note"]) ??
        asString(metadata["resolution_note"]) ??
        asString(metadata["waiver_reason"]),
      correlation_id: asString(metadata["correlation_id"]) ?? asString(metadata["request_id"]),
      metadata,
      diff: buildDiff(metadata),
      gap,
    };
  });

  const filtered = filter.severity ? events.filter((e) => e.severity === filter.severity) : events;

  return {
    company_id: companyId,
    events: filtered,
    reconciliation: reconcileAudit(filtered, count ?? filtered.length),
    page: filter.page,
    page_size: filter.page_size,
    actors: profiles
      .map((p) => ({ id: p.id, name: p.full_name ?? p.id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    projects,
    actions: [...AUDIT_ACTION_KEYS],
  };
}

/** Compact appendix for the printable management pack. */
export async function loadAuditAppendix(
  ctx: AuthContext,
  period: string,
): Promise<{ events: AuditEvent[]; reconciliation: AuditReconciliation }> {
  const data = await loadPortfolioAudit(ctx, {
    period,
    page: 1,
    page_size: 25,
  } as AuditFilter);
  return { events: data.events, reconciliation: data.reconciliation };
}

export async function auditExportLogged(
  ctx: AuthContext,
  companyId: string,
  kind: "csv" | "pack",
  meta: Record<string, unknown>,
): Promise<void> {
  await costingAudit(
    ctx,
    kind === "csv" ? "costing.portfolio.export" : "costing.portfolio.pack",
    "audit_logs",
    null,
    { company_id: companyId, ...meta },
  );
}
