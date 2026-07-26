// P-144 — SLD schedule server functions (thin wrapper: declarations + imports only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertExportAllowed } from "@/lib/export-guard";
import { cadAudit, cadHttpError, hasCadWriteRole, loadCadDrawing } from "@/lib/sld-cad.server";
import {
  buildDrawingSchedules,
  listSchedulesForRevision,
  loadBranding,
  loadGraphOr409,
  loadScheduleWithDrawing,
  scheduleCsv,
  upsertSchedules,
} from "@/lib/sld-schedules.server";
import { SCHEDULE_LABELS } from "@/lib/sld/schedules";

const drawingInput = z.object({ drawingId: z.string().uuid() });

const exportInput = z.object({
  scheduleId: z.string().uuid(),
  format: z.enum(["csv", "pdf"]),
});

/** Lists the persisted schedules for a drawing's current revision. */
export const listSldSchedules = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!drawing.current_revision_id) return { revision_id: null, schedules: [] };
    return {
      revision_id: drawing.current_revision_id,
      schedules: await listSchedulesForRevision(context, drawing.current_revision_id),
    };
  });

/** Regenerates every schedule type from the object graph (upsert per revision+type). */
export const generateSldSchedules = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => drawingInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const drawing = await loadCadDrawing(context, data.drawingId);
    if (!(await hasCadWriteRole(context, drawing.company_id))) {
      cadHttpError(403, "forbidden", "Engineering role required to generate schedules.");
    }

    const graph = await loadGraphOr409(context, drawing);
    const set = await buildDrawingSchedules(context, drawing, graph);
    const schedules = await upsertSchedules(
      context,
      drawing,
      graph.revisionId,
      set,
      context.userId,
    );

    await cadAudit(context, "sld.schedules_generated", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      revision_id: graph.revisionId,
      counts: Object.fromEntries(schedules.map((s) => [s.schedule_type, s.row_count])),
    });

    return { revision_id: graph.revisionId, schedules };
  });

/** Export a schedule as CSV text or PDF payload; export locks return a typed 423. */
export const exportSldSchedule = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => exportInput.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const { schedule, drawing, revisionCode } = await loadScheduleWithDrawing(
      context,
      data.scheduleId,
    );

    try {
      await assertExportAllowed(context.supabase, drawing.project_id, "sld_schedule");
    } catch (err) {
      if ((err as { code?: string }).code === "export_locked") {
        cadHttpError(423, "export_locked", "Export blocked: this project has an active lock.");
      }
      throw err;
    }

    const label = SCHEDULE_LABELS[schedule.schedule_type];
    const base = `${drawing.drawing_number}-${schedule.schedule_type}${revisionCode ? `-${revisionCode}` : ""}`;

    await cadAudit(context, "sld.schedule_exported", drawing.id, {
      project_id: drawing.project_id,
      drawing_number: drawing.drawing_number,
      schedule_id: schedule.id,
      schedule_type: schedule.schedule_type,
      format: data.format,
      row_count: schedule.row_count,
    });

    return {
      format: data.format,
      filename: `${base}.${data.format}`,
      title: `${label} — ${drawing.drawing_number}`,
      schedule_type: schedule.schedule_type,
      rows: schedule.rows,
      drawing: {
        drawing_number: drawing.drawing_number,
        title: drawing.title,
        revision_code: revisionCode,
      },
      csv: data.format === "csv" ? scheduleCsv(schedule.schedule_type, schedule.rows) : null,
      branding: data.format === "pdf" ? await loadBranding(context, drawing.company_id) : null,
    };
  });
