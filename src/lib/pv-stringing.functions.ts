// P-154 — PV stringing server functions (thin wrapper module).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { auditPvLayout, canWritePvLayout, httpError } from "@/lib/pv-layout.server";
import {
  assignmentRowsFrom,
  requireRegenerableLayout,
  stringRowsFrom,
} from "@/lib/pv-stringing.server";
import { generateStringing, type StringingInput } from "@/lib/pv/stringing";

const pointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const generateSchema = z.object({
  layoutId: z.string().uuid(),
  modulesInSeries: z.number().int().positive().max(60),
  routingFactor: z.number().min(1).max(3).default(1.15),
  invertersPerFeeder: z.number().int().positive().max(50).nullable().default(null),
  feederRatingA: z.number().positive().max(5000).nullable().default(null),
  module: z.object({
    id: z.string().uuid().nullable().default(null),
    pmaxW: z.number().positive(),
    vocV: z.number().positive(),
    vmpV: z.number().positive(),
    iscA: z.number().positive(),
    impA: z.number().positive(),
    tempCoeffVocPctPerC: z.number(),
    tempCoeffVmpPctPerC: z.number().optional(),
  }),
  inverter: z.object({
    id: z.string().uuid().nullable().default(null),
    acKw: z.number().positive(),
    maxDcV: z.number().positive(),
    mpptMinV: z.number().positive(),
    mpptMaxV: z.number().positive(),
    mpptCount: z.number().int().positive().max(64),
    maxInputAPerMppt: z.number().positive(),
    maxDcKwp: z.number().positive().optional(),
  }),
  combiner: z.object({
    id: z.string().uuid().nullable().default(null),
    inputs: z.number().int().positive().max(64),
    maxInputA: z.number().positive().optional(),
  }),
  dcCable: z.object({
    id: z.string().uuid().nullable().default(null),
    crossSectionMm2: z.number().positive(),
    material: z.enum(["copper", "aluminium"]).default("copper"),
    tempFactor: z.number().min(0.5).max(2).default(1),
    ampacityA: z.number().positive().optional(),
  }),
  mvCable: z
    .object({
      id: z.string().uuid().nullable().default(null),
      crossSectionMm2: z.number().positive(),
      material: z.enum(["copper", "aluminium"]).default("aluminium"),
      tempFactor: z.number().min(0.5).max(2).default(1),
      ampacityA: z.number().positive().optional(),
    })
    .nullable()
    .default(null),
  transformer: z
    .object({
      id: z.string().uuid().nullable().default(null),
      ratedKva: z.number().positive(),
      mvKv: z.number().positive(),
    })
    .nullable()
    .default(null),
  site: z.object({ minTempC: z.number(), maxTempC: z.number() }),
  blocks: z
    .array(
      z.object({
        blockId: z.string().uuid().nullable().default(null),
        label: z.string().min(1).max(64),
        centroid: pointSchema,
        moduleCount: z.number().int().min(0),
      }),
    )
    .max(20000),
  inverterStations: z
    .array(z.object({ label: z.string().min(1).max(64), centroid: pointSchema }))
    .max(500),
  combinerStations: z
    .array(z.object({ label: z.string().min(1).max(64), centroid: pointSchema }))
    .max(2000)
    .default([]),
  transformerStations: z
    .array(z.object({ label: z.string().min(1).max(64), centroid: pointSchema }))
    .max(500)
    .default([]),
});

/** Reads the persisted electrical design for a layout. */
export const getPvStringing = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ layoutId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const [strings, assignments] = await Promise.all([
      context.supabase
        .from("pv_strings")
        .select("*")
        .eq("layout_id", data.layoutId)
        .order("string_label"),
      context.supabase
        .from("pv_string_assignments")
        .select("*")
        .eq("layout_id", data.layoutId)
        .order("inverter_station_label"),
    ]);
    if (strings.error) throw strings.error;
    if (assignments.error) throw assignments.error;
    return { strings: strings.data ?? [], assignments: assignments.data ?? [] };
  });

/**
 * Regenerates strings and MPPT assignments for a draft/under_review layout.
 * Approved layouts are immutable and rejected server-side.
 */
export const regeneratePvStringing = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => generateSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    if (!(await canWritePvLayout(context))) httpError(403, "forbidden");

    const layout = await requireRegenerableLayout(context, data.layoutId);
    const result = generateStringing(data as unknown as StringingInput);
    const userId = (context as any).user?.id ?? null;

    await context.supabase.from("pv_string_assignments").delete().eq("layout_id", layout.id);
    await context.supabase.from("pv_strings").delete().eq("layout_id", layout.id);

    const stringRows = stringRowsFrom(result, {
      companyId: layout.company_id,
      layoutId: layout.id,
      moduleId: data.module.id,
      userId,
    });

    const stringIdByLabel = new Map<string, string>();
    if (stringRows.length > 0) {
      const { data: inserted, error } = await context.supabase
        .from("pv_strings")
        .insert(stringRows as any)
        .select("id, string_label");
      if (error) throw error;
      for (const row of (inserted ?? []) as any[]) {
        stringIdByLabel.set(row.string_label, row.id);
      }
    }

    const assignmentRows = assignmentRowsFrom(result, stringIdByLabel, {
      companyId: layout.company_id,
      layoutId: layout.id,
      inverterId: data.inverter.id,
      userId,
    });
    if (assignmentRows.length > 0) {
      const { error } = await context.supabase
        .from("pv_string_assignments")
        .insert(assignmentRows as any);
      if (error) throw error;
    }

    await auditPvLayout(context, "pv_layout.stringing_generated", layout.id, {
      project_id: layout.project_id,
      strings: result.counts.strings,
      inverters: result.counts.inverters,
      warnings: result.warnings.length,
    });

    return {
      counts: result.counts,
      totals: result.totals,
      warnings: result.warnings,
      persisted: { strings: stringRows.length, assignments: assignmentRows.length },
    };
  });
