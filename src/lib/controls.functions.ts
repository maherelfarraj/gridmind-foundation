// P-180 — Planning & controls server functions. Thin wrappers only; helpers
// live in controls.server.ts / controls.rules.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertRoles,
  audit,
  CONTROLS_WRITER_ROLES,
  CWP_WRITER_ROLES,
  hasAnyRole,
} from "@/lib/cwp.server";
import {
  buildBaselineCompare,
  buildProductivity,
  computeQuantityProgressFor,
  loadProjectOptions,
  recomputeCriticalPathFor,
} from "@/lib/controls.server";
import { CWP_STATUSES } from "@/lib/cwp.rules";

const uuid = z.string().uuid();

export interface CwpCardRow {
  id: string;
  project_id: string;
  cwp_number: string;
  title: string;
  description: string | null;
  discipline: string;
  area: string | null;
  status: string;
  weight: number;
  progress_pct: number;
  planned_start: string | null;
  planned_end: string | null;
  wbs_item_id: string | null;
  wbs: { code: string; name: string } | null;
}

export interface CwpTaskRow {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  progress_pct: number;
  status: string;
  is_critical: boolean;
}

export interface CwpHistoryRow {
  id: string;
  action: string;
  created_at: string;
  detail: string;
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listControlsProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return loadProjectOptions(context.supabase);
  });

export const getControlsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const [canWrite, canAdmin] = await Promise.all([
      hasAnyRole(context.supabase, CWP_WRITER_ROLES),
      hasAnyRole(context.supabase, CONTROLS_WRITER_ROLES),
    ]);
    return { canWrite, canAdmin };
  });

export const getCwpBoard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("construction_work_packages")
      .select("*, wbs:wbs_item_id(code, name)")
      .eq("project_id", data.projectId)
      .order("cwp_number", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as unknown as CwpCardRow[];
  });

export const setWorkPackageStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: uuid, status: z.enum(CWP_STATUSES) }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CWP_WRITER_ROLES);
    const { data: row, error } = await context.supabase
      .from("construction_work_packages")
      .update({ status: data.status } as never)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    await audit(context.supabase, "cwp.status_changed", "construction_work_packages", data.id, {
      status: data.status,
    });
    return row;
  });

export const getWorkPackageDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: cwp, error } = await context.supabase
      .from("construction_work_packages")
      .select("*, wbs:wbs_item_id(code, name)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    const { data: tasks, error: tErr } = await context.supabase
      .from("schedule_tasks")
      .select("id, name, start_date, end_date, progress_pct, status, is_critical")
      .eq("cwp_id", data.id)
      .order("start_date", { ascending: true });
    if (tErr) throw tErr;
    const { data: history, error: hErr } = await context.supabase
      .from("audit_logs")
      .select("id, action, metadata, created_at")
      .eq("entity", "construction_work_packages")
      .eq("entity_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (hErr) throw hErr;
    return {
      cwp: (cwp ?? null) as unknown as CwpCardRow | null,
      tasks: (tasks ?? []) as unknown as CwpTaskRow[],
      history: (
        (history ?? []) as Array<{
          id: string;
          action: string;
          created_at: string;
          metadata: unknown;
        }>
      ).map((h) => ({
        id: h.id,
        action: h.action,
        created_at: h.created_at,
        detail: h.metadata == null ? "" : JSON.stringify(h.metadata),
      })) as CwpHistoryRow[],
    };
  });

export const recomputeCriticalPath = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CONTROLS_WRITER_ROLES);
    const result = await recomputeCriticalPathFor(context.supabase, data.projectId);
    await audit(context.supabase, "cwp.critical_path_recomputed", "projects", data.projectId, {
      critical_count: result.criticalIds.length,
      updated: result.updated,
    });
    return result;
  });

export const getBaselineCompare = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid, baselineId: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return buildBaselineCompare(context.supabase, data.projectId, data.baselineId);
  });

export const listProjectBaselines = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("baseline_snapshots")
      .select("id, name, locked, locked_at, created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      name: string;
      locked: boolean;
      locked_at: string | null;
      created_at: string;
    }>;
  });

export const computeQuantityProgress = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ projectId: uuid }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, CONTROLS_WRITER_ROLES);
    const result = await computeQuantityProgressFor(context.supabase, data.projectId);
    await audit(context.supabase, "cwp.quantity_progress", "projects", data.projectId, {
      updated_cwps: result.updatedCwps,
      project_progress_pct: result.projectProgressPct,
    });
    return result;
  });

export const getProductivity = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        projectId: uuid,
        dimension: z.enum(["discipline", "area", "trade"]).default("discipline"),
        from: isoDate,
        to: isoDate,
        minCrew: z.number().int().min(0).max(9999).default(0),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return buildProductivity(
      context.supabase,
      data.projectId,
      data.dimension,
      data.from,
      data.to,
      data.minCrew,
    );
  });
