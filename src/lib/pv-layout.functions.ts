// P-152 — PV layout server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  createPvLayoutSchema,
  saveLayoutBlocksSchema,
  setLayoutStatusSchema,
  type PvLayoutBlockRow,
  type PvLayoutRow,
} from "@/lib/pv-layout.schemas";
import {
  auditPvLayout,
  canWritePvLayout,
  httpError,
  mapLayoutRpcError,
  toBlockRow,
  toLayoutRow,
} from "@/lib/pv-layout.server";

export const listPvLayouts = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ projectId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<PvLayoutRow[]> => {
    requireSupabaseAuth(context);
    const { data: rows, error } = await context.supabase
      .from("pv_layouts")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((rows ?? []) as any[]).map(toLayoutRow);
  });

export const getPvLayout = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ layoutId: z.string().uuid() }).parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ layout: PvLayoutRow | null; blocks: PvLayoutBlockRow[] }> => {
      requireSupabaseAuth(context);
      const { data: row, error } = await context.supabase
        .from("pv_layouts")
        .select("*")
        .eq("id", data.layoutId)
        .maybeSingle();
      if (error) throw error;
      if (!row) return { layout: null, blocks: [] };

      const { data: blocks, error: blockError } = await context.supabase
        .from("pv_layout_blocks")
        .select("*")
        .eq("layout_id", data.layoutId)
        .order("sort_order", { ascending: true });
      if (blockError) throw blockError;

      return { layout: toLayoutRow(row as any), blocks: ((blocks ?? []) as any[]).map(toBlockRow) };
    },
  );

export const getPvLayoutWriteAccess = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }): Promise<{ canWrite: boolean }> => {
    requireSupabaseAuth(context);
    return { canWrite: await canWritePvLayout(context) };
  });

/** Inserts the layout row and every generated block inside one transaction. */
export const createPvLayout = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => createPvLayoutSchema.parse(input))
  .handler(async ({ data, context }): Promise<PvLayoutRow> => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const { data: row, error } = await context.supabase.rpc("create_pv_layout", {
      p_project_id: data.projectId,
      p_name: data.name,
      p_site_config_id: data.siteConfigId,
      p_params: data.params as any,
      p_totals: data.totals as any,
      p_blocks: data.blocks as any,
    } as any);
    if (error) mapLayoutRpcError(error as any);

    const layout = toLayoutRow(row as any);
    await auditPvLayout(context, "pv_layout.created", layout.id, {
      project_id: data.projectId,
      layout_number: layout.layout_number,
      version: layout.version,
      block_count: data.blocks.length,
      table_count: data.totals.table_count,
      dc_kwp: data.totals.dc_kwp,
    });
    return layout;
  });

/** Replaces the block set of a draft layout. Non-draft layouts are rejected. */
export const saveLayoutBlocks = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveLayoutBlocksSchema.parse(input))
  .handler(async ({ data, context }): Promise<PvLayoutRow> => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const { data: row, error } = await context.supabase.rpc("save_pv_layout_blocks", {
      p_layout_id: data.layoutId,
      p_blocks: data.blocks as any,
      p_totals: (data.totals ?? null) as any,
    } as any);
    if (error) mapLayoutRpcError(error as any);

    const layout = toLayoutRow(row as any);
    await auditPvLayout(context, "pv_layout.blocks_saved", layout.id, {
      project_id: layout.project_id,
      block_count: data.blocks.length,
    });
    return layout;
  });

/** Draft <-> under_review only; approval transitions land with P-153. */
export const setPvLayoutStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => setLayoutStatusSchema.parse(input))
  .handler(async ({ data, context }): Promise<PvLayoutRow> => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const { data: row, error } = await context.supabase.rpc("set_pv_layout_status", {
      p_layout_id: data.layoutId,
      p_status: data.status,
    } as any);
    if (error) mapLayoutRpcError(error as any);

    const layout = toLayoutRow(row as any);
    await auditPvLayout(context, `pv_layout.${data.status}`, layout.id, {
      project_id: layout.project_id,
      status: data.status,
    });
    return layout;
  });
