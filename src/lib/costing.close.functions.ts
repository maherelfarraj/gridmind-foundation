// GC-03 — Server functions for forecast versioning and costing period close.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  assertCostingPeriodOpen,
  compareVersions,
  hasCloseRole,
  loadCostingClose,
  loadCostingSettings,
  loadForecastVersion,
  loadVersionLines,
  transitionPeriod,
  type CostingCloseData,
} from "@/lib/costing.close.server";
import {
  costingPeriodQuerySchema,
  costingPeriodTransitionSchema,
  costingSettingsSchema,
  type CostingPeriodState,
} from "@/lib/costing.periods";
import { costingAudit, costingHttpError, loadCostingProject } from "@/lib/costing.server";
import {
  applyVersionAction,
  createVersionFromLive,
  refreshVersionSnapshot,
} from "@/lib/costing.versions.server";
import {
  forecastVersionActionSchema,
  forecastVersionCompareSchema,
  forecastVersionCreateSchema,
  type ForecastDiff,
  type ForecastSnapshotLine,
  type ForecastVersionStatus,
} from "@/lib/costing.versions";

export type { CostingCloseData };

export const getCostingClose = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costingPeriodQuerySchema.parse(input))
  .handler(async ({ data, context }): Promise<CostingCloseData> => {
    requireSupabaseAuth(context);
    return loadCostingClose(context, data.projectId, data.period);
  });

export const setCostingSettings = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costingSettingsSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    requireSupabaseAuth(context);
    if (!(await hasCloseRole(context))) costingHttpError(403, "forbidden");
    const { error } = await (context.supabase as any).from("costing_settings").upsert(
      {
        company_id: data.companyId,
        reporting_timezone: data.reporting_timezone,
        materiality_abs: data.materiality_abs,
        materiality_pct: data.materiality_pct,
      },
      { onConflict: "company_id" },
    );
    if (error) throw error;
    await costingAudit(context, "costing.settings.update", "costing_settings", data.companyId, {
      reporting_timezone: data.reporting_timezone,
      materiality_abs: data.materiality_abs,
      materiality_pct: data.materiality_pct,
    });
    return { ok: true };
  });

export const transitionCostingPeriod = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => costingPeriodTransitionSchema.parse(input))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ state: CostingPeriodState; rowVersion: number; notified: number }> => {
      requireSupabaseAuth(context);
      if (!(await hasCloseRole(context))) costingHttpError(403, "forbidden");
      return transitionPeriod(context, data);
    },
  );

export const createForecastVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => forecastVersionCreateSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string; version_no: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasCloseRole(context))) costingHttpError(403, "forbidden");
    const project = await loadCostingProject(context, data.projectId);
    // A version is a costing fact dated in its reporting month.
    await assertCostingPeriodOpen(context, project.company_id, project.id, data.period, {
      entity: "forecast_versions",
    });
    return createVersionFromLive(context, project, data.period, data.label ?? null);
  });

export const refreshForecastVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    forecastVersionCompareSchema.pick({ toVersionId: true }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ lines: number }> => {
    requireSupabaseAuth(context);
    if (!(await hasCloseRole(context))) costingHttpError(403, "forbidden");
    return refreshVersionSnapshot(context, data.toVersionId);
  });

export const actOnForecastVersion = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => forecastVersionActionSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ status: ForecastVersionStatus }> => {
    requireSupabaseAuth(context);
    if (!(await hasCloseRole(context))) costingHttpError(403, "forbidden");
    return applyVersionAction(context, data);
  });

export const getForecastVersionDetail = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    forecastVersionCompareSchema.pick({ toVersionId: true }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ lines: ForecastSnapshotLine[] }> => {
    requireSupabaseAuth(context);
    await loadForecastVersion(context, data.toVersionId);
    return { lines: await loadVersionLines(context, data.toVersionId) };
  });

export const compareForecastVersions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => forecastVersionCompareSchema.parse(input))
  .handler(async ({ data, context }): Promise<ForecastDiff> => {
    requireSupabaseAuth(context);
    await loadCostingSettings(
      context,
      (await loadCostingProject(context, data.projectId)).company_id,
    );
    return compareVersions(context, data.fromVersionId ?? null, data.toVersionId);
  });
