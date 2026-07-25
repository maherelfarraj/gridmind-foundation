// P-106 — Work orders server functions (auth-scoped RPC surface).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  captureLaborSchema,
  capturePartsSchema,
  computeTotalCost,
  laborLineSchema,
  partLineSchema,
  workOrderAssignSchema,
  workOrderCloseSchema,
  workOrderCreateSchema,
  workOrderStatusSchema,
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
  type LaborLine,
  type PartLine,
  type WorkOrderPriority,
  type WorkOrderStatus,
  type WorkOrderType,
} from "@/lib/work-orders.rules";
import { assertCanTransition, generateWoNumber } from "@/lib/work-orders.server";

// ---- helpers ---------------------------------------------------------------
function httpError(status: number, code: string, message?: string): never {
  throw Object.assign(new Error(message ?? code), {
    statusCode: status,
    body: JSON.stringify({ error: code, message: message ?? code }),
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function currentCompanyId(context: AuthContext): Promise<string> {
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

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) => context.supabase.rpc("has_company_role", { p_role: r as never })),
  );
  return results.some((r) => r.data === true);
}

async function assertWriter(context: AuthContext): Promise<void> {
  if (!(await hasAnyRole(context, ["om_admin", "company_admin"]))) {
    httpError(403, "forbidden_role");
  }
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
      p_entity: "work_orders",
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });
  } catch {
    /* best-effort */
  }
}

// ---- types -----------------------------------------------------------------
export interface WorkOrderRow {
  id: string;
  company_id: string;
  project_id: string;
  equipment_id: string | null;
  wo_number: string;
  title: string;
  description: string | null;
  type: WorkOrderType;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  assigned_to: string | null;
  scheduled_date: string | null;
  due_date: string | null;
  parts: PartLine[];
  labor: LaborLine[];
  total_cost: number;
  currency_code: string | null;
  failure_cause: string | null;
  resolution_notes: string | null;
  source: string;
  completed_at: string | null;
  closed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  equipment_tag?: string | null;
  assignee_name?: string | null;
  assignee_email?: string | null;
}

const SELECT_COLS =
  "*, project:projects(name), equipment:equipment_registry(tag), assignee:profiles!work_orders_assigned_to_fkey(full_name,email)";

function shapeRow(r: unknown): WorkOrderRow {
  const row = r as WorkOrderRow & {
    project?: { name: string } | null;
    equipment?: { tag: string } | null;
    assignee?: { full_name: string | null; email: string | null } | null;
  };
  return {
    ...row,
    total_cost: Number(row.total_cost ?? 0),
    parts: Array.isArray(row.parts) ? (row.parts as PartLine[]) : [],
    labor: Array.isArray(row.labor) ? (row.labor as LaborLine[]) : [],
    project_name: row.project?.name ?? null,
    equipment_tag: row.equipment?.tag ?? null,
    assignee_name: row.assignee?.full_name ?? null,
    assignee_email: row.assignee?.email ?? null,
  };
}

