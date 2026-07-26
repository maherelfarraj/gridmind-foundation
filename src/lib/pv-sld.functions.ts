// P-155 — Automatic SLD generation from an approved PV layout (thin wrapper).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { buildSldGraph, diffTagSets } from "@/lib/pv/sld-generate";
import {
  isMissingTable,
  loadLayoutSource,
  previewPayload,
  requireApprovedLayout,
} from "@/lib/pv-sld.server";
import { cadAudit, cadHttpError, hasCadWriteRole } from "@/lib/sld-cad.server";
import { nextRevisionCode } from "@/lib/sld-revisions.server";

/**
 * Converts an approved PV layout plus its P-154 stringing into a Batch 16 SLD
 * revision. Rebuild semantics: previously generated objects/connections for the
 * same source layout are removed before the fresh graph is inserted.
 */
export const generateSldFromLayout = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ layoutId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const layout = await requireApprovedLayout(context, data.layoutId);
    if (!(await hasCadWriteRole(context, layout.company_id))) {
      cadHttpError(403, "forbidden", "You do not have permission to generate SLD drawings.");
    }

    const source = await loadLayoutSource(context, layout);

    let symbolTypes: { type_key: string; tag_prefix: string }[] = [];
    try {
      const { data: rows, error } = await context.supabase
        .from("sld_symbol_types")
        .select("type_key, tag_prefix");
      if (error) throw error;
      symbolTypes = (rows ?? []) as { type_key: string; tag_prefix: string }[];
    } catch (error) {
      if (!isMissingTable(error)) throw error;
    }

    const graph = buildSldGraph({
      layoutId: layout.id,
      layoutNumber: layout.layout_number ?? layout.name,
      strings: source.strings,
      assignments: source.assignments,
      blocks: source.blocks,
      grid: source.grid,
      symbolTypes:
        symbolTypes.length > 0
          ? symbolTypes
          : [
              { type_key: "pv_string", tag_prefix: "STR" },
              { type_key: "string_combiner", tag_prefix: "SCB" },
              { type_key: "inverter", tag_prefix: "INV" },
              { type_key: "transformer", tag_prefix: "TX" },
              { type_key: "mv_switchgear", tag_prefix: "MVSG" },
              { type_key: "grid_connection_point", tag_prefix: "POI" },
            ],
    });

    if (symbolTypes.length === 0) return previewPayload(graph, layout);

    try {
      const title = `AUTO-PV-${layout.layout_number ?? layout.name}`;

      const { data: existingDrawing, error: drawingErr } = await context.supabase
        .from("sld_drawings")
        .select("id, drawing_number, locked")
        .eq("project_id", layout.project_id)
        .eq("title", title)
        .maybeSingle();
      if (drawingErr) throw drawingErr;

      let drawingId = existingDrawing?.id ?? null;
      if (!drawingId) {
        const { data: number, error: numErr } = await context.supabase.rpc(
          "next_sld_drawing_number",
          { p_project_id: layout.project_id },
        );
        if (numErr) throw numErr;
        const { data: created, error: createErr } = await context.supabase
          .from("sld_drawings")
          .insert({
            company_id: layout.company_id,
            project_id: layout.project_id,
            drawing_number: String(number),
            title,
          })
          .select("id")
          .single();
        if (createErr) throw createErr;
        drawingId = created.id;
      } else if (existingDrawing?.locked) {
        cadHttpError(409, "drawing_locked", "The generated SLD drawing is locked.");
      }

      const { data: revisions, error: revErr } = await context.supabase
        .from("sld_revisions")
        .select("id, revision_code, canvas")
        .eq("drawing_id", drawingId);
      if (revErr) throw revErr;

      const priorAuto = (revisions ?? []).filter(
        (r: any) => (r.canvas as any)?.source_layout_id === layout.id,
      );
      const priorIds = priorAuto.map((r: any) => r.id);

      let previousTags: string[] = [];
      if (priorIds.length > 0) {
        const { data: priorObjects } = await context.supabase
          .from("sld_objects")
          .select("tag")
          .in("revision_id", priorIds);
        previousTags = ((priorObjects ?? []) as any[])
          .map((o) => o.tag)
          .filter((t): t is string => Boolean(t));
        await context.supabase.from("sld_connections").delete().in("revision_id", priorIds);
        await context.supabase.from("sld_objects").delete().in("revision_id", priorIds);
      }

      const revisionCode = nextRevisionCode((revisions ?? []).map((r: any) => r.revision_code));
      const { data: revision, error: newRevErr } = await context.supabase
        .from("sld_revisions")
        .insert({
          company_id: layout.company_id,
          drawing_id: drawingId,
          revision_code: revisionCode,
          canvas: {
            source_layout_id: layout.id,
            generated_from: "pv_layout",
            generated_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single();
      if (newRevErr) throw newRevErr;

      const { data: insertedObjects, error: objErr } = await context.supabase
        .from("sld_objects")
        .insert(
          graph.objects.map((o) => ({
            company_id: layout.company_id,
            revision_id: revision.id,
            symbol_type: o.symbol_type,
            tag: o.tag,
            label: o.label,
            x: o.x,
            y: o.y,
            rotation: o.rotation,
            properties: { ...o.properties, generated_key: o.key } as any,
          })),
        )
        .select("id, properties");
      if (objErr) throw objErr;

      const idByKey = new Map<string, string>();
      for (const row of (insertedObjects ?? []) as any[]) {
        idByKey.set(String(row.properties?.generated_key ?? ""), row.id);
      }

      const connectionRows = graph.connections
        .map((c) => ({
          company_id: layout.company_id,
          revision_id: revision.id,
          from_object_id: idByKey.get(c.from)!,
          to_object_id: idByKey.get(c.to)!,
          from_port: c.from_port,
          to_port: c.to_port,
          connection_type: c.connection_type,
          cable_number: c.cable_number,
          properties: c.properties as any,
        }))
        .filter((r) => r.from_object_id && r.to_object_id);
      if (connectionRows.length > 0) {
        const { error: connErr } = await context.supabase
          .from("sld_connections")
          .insert(connectionRows);
        if (connErr) throw connErr;
      }

      await context.supabase
        .from("sld_drawings")
        .update({ current_revision_id: revision.id })
        .eq("id", drawingId);

      const diff = diffTagSets(
        previousTags,
        graph.objects.map((o) => o.tag),
      );

      await cadAudit(context, "pv_sld.generated", drawingId, {
        layout_id: layout.id,
        project_id: layout.project_id,
        revision_id: revision.id,
        revision_code: revisionCode,
        objects: graph.counts.objects,
        connections: connectionRows.length,
        objects_added: diff.added.length,
        objects_removed: diff.removed.length,
        warnings: graph.warnings.length,
      });

      return {
        persisted: true as const,
        note: null,
        drawingId,
        revisionId: revision.id,
        layoutId: layout.id,
        counts: { ...graph.counts, connections: connectionRows.length },
        warnings: graph.warnings,
        objects: [],
        connections: [],
        diff,
      };
    } catch (error) {
      if (isMissingTable(error)) return previewPayload(graph, layout);
      throw error;
    }
  });
