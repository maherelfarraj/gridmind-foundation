// GC-12 — Integrated Earned Value Management server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  evmCalculateSchema,
  evmCsvSchema,
  evmDetailFilterSchema,
  evmIdSchema,
  evmMappingSchema,
  evmMappingVersionSchema,
  evmOverrideSchema,
  evmQuerySchema,
  evmSettingsSchema,
  evmSupersedeSchema,
  evmTransitionSchema,
  portfolioEvmFilterSchema,
  type EvmAppendix,
  type ReportStatus,
} from "@/lib/evm.report.rules";
import {
  approveMappingVersion,
  createMappingVersion,
  deleteMapping,
  deleteProgressOverride,
  listMappingVersions,
  listMappings,
  loadEvmAppendix,
  loadEvmCsv,
  loadEvmDetail,
  loadEvmSettings,
  loadEvmWorkspace,
  loadPortfolioEvm,
  loadPortfolioEvmAppendix,
  saveEvmReport,
  saveEvmSettings,
  saveMapping,
  saveProgressOverride,
  supersedeEvmReport,
  transitionEvmReport,
  type EvmSettings,
  type EvmWorkspaceData,
  type MappingVersionRow,
  type PortfolioEvmData,
} from "@/lib/evm.report.server";

export type { EvmWorkspaceData, PortfolioEvmData, EvmSettings, MappingVersionRow };

export const getEvmWorkspace = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<EvmWorkspaceData> => {
    requireSupabaseAuth(context);
    return loadEvmWorkspace(context, data);
  });

export const getEvmDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmDetailFilterSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return loadEvmDetail(context, data);
  });

export const calculateEvmReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmCalculateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ report_id: string }> => {
    requireSupabaseAuth(context);
    return saveEvmReport(context, data);
  });

export const transitionEvmReportFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmTransitionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: ReportStatus }> => {
    requireSupabaseAuth(context);
    return transitionEvmReport(context, data);
  });

export const supersedeEvmReportFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmSupersedeSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ report_id: string }> => {
    requireSupabaseAuth(context);
    return supersedeEvmReport(context, data);
  });

export const getEvmSettings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmQuerySchema.pick({ project_id: true }).parse(input))
  .handler(async ({ data, context }): Promise<EvmSettings> => {
    requireSupabaseAuth(context);
    return loadEvmSettings(context, data.project_id);
  });

export const saveEvmSettingsFn = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<EvmSettings> => {
    requireSupabaseAuth(context);
    return saveEvmSettings(context, data);
  });

export const getEvmMappingVersions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmQuerySchema.pick({ project_id: true }).parse(input))
  .handler(async ({ data, context }): Promise<MappingVersionRow[]> => {
    requireSupabaseAuth(context);
    return listMappingVersions(context, data.project_id);
  });

export const getEvmMappings = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return listMappings(context, data.id);
  });

export const createEvmMappingVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmMappingVersionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return { id: await createMappingVersion(context, data.project_id, data.note ?? null) };
  });

export const approveEvmMappingVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await approveMappingVersion(context, data.id);
    return { ok: true };
  });

export const saveEvmMapping = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmMappingSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return { id: await saveMapping(context, data) };
  });

export const deleteEvmMapping = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await deleteMapping(context, data.id);
    return { ok: true };
  });

export const saveEvmOverride = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmOverrideSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    requireSupabaseAuth(context);
    return { id: await saveProgressOverride(context, data) };
  });

export const deleteEvmOverride = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmIdSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    await deleteProgressOverride(context, data.id);
    return { ok: true };
  });

export const getEvmCsv = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmCsvSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    return loadEvmCsv(context, data);
  });

export const getEvmAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => evmQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<EvmAppendix> => {
    requireSupabaseAuth(context);
    return loadEvmAppendix(context, data);
  });

export const getPortfolioEvm = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioEvmFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioEvmData> => {
    requireSupabaseAuth(context);
    return loadPortfolioEvm(context, data);
  });

export const getPortfolioEvmAppendix = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioEvmFilterSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    requireSupabaseAuth(context);
    return loadPortfolioEvmAppendix(context, data);
  });
