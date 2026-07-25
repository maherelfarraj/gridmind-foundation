// P-072 — Schedule task align/list server functions.
// Full schedule CRUD lands in P-073; this file exposes just what the WBS
// alignment panel needs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import { scheduleTaskAssignSchema, type WbsDiscipline } from "@/lib/wbs-rules";

export interface ScheduleTaskAlignRow {
  id: string;
  name: string;
  discipline: WbsDiscipline | null;
  wbs_item_id: string | null;
  status: string;
  start_date: string;
  end_date: string;
  is_milestone: boolean;
}

const ASSIGN_ROLES = ["project_admin", "construction_admin", "company_admin"] as const;

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

async function audit(
  context: AuthContext,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "schedule_tasks",
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

export const getScheduleTaskAssignAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canAssign: boolean }> => {
    requireSupabaseAuth(context);
    return { canAssign: await hasAnyRole(context, ASSIGN_ROLES) };
  });

const listInput = z.object({ projectId: z.string().uuid() });

export const listScheduleTasksForAlign = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<ScheduleTaskAlignRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("schedule_tasks")
      .select("id, name, discipline, wbs_item_id, status, start_date, end_date, is_milestone")
      .eq("project_id", data.projectId)
      .order("start_date", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      discipline: r.discipline as WbsDiscipline | null,
      wbs_item_id: r.wbs_item_id,
      status: r.status,
      start_date: r.start_date,
      end_date: r.end_date,
      is_milestone: !!r.is_milestone,
    }));
  });

export const assignScheduleTask = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => scheduleTaskAssignSchema.parse(input))
  .handler(async ({ data, context }): Promise<ScheduleTaskAlignRow> => {
    requireSupabaseAuth(context);
    if (!(await hasAnyRole(context, ASSIGN_ROLES))) httpError(403, "forbidden");

    const { data: before } = await context.supabase
      .from("schedule_tasks")
      .select("id, discipline, wbs_item_id, project_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) httpError(404, "task_not_found");

    const { data: updated, error } = await context.supabase
      .from("schedule_tasks")
      .update({
        discipline: data.discipline,
        wbs_item_id: data.wbs_item_id,
      } as any)
      .eq("id", data.id)
      .select("id, name, discipline, wbs_item_id, status, start_date, end_date, is_milestone")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }

    await audit(context, "schedule_task.assign", data.id, {
      project_id: (before as any).project_id,
      from: {
        discipline: (before as any).discipline,
        wbs_item_id: (before as any).wbs_item_id,
      },
      to: {
        discipline: data.discipline,
        wbs_item_id: data.wbs_item_id,
      },
    });

    const r = updated as any;
    return {
      id: r.id,
      name: r.name,
      discipline: r.discipline as WbsDiscipline | null,
      wbs_item_id: r.wbs_item_id,
      status: r.status,
      start_date: r.start_date,
      end_date: r.end_date,
      is_milestone: !!r.is_milestone,
    };
  });
