// P-138 — SLD CAD canvas server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertDrawingEditable,
  cadAudit,
  cadHttpError,
  hasCadWriteRole,
  isRemoved,
  isUuid,
  loadCadDrawing,
  REMOVED_FLAG,
  type CadDrawing,
} from "@/lib/sld-cad.server";
import { normalizeCanvasMeta } from "@/lib/sld/canvas-types";

export type SldCadWorkspace = {
  drawing: CadDrawing & { project_name: string | null; project_code: string | null };
  revision: { id: string; revision_code: string; status: string; canvas: Record<string, unknown> } | null;
  objects: Array<{
    id: string;
    symbol_type: string;
    tag: string | null;
    label: string | null;
    x: number;
    y: number;
    rotation: number;
    mirrored: boolean;
    layer_id: string;
    properties: Record<string, unknown>;
  }>;
  connections: Array<{
    id: string;
    from_object_id: string;
    from_port: string;
    to_object_id: string;
    to_port: string;
    connection_type: string;
    cable_number: string | null;
  }>;
  canWrite: boolean;
  editable: boolean;
  drawnBy: string | null;
};

export const getSldCadWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ drawingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<SldCadWorkspace> => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);

    const [{ data: project }, canWrite] = await Promise.all([
      context.supabase
        .from("projects")
        .select("name, project_code")
        .eq("id", drawing.project_id)
        .maybeSingle(),
      hasCadWriteRole(context, drawing.company_id),
    ]);

    let revision: SldCadWorkspace["revision"] = null;
    if (drawing.current_revision_id) {
      const { data: rev } = await context.supabase
        .from("sld_revisions")
        .select("id, revision_code, status, canvas")
        .eq("id", drawing.current_revision_id)
        .maybeSingle();
      revision = (rev as any) ?? null;
    }
    if (!revision) {
      const { data: rev } = await context.supabase
        .from("sld_revisions")
        .select("id, revision_code, status, canvas")
        .eq("drawing_id", drawing.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      revision = (rev as any) ?? null;
    }

    let objects: SldCadWorkspace["objects"] = [];
    let connections: SldCadWorkspace["connections"] = [];
    if (revision) {
      const [{ data: objRows }, { data: connRows }] = await Promise.all([
        context.supabase
          .from("sld_objects")
          .select("id, symbol_type, tag, label, x, y, rotation, mirrored, layer_id, properties")
          .eq("revision_id", revision.id),
        context.supabase
          .from("sld_connections")
          .select(
            "id, from_object_id, from_port, to_object_id, to_port, connection_type, cable_number",
          )
          .eq("revision_id", revision.id),
      ]);
      objects = ((objRows ?? []) as any[])
        .filter((o) => !isRemoved(o.properties))
        .map((o) => ({
          ...o,
          x: Number(o.x),
          y: Number(o.y),
          rotation: Number(o.rotation),
          properties: (o.properties ?? {}) as Record<string, unknown>,
        }));
      connections = ((connRows ?? []) as any[]).map((c) => ({ ...c }));
    }

    const { data: profile } = await context.supabase
      .from("profiles")
      .select("full_name")
      .eq("id", context.user.id)
      .maybeSingle();

    const editable =
      canWrite && !drawing.locked && !["ifc", "as_built", "superseded"].includes(drawing.status);

    return {
      drawing: {
        ...drawing,
        project_name: (project as any)?.name ?? null,
        project_code: (project as any)?.project_code ?? null,
      },
      revision,
      objects,
      connections,
      canWrite,
      editable,
      drawnBy: ((profile as any)?.full_name as string) ?? null,
    };
  });

const canvasObjectSchema = z.object({
  id: z.string().min(1),
  symbol_type: z.string().trim().min(1).max(80),
  tag: z.string().trim().max(80).nullable(),
  label: z.string().trim().max(200).nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  mirrored: z.boolean(),
  layer_id: z.string().trim().min(1).max(80),
  properties: z.record(z.string(), z.unknown()).default({}),
});

const saveInput = z.object({
  drawingId: z.string().uuid(),
  objects: z.array(canvasObjectSchema).max(2000),
  removedIds: z.array(z.string().uuid()).max(2000).default([]),
  canvas: z.object({
    layers: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(80),
        visible: z.boolean(),
        locked: z.boolean(),
        system: z.boolean().optional(),
      }),
    ),
    gridMm: z.union([z.literal(1), z.literal(5), z.literal(10)]),
    snapEnabled: z.boolean(),
  }),
});

