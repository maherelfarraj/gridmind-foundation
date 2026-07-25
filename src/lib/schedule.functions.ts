// P-073 — Schedule tasks + baselines server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  baselineCreateSchema,
  baselineDeleteSchema,
  baselineLockSchema,
  buildSnapshotEntries,
  scheduleTaskCreateSchema,
  scheduleTaskDeleteSchema,
  scheduleTaskUpdateSchema,
  wouldCreateCycle,
  type BaselineSnapshotEntry,
  type ScheduleTaskStatus,
} from "@/lib/schedule.rules";
import type { WbsDiscipline } from "@/lib/wbs-rules";

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------
export interface ScheduleTaskRow {
  id: string;
  company_id: string;
  project_id: string;
  wbs_item_id: string | null;
  name: string;
  discipline: WbsDiscipline | null;
  start_date: string;
  end_date: string;
  progress_pct: number;
  status: ScheduleTaskStatus;
  predecessor_ids: string[];
  is_milestone: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BaselineRow {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  snapshot: BaselineSnapshotEntry[];
  locked: boolean;
  locked_by: string | null;
  locked_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const WRITE_ROLES = ["project_admin", "construction_admin", "company_admin"] as const;

const LOCK_ROLES = ["project_admin", "company_admin"] as const;

// ---------------------------------------------------------------------------
// Local helpers (module-scope; matches project pattern in wbs.functions.ts)
// ---------------------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hasAnyRole(context: AuthContext, roles: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as any })),
  );
  return results.some((r) => Boolean(r?.data));
}

async function currentCompanyId(context: AuthContext): Promise<string> {
  const { data, error } = await context.supabase
    .from("profiles")
    .select("company_id")
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function loadProject(context: AuthContext, projectId: string) {
  const { data, error } = await context.supabase
    .from("projects")
    .select("id, company_id, name")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "project_not_found");
  return data as { id: string; company_id: string; name: string };
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

function toTaskRow(r: any): ScheduleTaskRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    wbs_item_id: r.wbs_item_id,
    name: r.name,
    discipline: r.discipline as WbsDiscipline | null,
    start_date: r.start_date,
    end_date: r.end_date,
    progress_pct: Number(r.progress_pct ?? 0),
    status: r.status,
    predecessor_ids: Array.isArray(r.predecessor_ids) ? [...r.predecessor_ids] : [],
    is_milestone: !!r.is_milestone,
    sort_order: r.sort_order ?? 0,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toBaselineRow(r: any): BaselineRow {
  const snap = Array.isArray(r.snapshot) ? (r.snapshot as BaselineSnapshotEntry[]) : [];
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    name: r.name,
    snapshot: snap,
    locked: !!r.locked,
    locked_by: r.locked_by,
    locked_at: r.locked_at,
    notes: r.notes,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------
export const getScheduleAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean; canLockBaseline: boolean }> => {
    requireSupabaseAuth(context);
    const [canWrite, canLock] = await Promise.all([
      hasAnyRole(context, WRITE_ROLES),
      hasAnyRole(context, LOCK_ROLES),
    ]);
    return { canWrite, canLockBaseline: canLock };
  });

// ---------------------------------------------------------------------------
// List tasks
// ---------------------------------------------------------------------------
const listInput = z.object({ projectId: z.string().uuid() });

export const listScheduleTasks = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<ScheduleTaskRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("schedule_tasks")
      .select("*")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true })
      .order("start_date", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toTaskRow);
  });

