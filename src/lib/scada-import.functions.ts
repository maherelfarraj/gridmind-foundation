// P-172 — CSV / historian import server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertIngestionWriter,
  currentCompanyId,
  getConnectorErrorRate,
} from "@/lib/scada-ingestion.server";
import { buildUploadPath, listProjectTags, runCsvImport } from "@/lib/scada-import.server";
import { importMappingSchema } from "@/lib/scada/csv-import";

export const listImportTags = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ companyId: z.string().uuid(), projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return { tags: await listProjectTags(context, data.companyId, data.projectId) };
  });

export const createImportUpload = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        filename: z.string().trim().min(1).max(160),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertIngestionWriter(context);
    const companyId = await currentCompanyId(context);
    const path = buildUploadPath(companyId, data.projectId, data.filename);
    const { data: signed, error } = await context.supabase.storage
      .from("documents")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

export const importScadaCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        sourceLabel: z.string().trim().min(1).max(120),
        storagePath: z.string().trim().max(400).nullable().optional(),
        csv: z.string().min(1).max(8_000_000),
        mapping: importMappingSchema,
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    await assertIngestionWriter(context);
    const companyId = await currentCompanyId(context);
    return runCsvImport(context, companyId, {
      project_id: data.projectId,
      source_label: data.sourceLabel,
      storage_path: data.storagePath ?? null,
      csv: data.csv,
      mapping: data.mapping,
    });
  });

export const getConnectorErrorRates = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ companyId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return getConnectorErrorRate(context, data.companyId);
  });
