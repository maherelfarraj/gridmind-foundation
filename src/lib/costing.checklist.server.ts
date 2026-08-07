// GC-07 — Server-only layer for the Period Close Cockpit.
//
// Reuses the GC-03..GC-06 close primitives: `loadCostingClose` owns readiness,
// `transitionPeriod` owns the state machine, `costingAudit` owns the trail and
// `notifications` owns delivery. Nothing here recomputes cost math.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import {
  COSTING_CLOSE_ROLES,
  hasCloseRole,
  loadCostingClose,
  loadCostingSettings,
  type CostingCloseData,
} from "@/lib/costing.close.server";
import {
  CLOSE_POLICY_DEFAULTS,
  closeGate,
  exceptionSeeds,
  staleExceptionIds,
  type ChecklistItem,
  type CloseDetail,
  type CloseBlocker,
  type CloseException,
  type ClosePolicy,
  type ChecklistItemUpdateInput,
  type ExceptionResolveInput,
} from "@/lib/costing.checklist";
import { costingAudit, costingHttpError, loadCostingProject } from "@/lib/costing.server";

type Sb = {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
const sbOf = (ctx: AuthContext) => ctx.supabase as unknown as Sb;

/** A not-yet-migrated object must degrade to "no cockpit data", never a 500. */
function isMissingObject(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42883" || code === "PGRST202" || code === "PGRST205";
}

function rpcError(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message ?? fallback);
  const code =
    message.match(
      /(costing_[a-z_]+|checklist_item_not_found|costing_exception_not_found|forbidden)/,
    )?.[1] ?? fallback;
  costingHttpError(code === "forbidden" ? 403 : 409, code, message.replace(/^.*?:\s*/, ""));
}

// ---------------------------------------------------------------------------
// People + policy
// ---------------------------------------------------------------------------
export interface CockpitPerson {
  id: string;
  name: string;
  email: string | null;
}

export async function loadCompanyPeople(
  ctx: AuthContext,
  companyId: string,
): Promise<CockpitPerson[]> {
  const { data, error } = await sbOf(ctx)
    .from("profiles")
    .select("id, full_name, email")
    .eq("company_id", companyId)
    .order("full_name", { ascending: true });
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return ((data ?? []) as any[]).map((p) => ({
    id: p.id as string,
    name: (p.full_name as string | null) ?? (p.email as string | null) ?? p.id,
    email: (p.email as string | null) ?? null,
  }));
}

export async function loadClosePolicy(
  ctx: AuthContext,
  companyId: string,
): Promise<ClosePolicy> {
  const { data, error } = await sbOf(ctx)
    .from("costing_settings")
    .select("allow_self_review, block_on_warnings")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error && !isMissingObject(error)) throw error;
  return {
    allow_self_review: Boolean(data?.allow_self_review ?? CLOSE_POLICY_DEFAULTS.allow_self_review),
    block_on_warnings: Boolean(data?.block_on_warnings ?? CLOSE_POLICY_DEFAULTS.block_on_warnings),
  };
}

// ---------------------------------------------------------------------------
// Checklist + exceptions reads
// ---------------------------------------------------------------------------
export interface ChecklistRun {
  id: string;
  template_name: string;
  template_version: number;
  generated_at: string;
}

export interface EvidenceLink {
  id: string;
  item_id: string;
  document_id: string;
  label: string | null;
  uploaded_by: string | null;
  created_at: string;
  document_title: string | null;
  file_name: string | null;
}

