// P-089 — QA/QC server functions. Helpers live in qaqc.rules.ts to avoid
// tss-serverfn-split ReferenceErrors from sibling declarations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  computeHeatmap,
  inspectionInput,
  inspectionUpdateInput,
  nextInspectionNumber,
  QAQC_DISCIPLINES,
  QAQC_RESULTS,
  type HeatmapSummary,
  type QaqcAttachment,
  type QaqcDiscipline,
  type QaqcResult,
} from "@/lib/qaqc.rules";

// ---------------------------------------------------------------------------
// row types
// ---------------------------------------------------------------------------
export interface InspectionRow {
  id: string;
  company_id: string;
  project_id: string;
  inspection_number: string;
  itp_reference: string | null;
  discipline: QaqcDiscipline;
  area: string;
  wbs_item_id: string | null;
  inspection_date: string;
  inspector_id: string | null;
  result: QaqcResult;
  rework_required: boolean;
  rework_notes: string | null;
  attachments: QaqcAttachment[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspectionListItem extends InspectionRow {
  project_name: string | null;
  project_code: string | null;
  inspector_email: string | null;
}

export interface InspectionDetail {
  inspection: InspectionListItem;
  permissions: { canEdit: boolean };
}

export interface QaqcProjectPick {
  id: string;
  name: string;
  code: string | null;
}

export interface InspectorPick {
  id: string;
  email: string | null;
}

// ---------------------------------------------------------------------------
// small helpers (no cross-fn sibling logic; only DB shims)
// ---------------------------------------------------------------------------
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
  const cid = (data as any)?.company_id as string | undefined;
  if (!cid) httpError(400, "no_company");
  return cid!;
}

async function currentRoles(context: AuthContext): Promise<string[]> {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.user!.id);
  if (error) throw error;
  return ((data ?? []) as { role: string }[]).map((r) => r.role);
}

const WRITE_ROLES = new Set([
  "construction_admin",
  "foreman",
  "field_technician",
  "company_admin",
]);
function canWrite(roles: string[]): boolean {
  return roles.some((r) => WRITE_ROLES.has(r));
}

async function audit(
  context: AuthContext,
  action: string,
  entity: string,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
}

async function allocateInspectionNumber(
  context: AuthContext,
  companyId: string,
): Promise<string> {
  const { data, error } = await context.supabase
    .from("qaqc_inspections")
    .select("inspection_number")
    .eq("company_id", companyId)
    .order("inspection_number", { ascending: false })
    .limit(200);
  if (error) throw error;
  const list = ((data ?? []) as { inspection_number: string }[]).map(
    (r) => r.inspection_number,
  );
  return nextInspectionNumber(list);
}

// ---------------------------------------------------------------------------
// pickers
// ---------------------------------------------------------------------------
export const listQaqcProjects = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<QaqcProjectPick[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("projects")
      .select("id, name, code")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;
    return (data ?? []) as QaqcProjectPick[];
  });

export const listInspectors = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<InspectorPick[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id, email")
      .eq("company_id", companyId)
      .order("email", { ascending: true });
    if (error) throw error;
    return (data ?? []) as InspectorPick[];
  });

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------
const listInput = z.object({
  projectId: z.string().uuid().nullable().optional(),
  discipline: z.enum(QAQC_DISCIPLINES).nullable().optional(),
  result: z.enum(QAQC_RESULTS).nullable().optional(),
  area: z.string().trim().max(200).nullable().optional(),
  reworkOnly: z.boolean().nullable().optional(),
  search: z.string().trim().max(200).nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const listInspections = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw ?? {}))
  .handler(async ({ data, context }): Promise<InspectionListItem[]> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    let q = context.supabase
      .from("qaqc_inspections")
      .select(
        "*, projects:project_id(name, code), inspector:inspector_id(email)",
      )
      .eq("company_id", companyId)
      .order("inspection_date", { ascending: false })
      .limit(500);
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.discipline) q = q.eq("discipline", data.discipline);
    if (data.result) q = q.eq("result", data.result);
    if (data.reworkOnly) q = q.eq("rework_required", true);
    if (data.area) q = q.eq("area", data.area);
    if (data.from) q = q.gte("inspection_date", data.from);
    if (data.to) q = q.lte("inspection_date", data.to);

    const { data: rows, error } = await q;
    if (error) throw error;
    const search = data.search?.toLowerCase() ?? "";
    return (rows ?? [])
      .map((r: any): InspectionListItem => ({
        ...(r as InspectionRow),
        attachments: (r.attachments ?? []) as QaqcAttachment[],
        project_name: r.projects?.name ?? null,
        project_code: r.projects?.code ?? null,
        inspector_email: r.inspector?.email ?? null,
      }))
      .filter((r) => {
        if (!search) return true;
        return (
          r.inspection_number.toLowerCase().includes(search) ||
          r.area.toLowerCase().includes(search) ||
          (r.itp_reference ?? "").toLowerCase().includes(search) ||
          (r.rework_notes ?? "").toLowerCase().includes(search)
        );
      });
  });

