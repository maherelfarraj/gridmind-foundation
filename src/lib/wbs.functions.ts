// P-072 — WBS server functions.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  attachSupabaseAuth,
  requireSupabaseAuth,
  type AuthContext,
} from "@/integrations/supabase/auth-attacher";
import {
  wbsCreateSchema,
  wbsUpdateSchema,
  wbsReparentSchema,
  wbsImportIfcSchema,
  type WbsDiscipline,
  type WbsItemType,
} from "@/lib/wbs-rules";
import {
  buildIfcProposals,
  type IfcPackageProposal,
} from "@/lib/wbs.server";

// ---------------------------------------------------------------------------
// row shapes
// ---------------------------------------------------------------------------
export interface WbsItemRow {
  id: string;
  company_id: string;
  project_id: string;
  parent_id: string | null;
  code: string;
  name: string;
  item_type: WbsItemType;
  discipline: WbsDiscipline | null;
  description: string | null;
  sort_order: number;
  budgeted_amount: number | null;
  currency_code: string | null;
  ifc_package_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const WRITE_ROLES = ["project_admin", "finance_admin", "company_admin"] as const;

// ---------------------------------------------------------------------------
// helpers
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
    .eq("id", (context as any).user.id)
    .maybeSingle();
  if (error) throw error;
  const companyId = (data as any)?.company_id;
  if (!companyId) httpError(400, "no_company");
  return companyId as string;
}

async function hasAnyRole(
  context: AuthContext,
  roles: readonly string[],
): Promise<boolean> {
  const results = await Promise.all(
    roles.map((r) =>
      context.supabase.rpc("has_company_role", { p_role: r as any }),
    ),
  );
  return results.some((r) => Boolean(r?.data));
}

async function assertWrite(context: AuthContext) {
  if (!(await hasAnyRole(context, WRITE_ROLES))) httpError(403, "forbidden");
}

async function audit(
  context: AuthContext,
  action: string,
  entityId: string | null,
  metadata: Record<string, unknown>,
) {
  try {
    await context.supabase.rpc("write_audit_log", {
      p_action: action,
      p_entity: "wbs_items",
      p_entity_id: entityId as any,
      p_metadata: metadata as any,
    });
  } catch {
    /* best-effort */
  }
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

async function loadWbsItem(context: AuthContext, id: string) {
  const { data, error } = await context.supabase
    .from("wbs_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) httpError(404, "wbs_not_found");
  return data as WbsItemRow;
}

function toRow(r: any): WbsItemRow {
  return {
    id: r.id,
    company_id: r.company_id,
    project_id: r.project_id,
    parent_id: r.parent_id,
    code: r.code,
    name: r.name,
    item_type: r.item_type,
    discipline: r.discipline,
    description: r.description,
    sort_order: r.sort_order ?? 0,
    budgeted_amount:
      r.budgeted_amount == null ? null : Number(r.budgeted_amount),
    currency_code: r.currency_code,
    ifc_package_ref: r.ifc_package_ref,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ---------------------------------------------------------------------------
// access
// ---------------------------------------------------------------------------
export const getWbsAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await hasAnyRole(context, WRITE_ROLES) };
  });

// ---------------------------------------------------------------------------
// list tree
// ---------------------------------------------------------------------------
const listInput = z.object({ projectId: z.string().uuid() });

export const listWbsTree = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => listInput.parse(input))
  .handler(async ({ data, context }): Promise<WbsItemRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("wbs_items")
      .select("*")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toRow);
  });