export async function loadChecklist(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  period: string,
): Promise<{ run: ChecklistRun | null; items: ChecklistItem[]; evidence: EvidenceLink[] }> {
  const sb = sbOf(ctx);
  const runQ = await sb
    .from("costing_checklist_runs")
    .select("id, template_name, template_version, generated_at")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("period_month", period)
    .maybeSingle();
  if (runQ.error && !isMissingObject(runQ.error)) throw runQ.error;
  const run = (runQ.data ?? null) as ChecklistRun | null;
  if (!run) return { run: null, items: [], evidence: [] };

  const [itemsQ, evidenceQ] = await Promise.all([
    sb
      .from("costing_checklist_items")
      .select("*")
      .eq("run_id", run.id)
      .order("seq", { ascending: true }),
    sb
      .from("costing_checklist_evidence")
      .select("id, item_id, document_id, label, uploaded_by, created_at, documents(title, file_name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true }),
  ]);
  if (itemsQ.error) throw itemsQ.error;
  if (evidenceQ.error && !isMissingObject(evidenceQ.error)) throw evidenceQ.error;

  const evidence: EvidenceLink[] = ((evidenceQ.data ?? []) as any[]).map((e) => ({
    id: e.id,
    item_id: e.item_id,
    document_id: e.document_id,
    label: e.label ?? null,
    uploaded_by: e.uploaded_by ?? null,
    created_at: e.created_at,
    document_title: e.documents?.title ?? null,
    file_name: e.documents?.file_name ?? null,
  }));
  const counts = new Map<string, number>();
  for (const e of evidence) counts.set(e.item_id, (counts.get(e.item_id) ?? 0) + 1);

  const items: ChecklistItem[] = ((itemsQ.data ?? []) as any[]).map((i) => ({
    id: i.id,
    seq: Number(i.seq),
    category: i.category,
    title: i.title,
    instructions: i.instructions ?? null,
    is_required: Boolean(i.is_required),
    requires_evidence: Boolean(i.requires_evidence),
    owner_role: i.owner_role ?? null,
    due_date: i.due_date ?? null,
    status: i.status,
    assignee_id: i.assignee_id ?? null,
    reviewer_id: i.reviewer_id ?? null,
    notes: i.notes ?? null,
    completed_by: i.completed_by ?? null,
    completed_at: i.completed_at ?? null,
    reviewed_by: i.reviewed_by ?? null,
    reviewed_at: i.reviewed_at ?? null,
    waived_by: i.waived_by ?? null,
    waived_at: i.waived_at ?? null,
    waiver_reason: i.waiver_reason ?? null,
    ready_at: i.ready_at ?? null,
    row_version: Number(i.row_version ?? 1),
    evidence_count: counts.get(i.id) ?? 0,
  }));

  return { run, items, evidence: evidence.filter((e) => items.some((i) => i.id === e.item_id)) };
}

export async function loadExceptions(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  period: string,
): Promise<CloseException[]> {
  const { data, error } = await sbOf(ctx)
    .from("costing_exceptions")
    .select("*")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .eq("period_month", period)
    .order("severity", { ascending: true })
    .order("fingerprint", { ascending: true });
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return ((data ?? []) as any[]).map((e) => ({
    ...e,
    detail: (e.detail ?? {}) as CloseDetail,
    reopen_count: Number(e.reopen_count ?? 0),
    row_version: Number(e.row_version ?? 1),
  })) as CloseException[];
}

export interface AuditEvent {
  id: string;
  action: string;
  entity: string;
  entity_id: string | null;
  actor_id: string | null;
  created_at: string;
  metadata: CloseDetail;
}

const AUDIT_ENTITIES = [
  "costing_periods",
  "costing_checklist_items",
  "costing_exceptions",
  "forecast_versions",
];

export async function loadCloseAudit(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  period: string,
): Promise<AuditEvent[]> {
  const { data, error } = await sbOf(ctx)
    .from("audit_logs")
    .select("id, action, entity, entity_id, actor_id, created_at, metadata")
    .eq("company_id", companyId)
    .in("entity", AUDIT_ENTITIES)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
  return ((data ?? []) as any[])
    .map((r) => ({ ...r, metadata: (r.metadata ?? {}) as CloseDetail }))
    .filter((r) => {
      const m = r.metadata as { project_id?: string; period?: string };
      if (m.project_id && m.project_id !== projectId) return false;
      if (m.period && m.period !== period) return false;
      return Boolean(m.project_id) || Boolean(m.period);
    }) as AuditEvent[];
}

// ---------------------------------------------------------------------------
// Generation + exception sync
// ---------------------------------------------------------------------------
export async function ensureChecklist(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  period: string,
): Promise<string | null> {
  const { data, error } = await sbOf(ctx).rpc("ensure_costing_checklist", {
    p_company_id: companyId,
    p_project_id: projectId,
    p_period_month: period,
  });
  if (error) {
    if (isMissingObject(error)) return null;
    rpcError(error, "costing_checklist_generation_failed");
  }
  return (data as string | null) ?? null;
}

/**
 * Project the (already computed) readiness verdict into the durable exception
 * register. Idempotent: recurring findings update one row, cleared findings are
 * auto-resolved, and reopen history is preserved by the database function.
 */
export async function syncExceptions(
  ctx: AuthContext,
  close: CostingCloseData,
): Promise<{ upserted: number; autoResolved: number }> {
  const sb = sbOf(ctx);
  const companyId = close.project.company_id;
  const projectId = close.project.id;
  const period = close.focusPeriod;
  const seeds = exceptionSeeds(close.readiness.items);

  let upserted = 0;
  for (const seed of seeds) {
    const { error } = await sb.rpc("upsert_costing_exception", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_period_month: period,
      p_source: seed.source,
      p_exception_type: seed.exception_type,
      p_severity: seed.severity,
      p_fingerprint: seed.fingerprint,
      p_title: seed.title,
      p_detail: seed.detail,
      p_entity_table: null,
      p_entity_id: null,
    });
    if (error) {
      if (isMissingObject(error)) return { upserted: 0, autoResolved: 0 };
      throw error;
    }
    upserted += 1;
  }

  const existing = await loadExceptions(ctx, companyId, projectId, period);
  const stale = staleExceptionIds(existing, seeds);
  let autoResolved = 0;
  for (const id of stale) {
    const row = existing.find((e) => e.id === id)!;
    const { error } = await sb.rpc("resolve_costing_exception", {
      p_id: id,
      p_expected_version: row.row_version,
      p_status: "resolved",
      p_note: "Automatically resolved: the underlying readiness finding cleared.",
      p_owner_id: null,
      p_due_date: null,
    });
    if (!error) autoResolved += 1;
  }
  return { upserted, autoResolved };
}