// ---------------------------------------------------------------------------
// Create task
// ---------------------------------------------------------------------------
export const createScheduleTask = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scheduleTaskCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScheduleTaskRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    const insert = {
      company_id: project.company_id,
      project_id: project.id,
      wbs_item_id: data.wbs_item_id ?? null,
      name: data.name.trim(),
      discipline: data.discipline ?? null,
      start_date: data.start_date,
      end_date: data.end_date,
      progress_pct: data.progress_pct,
      status: data.status,
      predecessor_ids: data.predecessor_ids ?? [],
      is_milestone: data.is_milestone,
      sort_order: data.sort_order ?? 0,
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("schedule_tasks")
      .insert(insert as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toTaskRow(inserted);
    await audit(context, "schedule_task.create", "schedule_tasks", row.id, {
      project_id: project.id,
      name: row.name,
      start_date: row.start_date,
      end_date: row.end_date,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Update task (with cycle check)
// ---------------------------------------------------------------------------
export const updateScheduleTask = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scheduleTaskUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScheduleTaskRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    // Load current task for project scope + existing values.
    const { data: current, error: curErr } = await context.supabase
      .from("schedule_tasks")
      .select("id, project_id, start_date, end_date, predecessor_ids")
      .eq("id", data.id)
      .maybeSingle();
    if (curErr) throw curErr;
    if (!current) httpError(404, "task_not_found");

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      patch[k] = typeof v === "string" ? v.trim() : v;
    }

    // Predecessor cycle check.
    if (Array.isArray(patch.predecessor_ids)) {
      const nextPreds = patch.predecessor_ids as string[];
      if (nextPreds.includes(data.id)) httpError(400, "predecessor_self");
      const { data: siblings, error: sErr } = await context.supabase
        .from("schedule_tasks")
        .select("id, predecessor_ids")
        .eq("project_id", (current as any).project_id);
      if (sErr) throw sErr;
      const cycle = wouldCreateCycle(
        data.id,
        nextPreds,
        ((siblings ?? []) as any[]).map((s) => ({
          id: s.id,
          predecessor_ids: (s.predecessor_ids ?? []) as string[],
        })),
      );
      if (cycle)
        httpError(
          400,
          "predecessor_cycle",
          "Predecessors would create a cycle (e.g. A → B → A). Remove the loop and try again.",
        );
    }

    // Range check when either date is patched.
    const nextStart = (patch.start_date as string | undefined) ?? (current as any).start_date;
    const nextEnd = (patch.end_date as string | undefined) ?? (current as any).end_date;
    if (nextEnd < nextStart) httpError(400, "invalid_range", "End must be on or after start");

    const { data: updated, error } = await context.supabase
      .from("schedule_tasks")
      .update(patch as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toTaskRow(updated);
    await audit(context, "schedule_task.update", "schedule_tasks", row.id, {
      project_id: (current as any).project_id,
      changes: Object.keys(patch),
    });
    return row;
  });

// ---------------------------------------------------------------------------
// Delete task
// ---------------------------------------------------------------------------
export const deleteScheduleTask = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scheduleTaskDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    const { data: current } = await context.supabase
      .from("schedule_tasks")
      .select("id, project_id, name")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) httpError(404, "task_not_found");

    const { error } = await context.supabase.from("schedule_tasks").delete().eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "schedule_task.delete", "schedule_tasks", data.id, {
      project_id: (current as any).project_id,
      name: (current as any).name,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------
export const listBaselines = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<BaselineRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("baseline_snapshots")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toBaselineRow);
  });

export const createBaseline = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => baselineCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<BaselineRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
    const project = await loadProject(context, data.projectId);

    // Auto-name Baseline N.
    let name = data.name?.trim();
    if (!name) {
      const { count } = await context.supabase
        .from("baseline_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("project_id", project.id);
      name = `Baseline ${(count ?? 0) + 1}`;
    }

    // Snapshot the current tasks (with WBS code, if any).
    const { data: tasks, error: tErr } = await context.supabase
      .from("schedule_tasks")
      .select("id, name, start_date, end_date, progress_pct, wbs_item:wbs_item_id(code)")
      .eq("project_id", project.id);
    if (tErr) throw tErr;

    const snapshot = buildSnapshotEntries(
      ((tasks ?? []) as any[]).map((t) => ({
        id: t.id,
        name: t.name,
        start_date: t.start_date,
        end_date: t.end_date,
        progress_pct: Number(t.progress_pct ?? 0),
        code: (t.wbs_item?.code ?? null) as string | null,
      })),
    );

    const { data: inserted, error } = await context.supabase
      .from("baseline_snapshots")
      .insert({
        company_id: project.company_id,
        project_id: project.id,
        name,
        snapshot: snapshot as any,
        notes: data.notes ?? null,
        created_by: (context as any).user.id,
      } as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toBaselineRow(inserted);
    await audit(context, "baseline.create", "baseline_snapshots", row.id, {
      project_id: project.id,
      name: row.name,
      task_count: snapshot.length,
    });
    return row;
  });

export const lockBaseline = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => baselineLockSchema.parse(input))
  .handler(async ({ data, context }): Promise<BaselineRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, LOCK_ROLES))) httpError(403, "forbidden");

    const { data: existing } = await context.supabase
      .from("baseline_snapshots")
      .select("id, project_id, locked, name")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) httpError(404, "baseline_not_found");
    if ((existing as any).locked) httpError(409, "already_locked");

    const { data: updated, error } = await context.supabase
      .from("baseline_snapshots")
      .update({
        locked: true,
        locked_by: (context as any).user.id,
        locked_at: new Date().toISOString(),
      } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toBaselineRow(updated);
    await audit(context, "baseline.lock", "baseline_snapshots", row.id, {
      project_id: (existing as any).project_id,
      name: row.name,
    });
    return row;
  });

export const deleteBaseline = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => baselineDeleteSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");

    const { data: existing } = await context.supabase
      .from("baseline_snapshots")
      .select("id, project_id, locked, name")
      .eq("id", data.id)
      .maybeSingle();
    if (!existing) httpError(404, "baseline_not_found");
    if ((existing as any).locked)
      httpError(
        409,
        "baseline_locked",
        "Locked baselines are immutable — you can’t delete or edit them.",
      );

    const { error } = await context.supabase.from("baseline_snapshots").delete().eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501")
        httpError(403, "baseline_locked", "Locked baselines are immutable and cannot be deleted.");
      throw error;
    }
    await audit(context, "baseline.delete", "baseline_snapshots", data.id, {
      project_id: (existing as any).project_id,
      name: (existing as any).name,
    });
    return { ok: true };
  });
