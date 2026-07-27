// P-190 — Management of Change server-only helpers.
// Kept out of *.functions.ts so tss-serverfn-split cannot drop them.
import type { AuthContext } from "@/integrations/supabase/auth-attacher";
import type { Json } from "@/integrations/supabase/types";
import {
  ageBucket,
  ageDays,
  isOpen,
  presetSince,
  type AffectedSystem,
  type AgeBucket,
  type ListChangesInput,
} from "@/lib/moc.rules";

export const PAGE_SIZE = 25;

export function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function mocCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", context.user!.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as { company_id: string | null } | null)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

/** External viewers must never reach the MOC surfaces — they get a 404. */
export async function assertInternal(context: AuthContext): Promise<void> {
  const { data, error } = await context.supabase.rpc("is_external_viewer");
  if (error) throw error;
  if (data === true) httpError(404, "not_found");
}

export async function auditMoc(
  context: AuthContext,
  action: string,
  crId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "change_requests",
      p_entity_id: crId,
      p_metadata: metadata as never,
    });
  } catch {
    /* audit never breaks the primary operation */
  }
}

async function nameMap(
  context: AuthContext,
  ids: string[],
): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return new Map();
  const { data } = await context.supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", unique);
  const map = new Map<string, string | null>();
  for (const row of (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    email: string | null;
  }>) {
    map.set(row.id, row.full_name ?? row.email ?? null);
  }
  return map;
}

function escapeIlike(value: string): string {
  return value.replace(/[%_,()]/g, (m) => `\\${m}`);
}

/* -------------------------------------------------------------------------- */
/* Register                                                                    */
/* -------------------------------------------------------------------------- */

export interface ChangeRow {
  id: string;
  cr_number: string;
  title: string;
  change_type: string;
  status: string;
  project_id: string | null;
  project_name: string | null;
  originator_id: string | null;
  originator_name: string | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
  created_at: string;
  updated_at: string;
  age_days: number;
}

const REGISTER_COLUMNS =
  "id, cr_number, title, change_type, status, project_id, originator_id, cost_impact, schedule_impact_days, created_at, updated_at";

interface RawRegisterRow {
  id: string;
  cr_number: string;
  title: string;
  change_type: string;
  status: string;
  project_id: string | null;
  originator_id: string | null;
  cost_impact: number | null;
  schedule_impact_days: number | null;
  created_at: string;
  updated_at: string;
}