// ---------------------------------------------------------------------------
// Cockpit read model
// ---------------------------------------------------------------------------
export interface CloseCockpitData {
  close: CostingCloseData;
  policy: ClosePolicy;
  run: ChecklistRun | null;
  items: ChecklistItem[];
  evidence: EvidenceLink[];
  exceptions: CloseException[];
  audit: AuditEvent[];
  people: CockpitPerson[];
  blockers: CloseBlocker[];
  gateReady: boolean;
  canManage: boolean;
  currentUserId: string | null;
  /** Server "today" in the company reporting timezone, for overdue math. */
  today: string;
}

export async function loadCloseCockpit(
  ctx: AuthContext,
  projectId: string,
  requestedPeriod?: string,
): Promise<CloseCockpitData> {
  const project = await loadCostingProject(ctx, projectId);
  const close = await loadCostingClose(ctx, projectId, requestedPeriod);

  // Soft lock is the trigger, but a late visit must still find its checklist.
  if (close.state !== "open") {
    await ensureChecklist(ctx, project.company_id, projectId, close.focusPeriod);
  }
  await syncExceptions(ctx, close);

  const settings = await loadCostingSettings(ctx, project.company_id);
  const [policy, checklist, exceptions, audit, people, canManage] = await Promise.all([
    loadClosePolicy(ctx, project.company_id),
    loadChecklist(ctx, project.company_id, projectId, close.focusPeriod),
    loadExceptions(ctx, project.company_id, projectId, close.focusPeriod),
    loadCloseAudit(ctx, project.company_id, projectId, close.focusPeriod),
    loadCompanyPeople(ctx, project.company_id),
    hasCloseRole(ctx),
  ]);

  const unexplained = close.versions.filter(
    (v) =>
      v.reporting_period === close.focusPeriod &&
      v.status === "submitted" &&
      !String(v.materiality_explanation ?? "").trim(),
  ).length;

  const gate = closeGate({
    items: checklist.items,
    exceptions,
    policy,
    unexplainedMaterialMovements: unexplained,
  });

  return {
    close,
    policy,
    run: checklist.run,
    items: checklist.items,
    evidence: checklist.evidence,
    exceptions,
    audit,
    people,
    blockers: gate.blockers,
    gateReady: gate.ready,
    canManage,
    currentUserId: ctx.user?.id ?? null,
    today: reportingToday(settings.reporting_timezone),
  };
}

