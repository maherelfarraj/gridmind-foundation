// P-143 — Coordination server function (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { cadAudit, cadHttpError, loadCadDrawing } from "@/lib/sld-cad.server";
import {
  loadCoordinationOptions,
  loadValidationGraph,
  persistCoordination,
} from "@/lib/sld-validation.server";
import { runCoordination, type CoordinationSnapshot } from "@/lib/sld/coordination";

const coordinationInput = z.object({
  drawingId: z.string().uuid(),
  dryRun: z.boolean().default(false),
});

/** Runs the electrical coordination checks over the drawing's current revision. */
export const runSldCoordination = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => coordinationInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);

    const graph = await loadValidationGraph(context, drawing);
    if (!graph) cadHttpError(404, "revision_not_found", "No revision to check.");

    const options = await loadCoordinationOptions(context, drawing.project_id);
    const result = runCoordination(graph.objects, graph.connections, graph.symbolTypes, options);

    const snapshot: CoordinationSnapshot = { ran_at: new Date().toISOString(), ...result };

    if (!data.dryRun) {
      await persistCoordination(context, graph, snapshot);
      await cadAudit(context, "sld.coordination_run", drawing.id, {
        project_id: drawing.project_id,
        drawing_number: drawing.drawing_number,
        revision_id: graph.revisionId,
        issue_count: snapshot.issue_count,
        error_count: snapshot.error_count,
        warning_count: snapshot.warning_count,
        info_count: snapshot.info_count,
        protection_rows: snapshot.protection_references.length,
        cable_rows: snapshot.cable_references.length,
      });
    }

    return { ...snapshot, revision_id: graph.revisionId, persisted: !data.dryRun };
  });
