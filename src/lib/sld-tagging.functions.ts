// P-141 — Tagging server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { cadAudit, cadHttpError, hasCadWriteRole, loadCadDrawing } from "@/lib/sld-cad.server";
import { assertRetaggable, loadRetagGraph } from "@/lib/sld-tagging.server";
import { isValidTag, planRetag, type RetagPlan } from "@/lib/sld/tagging";

export type RetagPreview = RetagPlan & {
  revision_id: string;
  frozen: boolean;
  object_count: number;
  connection_count: number;
};

const retagInput = z.object({
  drawingId: z.string().uuid(),
  force: z.boolean().default(false),
  /** When true the plan is returned without touching any row (preview diff). */
  dryRun: z.boolean().default(false),
});

/** Runs the deterministic tagging engine over the drawing's current revision. */
export const retagSldRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => retagInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) cadHttpError(403, "forbidden");

    const graph = await loadRetagGraph(context, drawing);
    if (!data.dryRun) assertRetaggable(drawing, graph.revisionStatus);

    const plan = planRetag(graph.objects, graph.connections, graph.symbolTypes, graph.areas, {
      force: data.force,
    });

    if (data.dryRun) {
      return {
        ...plan,
        revision_id: graph.revisionId,
        frozen: false,
        object_count: graph.objects.length,
        connection_count: graph.connections.length,
      } satisfies RetagPreview;
    }

    for (const a of plan.tags) {
      const { error } = await context.supabase
        .from("sld_objects")
        .update({ tag: a.tag } as any)
        .eq("id", a.id)
        .eq("revision_id", graph.revisionId);
      if (error) throw error;
    }
    for (const c of plan.cables) {
      const { error } = await context.supabase
        .from("sld_connections")
        .update({ cable_number: c.cable_number } as any)
        .eq("id", c.id)
        .eq("revision_id", graph.revisionId);
      if (error) throw error;
    }

    await cadAudit(context, "sld.retagged", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: graph.revisionId,
      force: data.force,
      tags_changed: plan.tags.length,
      cables_changed: plan.cables.length,
      object_count: graph.objects.length,
      connection_count: graph.connections.length,
    });

    return {
      ...plan,
      revision_id: graph.revisionId,
      frozen: false,
      object_count: graph.objects.length,
      connection_count: graph.connections.length,
    } satisfies RetagPreview;
  });

const manualTagInput = z.object({
  drawingId: z.string().uuid(),
  objectId: z.string().uuid(),
  tag: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => isValidTag(v), "Tag must look like INV-01-02."),
});

/** Inline tag edit from the objects list — validated, audited, blocked when frozen. */
export const setSldObjectTag = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => manualTagInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) cadHttpError(403, "forbidden");

    const graph = await loadRetagGraph(context, drawing);
    assertRetaggable(drawing, graph.revisionStatus);

    const target = graph.objects.find((o) => o.id === data.objectId);
    if (!target) cadHttpError(404, "object_not_found", "Object is not part of this revision.");

    const { error } = await context.supabase
      .from("sld_objects")
      .update({ tag: data.tag } as any)
      .eq("id", data.objectId)
      .eq("revision_id", graph.revisionId);
    if (error) {
      if (String((error as any).code) === "23505") {
        cadHttpError(409, "duplicate_tag", `Tag ${data.tag} is already used on this revision.`);
      }
      throw error;
    }

    await cadAudit(context, "sld.tag_edited", drawing.id, {
      project_id: drawing.project_id,
      revision_id: graph.revisionId,
      object_id: data.objectId,
      previous: target.tag,
      tag: data.tag,
    });

    return { ok: true, tag: data.tag, previous: target.tag };
  });
