// P-172 — SCADA ingestion server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertIngestionWriter,
  buildIngestionHealth,
  currentCompanyId,
  importHistorian,
  listMappings,
  listTagOptions,
  saveMapping,
} from "@/lib/scada-ingestion.server";
import { tagMappingInputSchema } from "@/lib/scada/ingestion";

export const listTagMappings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    const [rows, tags] = await Promise.all([
      listMappings(context, data.companyId),
      listTagOptions(context, data.companyId),
    ]);
    return { rows, tags };
  });

export const upsertTagMapping = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => tagMappingInputSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertIngestionWriter(context);
    const companyId = await currentCompanyId(context);
    return saveMapping(context, companyId, data);
  });

export const deleteTagMapping = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertIngestionWriter(context);
    const companyId = await currentCompanyId(context);
    const { error } = await context.supabase
      .from("tag_mappings")
      .delete()
      .eq("id", data.id)
      .eq("company_id", companyId);
    if (error) throw error;
    return { ok: true };
  });

export const getIngestionHealth = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return buildIngestionHealth(context, data.companyId);
  });

export const importHistorianCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        project_id: z.string().uuid(),
        connector_id: z.string().uuid().nullable().optional(),
        source_label: z.string().trim().min(1).max(120),
        csv: z.string().min(1).max(5_000_000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertIngestionWriter(context);
    const companyId = await currentCompanyId(context);
    return importHistorian(context, companyId, data);
  });