async function projectNames(
  context: AuthContext,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return new Map();
  const { data } = await context.supabase.from("projects").select("id, name").in("id", unique);
  return new Map(
    ((data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );
}

export async function listChanges(
  context: AuthContext,
  input: ListChangesInput,
): Promise<{ rows: ChangeRow[]; total: number; page: number; pageSize: number }> {
  const companyId = await mocCompanyId(context);
  let q = context.supabase
    .from("change_requests")
    .select(REGISTER_COLUMNS, { count: "exact" })
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (input.statuses.length > 0) q = q.in("status", input.statuses);
  if (input.changeType) q = q.eq("change_type", input.changeType);
  if (input.projectId) q = q.eq("project_id", input.projectId);
  const since = presetSince(input.datePreset);
  if (since) q = q.gte("created_at", since);
  if (input.search) {
    const s = escapeIlike(input.search);
    q = q.or(`title.ilike.%${s}%,cr_number.ilike.%${s}%`);
  }

  const from = (input.page - 1) * PAGE_SIZE;
  const { data, error, count } = await q.range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  const raw = (data ?? []) as unknown as RawRegisterRow[];
  const [names, projects] = await Promise.all([
    nameMap(
      context,
      raw.map((r) => r.originator_id ?? ""),
    ),
    projectNames(
      context,
      raw.map((r) => r.project_id),
    ),
  ]);

  return {
    rows: raw.map((r) => ({
      ...r,
      project_name: r.project_id ? (projects.get(r.project_id) ?? null) : null,
      originator_name: r.originator_id ? (names.get(r.originator_id) ?? null) : null,
      age_days: ageDays(r.created_at),
    })),
    total: count ?? 0,
    page: input.page,
    pageSize: PAGE_SIZE,
  };
}

export async function listProjectOptions(
  context: AuthContext,
): Promise<Array<{ id: string; name: string }>> {
  const companyId = await mocCompanyId(context);
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, name")
    .eq("company_id", companyId)
    .order("name", { ascending: true })
    .limit(300);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; name: string }>;
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

export interface ReviewerStep {
  step_order: number;
  role: string | null;
  sla_hours: number | null;
  approvers: Array<{
    id: string;
    approver_id: string;
    approver_name: string | null;
    status: string;
    comment: string | null;
    decided_at: string | null;
    due_at: string | null;
    is_me: boolean;
  }>;
}

export interface ChangeDetail {
  cr: {
    id: string;
    company_id: string;
    cr_number: string;
    title: string;
    description: string;
    reason: string;
    change_type: string;
    status: string;
    project_id: string | null;
    project_name: string | null;
    originator_id: string | null;
    originator_name: string | null;
    technical_impact: string | null;
    cost_impact: number | null;
    cost_impact_notes: string | null;
    schedule_impact_days: number | null;
    schedule_impact_notes: string | null;
    energy_yield_impact: string | null;
    contract_impact: string | null;
    hse_impact: string | null;
    affected_systems: AffectedSystem[];
    implementation_evidence: Array<Record<string, Json>>;
    updated_documents: string[];
    updated_asbuilts: string[];
    closure_notes: string | null;
    rejection_reason: string | null;
    approval_instance_id: string | null;
    submitted_at: string | null;
    approved_at: string | null;
    rejected_at: string | null;
    implemented_at: string | null;
    closed_at: string | null;
    created_at: string;
    updated_at: string;
  };
  instance: {
    id: string;
    status: string;
    current_step: number;
    sla_due_at: string | null;
    requested_at: string;
    completed_at: string | null;
    rule_key: string | null;
  } | null;
  steps: ReviewerStep[];
  /** The signed-in user's pending approval on the current step, if any. */
  myPendingApprovalId: string | null;
  audit: Array<{
    id: string;
    action: string;
    created_at: string;
    actor_id: string | null;
    actor_name: string | null;
    metadata: Json;
  }>;
  canEdit: boolean;
  isAdmin: boolean;
}

function asAffected(json: Json | null): AffectedSystem[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
      system: String(r.system ?? ""),
      entity_type: String(r.entity_type ?? ""),
      entity_id: String(r.entity_id ?? ""),
      note: String(r.note ?? ""),
    };
  });
}

function asStringList(json: Json | null): string[] {
  if (!Array.isArray(json)) return [];
  return json.map((v) => String(v));
}

