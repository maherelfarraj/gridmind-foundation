// P-142 — Validation server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { cadAudit, cadHttpError, loadCadDrawing } from "@/lib/sld-cad.server";
import { loadValidationGraph, persistValidation } from "@/lib/sld-validation.server";
import {
  runValidation,
  summarizeIssues,
  type ValidationSnapshot,
} from "@/lib/sld/connectivity";

const validateInput = z.object({
  drawingId: z.string().uuid(),
  /** When true the snapshot is returned without persisting (live preview runs). */
  dryRun: z.boolean().default(false),
});

/** Runs the connectivity engine over the drawing's current revision. */
export const validateSldRevision = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => validateInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);

    const graph = await loadValidationGraph(context, drawing);
    if (!graph) cadHttpError(404, "revision_not_found", "No revision to validate.");

    const issues = runValidation(graph.objects, graph.connections, graph.symbolTypes, {
      projectVoltagesKv: graph.projectVoltagesKv,
    });

    const snapshot: ValidationSnapshot = {
      ran_at: new Date().toISOString(),
      ...summarizeIssues(issues),
      issues,
    };

    if (!data.dryRun) {
      await persistValidation(context, graph, snapshot);
      await cadAudit(context, "sld.validated", drawing.id, {
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        revision_id: graph.revisionId,
        issue_count: snapshot.issue_count,
        error_count: snapshot.error_count,
        warning_count: snapshot.warning_count,
        object_count: graph.objects.length,
        connection_count: graph.connections.length,
      });
    }

    return {
      ...snapshot,
      revision_id: graph.revisionId,
      persisted: !data.dryRun,
    };
  });