// ---------------------------------------------------------------------------
// currencies (for editor select)
// ---------------------------------------------------------------------------
export const listCurrenciesForWbs = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<Array<{ code: string; name: string; symbol: string | null }>> => {
      requireSupabaseAuth(context);
      const { data, error } = await context.supabase
        .from("currencies")
        .select("code, name, symbol")
        .order("code", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as any[]).map((c) => ({
        code: c.code,
        name: c.name ?? c.code,
        symbol: c.symbol ?? null,
      }));
    },
  );

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------
export const createWbsItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => wbsCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<WbsItemRow> => {
    requireSupabaseAuth(context);
    await assertWrite(context);
    const project = await loadProject(context, data.projectId);

    const insertRow = {
      company_id: project.company_id,
      project_id: project.id,
      parent_id: data.parent_id ?? null,
      code: data.code.trim(),
      name: data.name.trim(),
      item_type: data.item_type,
      discipline: data.discipline ?? null,
      description: data.description ?? null,
      sort_order: data.sort_order ?? 0,
      budgeted_amount: data.budgeted_amount ?? null,
      currency_code: data.currency_code ?? null,
      ifc_package_ref: data.ifc_package_ref ?? null,
      created_by: (context as any).user.id,
    };

    const { data: inserted, error } = await context.supabase
      .from("wbs_items")
      .insert(insertRow as any)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "23505")
        httpError(409, "wbs_code_conflict", "Code already used in this project");
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRow(inserted);
    await audit(context, "wbs.create", row.id, {
      project_id: project.id,
      code: row.code,
      name: row.name,
      parent_id: row.parent_id,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------
export const updateWbsItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => wbsUpdateSchema.parse(input))
  .handler(async ({ data, context }): Promise<WbsItemRow> => {
    requireSupabaseAuth(context);
    await assertWrite(context);
    const existing = await loadWbsItem(context, data.id);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data.patch)) {
      if (v === undefined) continue;
      patch[k] = typeof v === "string" ? v.trim() : v;
    }
    const { data: updated, error } = await context.supabase
      .from("wbs_items")
      .update(patch as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "23505")
        httpError(409, "wbs_code_conflict", "Code already used in this project");
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRow(updated);
    await audit(context, "wbs.update", row.id, {
      project_id: existing.project_id,
      changes: Object.keys(patch),
    });
    return row;
  });

// ---------------------------------------------------------------------------
// reparent
// ---------------------------------------------------------------------------
export const reparentWbsItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => wbsReparentSchema.parse(input))
  .handler(async ({ data, context }): Promise<WbsItemRow> => {
    requireSupabaseAuth(context);
    await assertWrite(context);
    const existing = await loadWbsItem(context, data.id);

    // cycle check via ancestor walk
    if (data.parent_id) {
      if (data.parent_id === data.id) httpError(400, "wbs_cycle");
      let cursor: string | null = data.parent_id;
      const guard = new Set<string>();
      while (cursor) {
        if (cursor === data.id) httpError(400, "wbs_cycle");
        if (guard.has(cursor)) httpError(400, "wbs_cycle");
        guard.add(cursor);
        const { data: p } = await context.supabase
          .from("wbs_items")
          .select("parent_id")
          .eq("id", cursor)
          .maybeSingle();
        cursor = ((p as any)?.parent_id ?? null) as string | null;
      }
    }

    const { data: updated, error } = await context.supabase
      .from("wbs_items")
      .update({
        parent_id: data.parent_id,
        sort_order: data.sort_order ?? 0,
      } as any)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    const row = toRow(updated);
    await audit(context, "wbs.reparent", row.id, {
      project_id: existing.project_id,
      from: existing.parent_id,
      to: row.parent_id,
    });
    return row;
  });

// ---------------------------------------------------------------------------
// delete (blocked by dependencies)
// ---------------------------------------------------------------------------
const deleteInput = z.object({ id: z.string().uuid() });

export type DeleteWbsResult =
  | { ok: true }
  | {
      ok: false;
      error: "has_dependencies";
      counts: { children: number; tasks: number };
    };