// ---- list / get ------------------------------------------------------------
export const listWorkOrders = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        project_id: z.string().uuid().optional(),
        status: z.enum(WORK_ORDER_STATUSES).optional(),
        assignee: z.string().uuid().optional(),
        q: z.string().trim().max(120).optional(),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("work_orders")
      .select(SELECT_COLS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (data.project_id) q = q.eq("project_id", data.project_id);
    if (data.status) q = q.eq("status", data.status);
    if (data.assignee) q = q.eq("assigned_to", data.assignee);
    if (data.q && data.q.length > 0) {
      const s = data.q.replace(/[%_]/g, "\\$&");
      q = q.or(`wo_number.ilike.%${s}%,title.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map(shapeRow);
  });

export const getWorkOrder = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: row, error } = await context.supabase
      .from("work_orders")
      .select(SELECT_COLS)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "not_found");
    return shapeRow(row);
  });

// ---- create ---------------------------------------------------------------
export const createWorkOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => workOrderCreateSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const companyId = await currentCompanyId(context);

    // Retry once on unique-conflict (extremely rare race on wo_number).
    let attempt = 0;
    let lastErr: unknown = null;
    while (attempt < 2) {
      const woNumber = await generateWoNumber(context.supabase, companyId);
      const payload = {
        company_id: companyId,
        project_id: data.project_id,
        equipment_id: data.equipment_id ?? null,
        wo_number: woNumber,
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        priority: data.priority,
        status: data.assigned_to ? "assigned" : "open",
        assigned_to: data.assigned_to ?? null,
        scheduled_date: data.scheduled_date ?? null,
        due_date: data.due_date ?? null,
        source: data.source ?? "manual",
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("work_orders")
        .insert(payload as never)
        .select(SELECT_COLS)
        .single();
      if (!error) {
        const row = shapeRow(inserted);
        await audit(context, "work_order.create", row.id, {
          wo_number: row.wo_number,
          type: row.type,
          priority: row.priority,
        });
        return row;
      }
      if ((error as { code?: string }).code === "23505") {
        attempt += 1;
        lastErr = error;
        continue;
      }
      throw error;
    }
    throw lastErr ?? new Error("failed_to_create_work_order");
  });

// ---- assign ---------------------------------------------------------------
export const assignWorkOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => workOrderAssignSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertWriter(context);
    const patch: Record<string, unknown> = { assigned_to: data.assigned_to };
    // if currently 'open' and we're assigning, promote status
    if (data.assigned_to) {
      const { data: current, error: e0 } = await context.supabase
        .from("work_orders")
        .select("status")
        .eq("id", data.id)
        .maybeSingle();
      if (e0) throw e0;
      const st = (current as { status: WorkOrderStatus } | null)?.status;
      if (st === "open") patch.status = "assigned";
    }
    const { data: updated, error } = await context.supabase
      .from("work_orders")
      .update(patch as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "work_order.assign", row.id, {
      wo_number: row.wo_number,
      assigned_to: row.assigned_to,
    });
    return row;
  });

// ---- status ---------------------------------------------------------------
export const updateWorkOrderStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => workOrderStatusSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    // RLS enforces "writer OR technician-own"; server also validates transitions.
    const { data: current, error: e0 } = await context.supabase
      .from("work_orders")
      .select("status,type,wo_number,resolution_notes,failure_cause")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!current) httpError(404, "not_found");
    const cur = current as {
      status: WorkOrderStatus;
      type: WorkOrderType;
      wo_number: string;
      resolution_notes: string | null;
      failure_cause: string | null;
    };
    assertCanTransition(cur.status, data.status);
    // completing/closing require the close flow — refuse here.
    if (data.status === "closed") httpError(400, "use_close_endpoint");
    if (data.status === "completed" && !cur.resolution_notes) {
      httpError(400, "resolution_notes_required");
    }
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "completed") patch.completed_at = new Date().toISOString();
    const { data: updated, error } = await context.supabase
      .from("work_orders")
      .update(patch as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "work_order.status", row.id, {
      wo_number: row.wo_number,
      from: cur.status,
      to: row.status,
    });
    return row;
  });

// ---- parts / labor capture -----------------------------------------------
export const captureParts = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => capturePartsSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: current, error: e0 } = await context.supabase
      .from("work_orders")
      .select("labor,wo_number")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!current) httpError(404, "not_found");
    const laborRaw = (current as { labor: unknown }).labor;
    const labor = Array.isArray(laborRaw) ? (laborRaw as LaborLine[]) : [];
    // Re-parse to strip any junk fields.
    const cleanParts = data.parts.map((p) => partLineSchema.parse(p));
    const total = computeTotalCost(cleanParts, labor);
    const { data: updated, error } = await context.supabase
      .from("work_orders")
      .update({
        parts: cleanParts as never,
        total_cost: total,
      } as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "work_order.parts", row.id, {
      wo_number: row.wo_number,
      lines: cleanParts.length,
      total_cost: total,
    });
    // TODO(P-108): decrement spare_parts.stock_on_hand for lines with spare_part_id.
    return row;
  });

export const captureLabor = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => captureLaborSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: current, error: e0 } = await context.supabase
      .from("work_orders")
      .select("parts,wo_number")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!current) httpError(404, "not_found");
    const partsRaw = (current as { parts: unknown }).parts;
    const parts = Array.isArray(partsRaw) ? (partsRaw as PartLine[]) : [];
    const cleanLabor = data.labor.map((l) => laborLineSchema.parse(l));
    const total = computeTotalCost(parts, cleanLabor);
    const { data: updated, error } = await context.supabase
      .from("work_orders")
      .update({
        labor: cleanLabor as never,
        total_cost: total,
      } as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "work_order.labor", row.id, {
      wo_number: row.wo_number,
      lines: cleanLabor.length,
      total_cost: total,
    });
    return row;
  });

// ---- close ---------------------------------------------------------------
export const closeWorkOrder = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => workOrderCloseSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: current, error: e0 } = await context.supabase
      .from("work_orders")
      .select("status,type,wo_number,completed_at")
      .eq("id", data.id)
      .maybeSingle();
    if (e0) throw e0;
    if (!current) httpError(404, "not_found");
    const cur = current as {
      status: WorkOrderStatus;
      type: WorkOrderType;
      wo_number: string;
      completed_at: string | null;
    };
    if (cur.status !== "completed" && cur.status !== "in_progress") {
      httpError(400, "must_be_completed_or_in_progress");
    }
    if (cur.type === "corrective" && !data.failure_cause) {
      httpError(400, "failure_cause_required");
    }
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      status: "closed",
      resolution_notes: data.resolution_notes,
      failure_cause: data.failure_cause ?? null,
      completed_at: cur.completed_at ?? now,
      closed_at: now,
    };
    const { data: updated, error } = await context.supabase
      .from("work_orders")
      .update(patch as never)
      .eq("id", data.id)
      .select(SELECT_COLS)
      .single();
    if (error) throw error;
    const row = shapeRow(updated);
    await audit(context, "work_order.close", row.id, {
      wo_number: row.wo_number,
      type: row.type,
    });
    return row;
  });

// ---- assignee picker -----------------------------------------------------
export const listAssignees = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>;
  });

export const listWorkOrderProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as Array<{ id: string; name: string }>;
  });

export const listEquipmentForProject = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid() }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("equipment_registry")
      .select("id, tag, manufacturer, model")
      .eq("project_id", data.project_id)
      .order("tag", { ascending: true });
    if (error) throw error;
    return (rows ?? []) as Array<{
      id: string;
      tag: string;
      manufacturer: string | null;
      model: string | null;
    }>;
  });

// ---- KPIs ---------------------------------------------------------------
export interface WorkOrderKpis {
  pmRatio: number | null; // 0..1
  pmCount: number;
  cmCount: number;
  mttrHours: number | null;
  correctiveClosed: number;
  windowDays: number;
}

export const getWorkOrderKpis = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ project_id: z.string().uuid().optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<WorkOrderKpis> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const windowDays = 90;
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    let q = context.supabase
      .from("work_orders")
      .select("type,status,created_at,completed_at,closed_at")
      .eq("company_id", companyId)
      .eq("status", "closed")
      .gte("closed_at", windowStart);
    if (data.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows, error } = await q;
    if (error) throw error;
    const closed = (rows ?? []) as Array<{
      type: WorkOrderType;
      status: WorkOrderStatus;
      created_at: string;
      completed_at: string | null;
      closed_at: string | null;
    }>;
    const pmCount = closed.filter((r) => r.type === "preventive").length;
    const cmCount = closed.filter((r) => r.type === "corrective").length;
    const denom = pmCount + cmCount;
    const pmRatio = denom === 0 ? null : pmCount / denom;
    const correctives = closed.filter((r) => r.type === "corrective" && r.completed_at);
    let mttrHours: number | null = null;
    if (correctives.length > 0) {
      const sum = correctives.reduce((acc, r) => {
        const start = new Date(r.created_at).getTime();
        const end = new Date(r.completed_at as string).getTime();
        return acc + Math.max(0, (end - start) / 3_600_000);
      }, 0);
      mttrHours = Math.round((sum / correctives.length) * 10) / 10;
    }
    return {
      pmRatio,
      pmCount,
      cmCount,
      mttrHours,
      correctiveClosed: correctives.length,
      windowDays,
    };
  });

// Re-export enums for UI import ergonomics.
export {
  WORK_ORDER_PRIORITIES,
  WORK_ORDER_STATUSES,
  WORK_ORDER_TYPES,
} from "@/lib/work-orders.rules";