/** Local copy to avoid pulling the whole periods module into this file. */
function reportingToday(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
async function notifyUsers(
  ctx: AuthContext,
  companyId: string,
  userIds: readonly string[],
  payload: {
    type: string;
    title: string;
    body: string;
    link: string;
    metadata: CloseDetail;
  },
): Promise<number> {
  const targets = [...new Set(userIds.filter(Boolean))];
  if (targets.length === 0) return 0;
  try {
    const sb = sbOf(ctx);
    const { data: existing } = await sb
      .from("notifications")
      .select("id")
      .eq("company_id", companyId)
      .eq("type", payload.type)
      .contains("metadata", payload.metadata)
      .limit(1);
    if ((existing ?? []).length > 0) return 0;
    await sb.from("notifications").insert(
      targets.map((uid) => ({
        company_id: companyId,
        user_id: uid,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        link: payload.link,
        metadata: payload.metadata,
      })),
    );
    return targets.length;
  } catch {
    return 0;
  }
}

async function closeRoleHolders(ctx: AuthContext, companyId: string): Promise<string[]> {
  try {
    const { data } = await sbOf(ctx)
      .from("user_roles")
      .select("user_id")
      .eq("company_id", companyId)
      .in("role", [...COSTING_CLOSE_ROLES]);
    return [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  } catch {
    return [];
  }
}

const cockpitLink = (projectId: string) => `/projects/${projectId}/costing/close`;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------
export async function updateChecklistItem(
  ctx: AuthContext,
  input: ChecklistItemUpdateInput,
): Promise<{ item: ChecklistItem; notified: number }> {
  const sb = sbOf(ctx);
  const { data, error } = await sb.rpc("update_costing_checklist_item", {
    p_item_id: input.itemId,
    p_expected_version: input.expectedVersion,
    p_status: input.status ?? null,
    p_assignee_id: input.assigneeId ?? null,
    p_reviewer_id: input.reviewerId ?? null,
    p_notes: input.notes ?? null,
    p_waiver_reason: input.waiverReason ?? null,
    p_clear_assignee: input.assigneeId === null,
  });
  if (error) rpcError(error, "costing_checklist_update_failed");

  const row = (Array.isArray(data) ? data[0] : data) as any;
  const item: ChecklistItem = {
    ...row,
    seq: Number(row.seq),
    row_version: Number(row.row_version ?? 1),
    evidence_count: 0,
  };

  await costingAudit(ctx, `costing.checklist.${item.status}`, "costing_checklist_items", item.id, {
    company_id: row.company_id,
    project_id: row.project_id,
    period: row.period_month,
    status: item.status,
    assignee_id: item.assignee_id,
    reviewer_id: item.reviewer_id,
    waiver_reason: item.waiver_reason,
    row_version: item.row_version,
  });

  let notified = 0;
  const base = { period: row.period_month, project_id: row.project_id, item_id: item.id };
  if (input.assigneeId && input.assigneeId !== ctx.user?.id) {
    notified += await notifyUsers(ctx, row.company_id, [input.assigneeId], {
      type: "costing.checklist.assigned",
      title: "Close task assigned to you",
      body: `${item.title} — ${String(row.period_month).slice(0, 7)}`,
      link: cockpitLink(row.project_id),
      metadata: { ...base, kind: "assigned", row_version: item.row_version },
    });
  }
  if (item.status === "ready_for_review") {
    const reviewers = item.reviewer_id
      ? [item.reviewer_id]
      : await closeRoleHolders(ctx, row.company_id);
    notified += await notifyUsers(ctx, row.company_id, reviewers, {
      type: "costing.checklist.ready",
      title: "Close task ready for review",
      body: `${item.title} — ${String(row.period_month).slice(0, 7)}`,
      link: cockpitLink(row.project_id),
      metadata: { ...base, kind: "ready", row_version: item.row_version },
    });
  }

  notified += await notifyCloseReady(ctx, row.company_id, row.project_id, row.period_month);
  return { item, notified };
}

export async function resolveException(
  ctx: AuthContext,
  input: ExceptionResolveInput,
): Promise<{ exception: CloseException; notified: number }> {
  const sb = sbOf(ctx);
  const { data, error } = await sb.rpc("resolve_costing_exception", {
    p_id: input.exceptionId,
    p_expected_version: input.expectedVersion,
    p_status: input.status,
    p_note: input.note ?? null,
    p_owner_id: input.ownerId ?? null,
    p_due_date: input.dueDate ?? null,
  });
  if (error) rpcError(error, "costing_exception_update_failed");

  const row = (Array.isArray(data) ? data[0] : data) as any;
  const exception = {
    ...row,
    detail: (row.detail ?? {}) as CloseDetail,
    reopen_count: Number(row.reopen_count ?? 0),
    row_version: Number(row.row_version ?? 1),
  } as CloseException;

  await costingAudit(
    ctx,
    `costing.exception.${exception.status}`,
    "costing_exceptions",
    exception.id,
    {
      company_id: row.company_id,
      project_id: row.project_id,
      period: row.period_month,
      severity: exception.severity,
      status: exception.status,
      note: exception.resolution_note,
      row_version: exception.row_version,
    },
  );

  let notified = 0;
  if (exception.severity === "blocker" && exception.status !== "open") {
    notified += await notifyUsers(ctx, row.company_id, await closeRoleHolders(ctx, row.company_id), {
      type: "costing.exception.updated",
      title: "Close blocker updated",
      body: `${exception.title} — ${exception.status}`,
      link: cockpitLink(row.project_id),
      metadata: {
        period: row.period_month,
        project_id: row.project_id,
        exception_id: exception.id,
        row_version: exception.row_version,
      },
    });
  }
  notified += await notifyCloseReady(ctx, row.company_id, row.project_id, row.period_month);
  return { exception, notified };
}

/** One deduplicated "close ready" ping per period, only once all gates clear. */
export async function notifyCloseReady(
  ctx: AuthContext,
  companyId: string,
  projectId: string,
  period: string,
): Promise<number> {
  try {
    const [policy, checklist, exceptions] = await Promise.all([
      loadClosePolicy(ctx, companyId),
      loadChecklist(ctx, companyId, projectId, period),
      loadExceptions(ctx, companyId, projectId, period),
    ]);
    const gate = closeGate({ items: checklist.items, exceptions, policy });
    if (!gate.ready || checklist.items.length === 0) return 0;
    return await notifyUsers(ctx, companyId, await closeRoleHolders(ctx, companyId), {
      type: "costing.close.ready",
      title: "Period ready to hard close",
      body: `All close blockers cleared for ${period.slice(0, 7)}.`,
      link: cockpitLink(projectId),
      // No row_version: exactly one ready ping per project-period.
      metadata: { period, project_id: projectId, kind: "close_ready" },
    });
  } catch {
    return 0;
  }
}

export async function linkEvidence(
  ctx: AuthContext,
  input: { itemId: string; documentId: string; label?: string | null },
): Promise<{ id: string }> {
  const sb = sbOf(ctx);
  const itemQ = await sb
    .from("costing_checklist_items")
    .select("id, company_id, project_id, period_month")
    .eq("id", input.itemId)
    .maybeSingle();
  if (itemQ.error) throw itemQ.error;
  if (!itemQ.data) costingHttpError(404, "checklist_item_not_found");

  const { data, error } = await sb
    .from("costing_checklist_evidence")
    .insert({
      item_id: input.itemId,
      company_id: itemQ.data.company_id,
      project_id: itemQ.data.project_id,
      document_id: input.documentId,
      label: input.label ?? null,
      uploaded_by: ctx.user?.id ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) rpcError(error, "costing_evidence_link_failed");

  await costingAudit(ctx, "costing.checklist.evidence.linked", "costing_checklist_items", input.itemId, {
    company_id: itemQ.data.company_id,
    project_id: itemQ.data.project_id,
    period: itemQ.data.period_month,
    document_id: input.documentId,
  });
  return { id: (data?.id as string) ?? "" };
}

export async function unlinkEvidence(
  ctx: AuthContext,
  evidenceId: string,
): Promise<{ ok: true }> {
  const sb = sbOf(ctx);
  const row = await sb
    .from("costing_checklist_evidence")
    .select("id, item_id, company_id, project_id, document_id")
    .eq("id", evidenceId)
    .maybeSingle();
  if (row.error) throw row.error;
  if (!row.data) costingHttpError(404, "costing_evidence_not_found");

  const { error } = await sb.from("costing_checklist_evidence").delete().eq("id", evidenceId);
  if (error) rpcError(error, "costing_evidence_unlink_failed");

  await costingAudit(
    ctx,
    "costing.checklist.evidence.unlinked",
    "costing_checklist_items",
    row.data.item_id,
    {
      company_id: row.data.company_id,
      project_id: row.data.project_id,
      document_id: row.data.document_id,
    },
  );
  return { ok: true };
}