export const deleteWbsItem = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => deleteInput.parse(input))
  .handler(async ({ data, context }): Promise<DeleteWbsResult> => {
    requireSupabaseAuth(context);
    await assertWrite(context);
    const existing = await loadWbsItem(context, data.id);

    const { count: childCount } = await context.supabase
      .from("wbs_items")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", data.id);
    const { count: taskCount } = await context.supabase
      .from("schedule_tasks")
      .select("id", { count: "exact", head: true })
      .eq("wbs_item_id", data.id);

    if ((childCount ?? 0) > 0 || (taskCount ?? 0) > 0) {
      return {
        ok: false,
        error: "has_dependencies",
        counts: {
          children: childCount ?? 0,
          tasks: taskCount ?? 0,
        },
      };
    }

    const { error } = await context.supabase
      .from("wbs_items")
      .delete()
      .eq("id", data.id);
    if (error) {
      if ((error as any).code === "42501") httpError(403, "forbidden");
      throw error;
    }
    await audit(context, "wbs.delete", data.id, {
      project_id: existing.project_id,
      code: existing.code,
    });
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// IFC package proposals + import
// ---------------------------------------------------------------------------
const proposeInput = z.object({ projectId: z.string().uuid() });

export const proposeIfcPackages = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => proposeInput.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ proposals: IfcPackageProposal[]; rootCode: string }> => {
      requireSupabaseAuth(context);

      // released IFC packages for this project
      const { data: releases, error: rErr } = await context.supabase
        .from("ifc_releases")
        .select("id, package_name, released_at, revision_snapshot")
        .eq("project_id", data.projectId)
        .eq("status", "released")
        .order("released_at", { ascending: true });
      if (rErr) throw rErr;

      // drawings for the project (for discipline mapping)
      const { data: drawings } = await context.supabase
        .from("drawing_register")
        .select("id, discipline, drawing_number, title")
        .eq("project_id", data.projectId);
      const drawingsById = new Map(
        ((drawings ?? []) as any[]).map((d) => [
          d.id as string,
          {
            discipline: (d.discipline ?? null) as string | null,
            drawing_number: d.drawing_number as string,
            title: d.title as string,
          },
        ]),
      );

      // existing WBS items to compute already-imported refs and used codes
      const { data: existing } = await context.supabase
        .from("wbs_items")
        .select("code, ifc_package_ref, parent_id")
        .eq("project_id", data.projectId);
      const alreadyImportedRefs = new Set(
        ((existing ?? []) as any[])
          .map((e) => e.ifc_package_ref)
          .filter((v): v is string => Boolean(v)),
      );
      const usedCodes = new Set(
        ((existing ?? []) as any[]).map((e) => e.code as string),
      );

      // pick or suggest the "Engineering" root code
      const engineeringRoot = ((existing ?? []) as any[]).find(
        (e) => e.parent_id === null && String(e.name ?? "").toLowerCase() === "engineering",
      );
      const rootCode = (engineeringRoot?.code as string | undefined) ?? "1";

      const proposals = buildIfcProposals(
        (releases ?? []) as any[],
        drawingsById,
        alreadyImportedRefs,
        usedCodes,
        rootCode,
      );
      return { proposals, rootCode };
    },
  );

export const importIfcPackages = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => wbsImportIfcSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ imported: number; root_id: string }> => {
      requireSupabaseAuth(context);
      await assertWrite(context);
      const project = await loadProject(context, data.projectId);

      // Ensure "Engineering" root exists.
      const { data: existingRoot } = await context.supabase
        .from("wbs_items")
        .select("id, code")
        .eq("project_id", project.id)
        .is("parent_id", null)
        .ilike("name", "Engineering")
        .maybeSingle();
      let rootId = (existingRoot as any)?.id as string | undefined;
      let rootCode = ((existingRoot as any)?.code as string | undefined) ?? "1";

      if (!rootId) {
        const { data: inserted, error: rootErr } = await context.supabase
          .from("wbs_items")
          .insert({
            company_id: project.company_id,
            project_id: project.id,
            parent_id: null,
            code: rootCode,
            name: "Engineering",
            item_type: "phase",
            sort_order: 0,
            created_by: (context as any).user.id,
          } as any)
          .select("id, code")
          .single();
        if (rootErr) {
          if ((rootErr as any).code === "42501") httpError(403, "forbidden");
          throw rootErr;
        }
        rootId = (inserted as any).id as string;
        rootCode = (inserted as any).code as string;
      }

      // Insert selected packages. Skip codes already present (idempotent).
      const { data: existingCodes } = await context.supabase
        .from("wbs_items")
        .select("code, ifc_package_ref")
        .eq("project_id", project.id);
      const usedCodes = new Set(
        ((existingCodes ?? []) as any[]).map((e) => e.code as string),
      );
      const importedRefs = new Set(
        ((existingCodes ?? []) as any[])
          .map((e) => e.ifc_package_ref)
          .filter((v): v is string => Boolean(v)),
      );

      const toInsert: any[] = [];
      for (const p of data.packages) {
        if (importedRefs.has(p.ifc_package_ref)) continue;
        if (usedCodes.has(p.code)) continue;
        usedCodes.add(p.code);
        toInsert.push({
          company_id: project.company_id,
          project_id: project.id,
          parent_id: rootId,
          code: p.code,
          name: p.name,
          item_type: "package",
          discipline: p.discipline ?? null,
          ifc_package_ref: p.ifc_package_ref,
          sort_order: 0,
          created_by: (context as any).user.id,
        });
      }

      if (toInsert.length > 0) {
        const { error } = await context.supabase
          .from("wbs_items")
          .insert(toInsert as any);
        if (error) {
          if ((error as any).code === "23505")
            httpError(
              409,
              "wbs_code_conflict",
              "One or more codes already used",
            );
          if ((error as any).code === "42501") httpError(403, "forbidden");
          throw error;
        }
        await audit(context, "wbs.import_ifc", null, {
          project_id: project.id,
          count: toInsert.length,
          source: "ifc_release",
        });
      }

      return { imported: toInsert.length, root_id: rootId! };
    },
  );