export async function getChangeDetail(
  context: AuthContext,
  id: string,
): Promise<ChangeDetail> {
  const { data, error } = await context.supabase
    .from("change_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "not_found");
  const cr = data as unknown as Record<string, Json> & {
    id: string;
    company_id: string;
    status: string;
    originator_id: string | null;
    project_id: string | null;
    approval_instance_id: string | null;
  };

  const [{ data: adminFlag }, projects] = await Promise.all([
    context.supabase.rpc("has_company_role", { p_role: "company_admin" }),
    projectNames(context, [cr.project_id]),
  ]);
  const { data: projectAdminFlag } = await context.supabase.rpc("has_company_role", {
    p_role: "project_admin",
  });
  const isAdmin = adminFlag === true || projectAdminFlag === true;

  let instance: ChangeDetail["instance"] = null;
  let steps: ReviewerStep[] = [];
  let myPendingApprovalId: string | null = null;
  const approverIds: string[] = [];

  if (cr.approval_instance_id) {
    const { data: inst } = await context.supabase
      .from("approval_instances")
      .select("id, status, current_step, sla_due_at, requested_at, completed_at, rule_key, rule_id")
      .eq("id", cr.approval_instance_id)
      .maybeSingle();
    if (inst) {
      const i = inst as unknown as {
        id: string;
        status: string;
        current_step: number;
        sla_due_at: string | null;
        requested_at: string;
        completed_at: string | null;
        rule_key: string | null;
        rule_id: string | null;
      };
      instance = {
        id: i.id,
        status: i.status,
        current_step: i.current_step,
        sla_due_at: i.sla_due_at,
        requested_at: i.requested_at,
        completed_at: i.completed_at,
        rule_key: i.rule_key,
      };

      const [{ data: chain }, { data: appr }] = await Promise.all([
        i.rule_id
          ? context.supabase
              .from("approval_chain_steps")
              .select("step_order, role, sla_hours")
              .eq("rule_id", i.rule_id)
              .order("step_order", { ascending: true })
          : Promise.resolve({ data: [] as unknown }),
        context.supabase
          .from("approvals")
          .select("id, approver_id, status, comment, decided_at, due_at, step_order")
          .eq("instance_id", i.id)
          .order("step_order", { ascending: true }),
      ]);

      const chainRows = (chain ?? []) as Array<{
        step_order: number;
        role: string | null;
        sla_hours: number | null;
      }>;
      const apprRows = (appr ?? []) as Array<{
        id: string;
        approver_id: string;
        status: string;
        comment: string | null;
        decided_at: string | null;
        due_at: string | null;
        step_order: number;
      }>;
      approverIds.push(...apprRows.map((a) => a.approver_id));
      const names = await nameMap(context, approverIds);

      const orders = Array.from(
        new Set([...chainRows.map((c) => c.step_order), ...apprRows.map((a) => a.step_order)]),
      ).sort((a, b) => a - b);
      steps = orders.map((order) => {
        const meta = chainRows.find((c) => c.step_order === order);
        return {
          step_order: order,
          role: meta?.role ?? null,
          sla_hours: meta?.sla_hours ?? null,
          approvers: apprRows
            .filter((a) => a.step_order === order)
            .map((a) => ({
              id: a.id,
              approver_id: a.approver_id,
              approver_name: names.get(a.approver_id) ?? null,
              status: a.status,
              comment: a.comment,
              decided_at: a.decided_at,
              due_at: a.due_at,
              is_me: a.approver_id === context.user!.id,
            })),
        };
      });
      myPendingApprovalId =
        apprRows.find(
          (a) =>
            a.approver_id === context.user!.id &&
            a.status === "pending" &&
            a.step_order === i.current_step,
        )?.id ?? null;
    }
  }

  const { data: auditRows } = await context.supabase
    .from("audit_logs")
    .select("id, action, created_at, actor_id, metadata")
    .eq("entity", "change_requests")
    .eq("entity_id", id)
    .order("created_at", { ascending: false })
    .limit(200);
  const audits = (auditRows ?? []) as Array<{
    id: string;
    action: string;
    created_at: string;
    actor_id: string | null;
    metadata: Json;
  }>;
  const actorNames = await nameMap(context, [
    ...audits.map((a) => a.actor_id ?? ""),
    cr.originator_id ?? "",
  ]);

  return {
    cr: {
      id: cr.id,
      company_id: cr.company_id,
      cr_number: String(cr.cr_number ?? ""),
      title: String(cr.title ?? ""),
      description: String(cr.description ?? ""),
      reason: String(cr.reason ?? ""),
      change_type: String(cr.change_type ?? ""),
      status: cr.status,
      project_id: cr.project_id,
      project_name: cr.project_id ? (projects.get(cr.project_id) ?? null) : null,
      originator_id: cr.originator_id,
      originator_name: cr.originator_id ? (actorNames.get(cr.originator_id) ?? null) : null,
      technical_impact: (cr.technical_impact as string | null) ?? null,
      cost_impact: (cr.cost_impact as number | null) ?? null,
      cost_impact_notes: (cr.cost_impact_notes as string | null) ?? null,
      schedule_impact_days: (cr.schedule_impact_days as number | null) ?? null,
      schedule_impact_notes: (cr.schedule_impact_notes as string | null) ?? null,
      energy_yield_impact: (cr.energy_yield_impact as string | null) ?? null,
      contract_impact: (cr.contract_impact as string | null) ?? null,
      hse_impact: (cr.hse_impact as string | null) ?? null,
      affected_systems: asAffected(cr.affected_systems ?? null),
      implementation_evidence: Array.isArray(cr.implementation_evidence)
        ? (cr.implementation_evidence as Array<Record<string, Json>>)
        : [],
      updated_documents: asStringList(cr.updated_documents ?? null),
      updated_asbuilts: asStringList(cr.updated_asbuilts ?? null),
      closure_notes: (cr.closure_notes as string | null) ?? null,
      rejection_reason: (cr.rejection_reason as string | null) ?? null,
      approval_instance_id: cr.approval_instance_id,
      submitted_at: (cr.submitted_at as string | null) ?? null,
      approved_at: (cr.approved_at as string | null) ?? null,
      rejected_at: (cr.rejected_at as string | null) ?? null,
      implemented_at: (cr.implemented_at as string | null) ?? null,
      closed_at: (cr.closed_at as string | null) ?? null,
      created_at: String(cr.created_at),
      updated_at: String(cr.updated_at),
    },
    instance,
    steps,
    myPendingApprovalId,
    audit: audits.map((a) => ({
      ...a,
      actor_name: a.actor_id ? (actorNames.get(a.actor_id) ?? null) : null,
    })),
    canEdit:
      (cr.status === "draft" && cr.originator_id === context.user!.id) ||
      (cr.status === "draft" && isAdmin),
    isAdmin,
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export interface MocDashboard {
  byStatus: Record<string, number>;
  openCount: number;
  avgDaysToClose: number | null;
  openCostImpact: number;
  openScheduleDays: number;
  byType: Array<{ change_type: string; count: number }>;
  aging: Array<{ change_type: string; buckets: Record<AgeBucket, number> }>;
  byProject: Array<{
    project_id: string | null;
    project_name: string;
    openCost: number;
    closedCost: number;
    openDays: number;
    closedDays: number;
    openCount: number;
    closedCount: number;
  }>;
}

export async function loadDashboard(context: AuthContext): Promise<MocDashboard> {
  const companyId = await mocCompanyId(context);
  const { data, error } = await context.supabase
    .from("change_requests")
    .select(
      "id, change_type, status, project_id, cost_impact, schedule_impact_days, created_at, closed_at",
    )
    .eq("company_id", companyId)
    .limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    change_type: string;
    status: string;
    project_id: string | null;
    cost_impact: number | null;
    schedule_impact_days: number | null;
    created_at: string;
    closed_at: string | null;
  }>;

  const byStatus: Record<string, number> = {};
  const typeCounts = new Map<string, number>();
  const agingMap = new Map<string, Record<AgeBucket, number>>();
  const projectMap = new Map<
    string,
    {
      project_id: string | null;
      openCost: number;
      closedCost: number;
      openDays: number;
      closedDays: number;
      openCount: number;
      closedCount: number;
    }
  >();
  let openCostImpact = 0;
  let openScheduleDays = 0;
  let closedCount = 0;
  let closedDaysTotal = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const open = isOpen(r.status);
    if (open) {
      typeCounts.set(r.change_type, (typeCounts.get(r.change_type) ?? 0) + 1);
      const bucket = ageBucket(ageDays(r.created_at));
      const b = agingMap.get(r.change_type) ?? { "0-7": 0, "8-30": 0, "31-90": 0, ">90": 0 };
      b[bucket] += 1;
      agingMap.set(r.change_type, b);
      openCostImpact += r.cost_impact ?? 0;
      openScheduleDays += r.schedule_impact_days ?? 0;
    }
    if (r.status === "closed" && r.closed_at) {
      closedCount += 1;
      closedDaysTotal += ageDays(r.created_at, new Date(r.closed_at));
    }
    const key = r.project_id ?? "none";
    const p = projectMap.get(key) ?? {
      project_id: r.project_id,
      openCost: 0,
      closedCost: 0,
      openDays: 0,
      closedDays: 0,
      openCount: 0,
      closedCount: 0,
    };
    if (open) {
      p.openCost += r.cost_impact ?? 0;
      p.openDays += r.schedule_impact_days ?? 0;
      p.openCount += 1;
    } else {
      p.closedCost += r.cost_impact ?? 0;
      p.closedDays += r.schedule_impact_days ?? 0;
      p.closedCount += 1;
    }
    projectMap.set(key, p);
  }

  const projects = await projectNames(
    context,
    Array.from(projectMap.values()).map((p) => p.project_id),
  );

  return {
    byStatus,
    openCount: rows.filter((r) => isOpen(r.status)).length,
    avgDaysToClose: closedCount > 0 ? closedDaysTotal / closedCount : null,
    openCostImpact,
    openScheduleDays,
    byType: Array.from(typeCounts.entries())
      .map(([change_type, count]) => ({ change_type, count }))
      .sort((a, b) => b.count - a.count),
    aging: Array.from(agingMap.entries())
      .map(([change_type, buckets]) => ({ change_type, buckets }))
      .sort((a, b) => a.change_type.localeCompare(b.change_type)),
    byProject: Array.from(projectMap.values())
      .map((p) => ({
        ...p,
        project_name: p.project_id
          ? (projects.get(p.project_id) ?? "Unknown project")
          : "No project",
      }))
      .sort((a, b) => b.openCost - a.openCost),
  };
}

export async function openChangeCount(
  context: AuthContext,
  companyId: string,
): Promise<number> {
  const { count, error } = await context.supabase
    .from("change_requests")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .in("status", ["draft", "assessment", "approved", "implementing"]);
  if (error) return 0;
  return count ?? 0;
}