/** Batch upsert of the current revision's objects + canvas metadata. */
export const saveSldObjects = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) cadHttpError(403, "forbidden");
    assertDrawingEditable(drawing);

    // Resolve (or create) the editable revision.
    let revisionId = drawing.current_revision_id;
    if (!revisionId) {
      const { data: rev, error: revErr } = await context.supabase
        .from("sld_revisions")
        .insert({
          company_id: drawing.company_id,
          drawing_id: drawing.id,
          revision_code: "A",
          status: drawing.status,
          canvas: data.canvas as any,
          created_by: context.user.id,
        } as any)
        .select("id")
        .single();
      if (revErr) throw revErr;
      revisionId = (rev as any).id as string;
      const { error: linkErr } = await context.supabase
        .from("sld_drawings")
        .update({ current_revision_id: revisionId } as any)
        .eq("id", drawing.id);
      if (linkErr) throw linkErr;
    } else {
      const { error: metaErr } = await context.supabase
        .from("sld_revisions")
        .update({ canvas: data.canvas as any } as any)
        .eq("id", revisionId);
      if (metaErr) throw metaErr;
    }

    const inserts = data.objects
      .filter((o) => !isUuid(o.id))
      .map((o) => ({
        company_id: drawing.company_id,
        revision_id: revisionId,
        symbol_type: o.symbol_type,
        tag: o.tag,
        label: o.label,
        x: o.x,
        y: o.y,
        rotation: o.rotation,
        mirrored: o.mirrored,
        layer_id: o.layer_id,
        properties: o.properties as any,
        created_by: context.user.id,
      }));
    const updates = data.objects.filter((o) => isUuid(o.id));

    let created = 0;
    if (inserts.length > 0) {
      const { data: rows, error } = await context.supabase
        .from("sld_objects")
        .insert(inserts as any)
        .select("id");
      if (error) throw error;
      created = (rows ?? []).length;
    }
    for (const o of updates) {
      const { error } = await context.supabase
        .from("sld_objects")
        .update({
          symbol_type: o.symbol_type,
          tag: o.tag,
          label: o.label,
          x: o.x,
          y: o.y,
          rotation: o.rotation,
          mirrored: o.mirrored,
          layer_id: o.layer_id,
          properties: o.properties as any,
        } as any)
        .eq("id", o.id)
        .eq("revision_id", revisionId);
      if (error) throw error;
    }

    // Soft removal — flag, never destroy (no DELETE grants on SLD tables).
    let removed = 0;
    for (const id of data.removedIds) {
      const { data: existing } = await context.supabase
        .from("sld_objects")
        .select("properties")
        .eq("id", id)
        .eq("revision_id", revisionId)
        .maybeSingle();
      if (!existing) continue;
      const props = { ...((existing as any).properties ?? {}), [REMOVED_FLAG]: true };
      const { error } = await context.supabase
        .from("sld_objects")
        .update({ properties: props as any } as any)
        .eq("id", id)
        .eq("revision_id", revisionId);
      if (error) throw error;
      removed += 1;
    }

    await cadAudit(context, "sld.canvas_saved", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: revisionId,
      object_count: data.objects.length,
      created_count: created,
      updated_count: updates.length,
      removed_count: removed,
      layer_count: data.canvas.layers.length,
    });

    return {
      ok: true,
      revision_id: revisionId,
      object_count: data.objects.length,
      created,
      updated: updates.length,
      removed,
    };
  });

/** Explicit batch "remove from revision" (soft) for callers outside the canvas save. */
export const removeSldObjects = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ drawingId: z.string().uuid(), ids: z.array(z.string().uuid()).min(1).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) cadHttpError(403, "forbidden");
    assertDrawingEditable(drawing);
    if (!drawing.current_revision_id) cadHttpError(404, "revision_not_found");

    let removed = 0;
    for (const id of data.ids) {
      const { data: existing } = await context.supabase
        .from("sld_objects")
        .select("properties")
        .eq("id", id)
        .eq("revision_id", drawing.current_revision_id)
        .maybeSingle();
      if (!existing) continue;
      const props = { ...((existing as any).properties ?? {}), [REMOVED_FLAG]: true };
      const { error } = await context.supabase
        .from("sld_objects")
        .update({ properties: props as any } as any)
        .eq("id", id);
      if (error) throw error;
      removed += 1;
    }

    await cadAudit(context, "sld.canvas_saved", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: drawing.current_revision_id,
      removed_count: removed,
      reason: "remove_from_revision",
    });

    return { ok: true, removed };
  });

export { normalizeCanvasMeta };