// ---------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------
export const getInspection = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }): Promise<InspectionDetail> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: row, error } = await context.supabase
      .from("qaqc_inspections")
      .select(
        "*, projects:project_id(name, code), inspector:inspector_id(email)",
      )
      .eq("company_id", companyId)
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) httpError(404, "inspection_not_found");
    const roles = await currentRoles(context);
    const inspection: InspectionListItem = {
      ...((row as unknown) as InspectionRow),
      attachments: ((row as any).attachments ?? []) as QaqcAttachment[],
      project_name: (row as any).projects?.name ?? null,
      project_code: (row as any).projects?.code ?? null,
      inspector_email: (row as any).inspector?.email ?? null,
    };
    return { inspection, permissions: { canEdit: canWrite(roles) } };
  });

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
export const createInspection = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionInput.parse(raw))
  .handler(async ({ data, context }): Promise<InspectionRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWrite(roles)) httpError(403, "forbidden");

    // verify project belongs to same company
    const { data: proj, error: pErr } = await context.supabase
      .from("projects")
      .select("id, company_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!proj || (proj as any).company_id !== companyId)
      httpError(400, "invalid_project");

    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const inspectionNumber = await allocateInspectionNumber(context, companyId);
      const insertRow = {
        company_id: companyId,
        project_id: data.projectId,
        inspection_number: inspectionNumber,
        itp_reference: data.itpReference ?? null,
        discipline: data.discipline,
        area: data.area,
        wbs_item_id: data.wbsItemId ?? null,
        inspection_date: data.inspectionDate,
        inspector_id: data.inspectorId ?? null,
        result: data.result ?? "pending",
        rework_required: data.reworkRequired ?? false,
        rework_notes: data.reworkNotes ?? null,
        attachments: (data.attachments ?? []) as any,
        created_by: context.user!.id,
      };
      const { data: inserted, error } = await context.supabase
        .from("qaqc_inspections")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (!error && inserted) {
        await audit(
          context,
          "qaqc.inspection_create",
          "qaqc_inspections",
          (inserted as any).id,
          {
            project_id: data.projectId,
            discipline: data.discipline,
            area: data.area,
            result: insertRow.result,
            rework_required: insertRow.rework_required,
          },
        );
        return {
          ...((inserted as unknown) as InspectionRow),
          attachments: ((inserted as any).attachments ?? []) as QaqcAttachment[],
        };
      }
      lastErr = error;
      // 23505 = unique violation → retry with a fresh number
      if ((error as any)?.code !== "23505") break;
    }
    throw lastErr ?? new Error("create_failed");
  });

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
export const updateInspection = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => inspectionUpdateInput.parse(raw))
  .handler(async ({ data, context }): Promise<InspectionRow> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const roles = await currentRoles(context);
    if (!canWrite(roles)) httpError(403, "forbidden");

    const patch: Record<string, unknown> = {};
    if (data.discipline !== undefined) patch.discipline = data.discipline;
    if (data.area !== undefined) patch.area = data.area;
    if (data.itpReference !== undefined)
      patch.itp_reference = data.itpReference ?? null;
    if (data.wbsItemId !== undefined) patch.wbs_item_id = data.wbsItemId ?? null;
    if (data.inspectionDate !== undefined)
      patch.inspection_date = data.inspectionDate;
    if (data.inspectorId !== undefined)
      patch.inspector_id = data.inspectorId ?? null;
    if (data.result !== undefined) patch.result = data.result;
    if (data.reworkRequired !== undefined)
      patch.rework_required = data.reworkRequired;
    if (data.reworkNotes !== undefined) patch.rework_notes = data.reworkNotes ?? null;
    if (data.attachments !== undefined) patch.attachments = data.attachments as any;

    const { data: updated, error } = await context.supabase
      .from("qaqc_inspections")
      .update(patch as any)
      .eq("id", data.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) httpError(404, "inspection_not_found");

    await audit(
      context,
      "qaqc.inspection_update",
      "qaqc_inspections",
      data.id,
      { fields: Object.keys(patch) },
    );

    return {
      ...(updated as InspectionRow),
      attachments: ((updated as any).attachments ?? []) as QaqcAttachment[],
    };
  });

// ---------------------------------------------------------------------------
// signed attachment
// ---------------------------------------------------------------------------
export const signInspectionAttachment = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ path: z.string().min(1) }).parse(raw),
  )
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    // Enforce that the signed path is inside the caller's company prefix.
    if (!data.path.startsWith(`${companyId}/`)) httpError(403, "forbidden_path");
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed?.signedUrl ?? null };
  });

// ---------------------------------------------------------------------------
// heatmap
// ---------------------------------------------------------------------------
const heatmapInput = z.object({
  projectId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getQaqcHeatmap = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => heatmapInput.parse(raw))
  .handler(async ({ data, context }): Promise<HeatmapSummary> => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context);
    const { data: rows, error } = await context.supabase
      .from("qaqc_inspections")
      .select("discipline, area, result, rework_required")
      .eq("company_id", companyId)
      .eq("project_id", data.projectId)
      .gte("inspection_date", data.from)
      .lte("inspection_date", data.to);
    if (error) throw error;
    return computeHeatmap(((rows ?? []) as any) as any);
  });
