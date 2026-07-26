// P-147 — SLD import/export server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { cadAudit, cadHttpError, hasCadWriteRole, loadCadDrawing } from "@/lib/sld-cad.server";
import {
  assertSldExportAllowed,
  buildExportPayload,
  exportBaseName,
  importGraphAsNewRevision,
  listExportArtifacts,
  loadExportBundle,
  loadExportSymbols,
  storeExportArtifact,
  SLD_EXPORT_FORMATS,
} from "@/lib/sld-export.server";
import { fromJson, SldImportError } from "@/lib/sld/exporters";

const exportInput = z.object({
  drawingId: z.string().uuid(),
  format: z.enum(SLD_EXPORT_FORMATS),
});

const importInput = z.object({
  drawingId: z.string().uuid(),
  document: z.unknown(),
});

/** Generates one export format, stores the artifact and audits the event. */
export const exportSldDrawing = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => exportInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    await assertSldExportAllowed(context, drawing.project_id);

    const bundle = await loadExportBundle(context, drawing);
    const payload = buildExportPayload(bundle, data.format);
    const base = exportBaseName(drawing, bundle.revisionCode);
    const sourceExt = data.format === "pdf" || data.format === "png" ? "svg" : data.format;
    const fileName = `${base}.${data.format}`;

    const stored = await storeExportArtifact(
      context,
      drawing,
      bundle.revisionId,
      data.format,
      `${base}.${sourceExt}`,
      payload.text ?? "",
      payload.mime,
    );

    await cadAudit(context, "sld.exported", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: bundle.revisionId,
      format: data.format,
      storage_path: stored.storage_path,
      warnings: payload.warnings.length,
    });

    return {
      format: data.format,
      filename: fileName,
      mime: payload.mime,
      content: payload.text ?? "",
      warnings: payload.warnings,
      storage_path: stored.storage_path,
      revision_id: bundle.revisionId,
      drawing: {
        drawing_number: drawing.drawing_number,
        title: drawing.title,
        revision_code: bundle.revisionCode,
      },
    };
  });

/** Recent export artifacts for the drawing's current revision. */
export const listSldExports = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ drawingId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!drawing.current_revision_id) return { revision_id: null, artifacts: [] };
    return {
      revision_id: drawing.current_revision_id,
      artifacts: await listExportArtifacts(context, drawing.current_revision_id),
    };
  });

/** Imports a GridMind SLD JSON document into a brand new draft revision. */
export const importSldJson = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) {
      cadHttpError(403, "forbidden", "Engineering role required to import a drawing.");
    }
    if (drawing.locked) {
      cadHttpError(409, "drawing_locked", "This drawing is locked — import is not allowed.");
    }

    let graph;
    try {
      graph = fromJson(data.document);
    } catch (err) {
      if (err instanceof SldImportError) cadHttpError(422, err.code, err.message);
      throw err;
    }

    const symbols = await loadExportSymbols(context, drawing.company_id);
    const result = await importGraphAsNewRevision(context, drawing, graph, symbols as any);

    await cadAudit(context, "sld.imported", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: result.revision_id,
      revision_code: result.revision_code,
      object_count: result.object_count,
      connection_count: result.connection_count,
    });

    return result;
  });
