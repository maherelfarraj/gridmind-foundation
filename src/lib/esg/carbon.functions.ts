// P-217 — Carbon report server functions. Thin wrappers only.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { assertRoles, audit, currentCompanyId } from "@/lib/cwp.server";
import { ESG_WRITER_ROLES } from "@/lib/esg/activity.server";
import {
  buildReportTotals,
  computeAvoided,
  computeEmissions,
  DEFAULT_GRID_FACTOR_KG_PER_KWH,
  ESG_METHODOLOGY_NOTE,
  resolveFactor,
} from "@/lib/esg/carbon";
import {
  assertRecomputable,
  findReport,
  loadCarbonFactors,
  loadPeriodActivities,
  sumMeteredEnergyKwh,
  upsertDraftReport,
} from "@/lib/esg/carbon.server";

const periodSchema = z.object({
  project_id: z.string().uuid(),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const computeEsgReport = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => periodSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    await assertRoles(context.supabase, ESG_WRITER_ROLES);
    const companyId = await currentCompanyId(context.supabase, context.user.id);

    const existing = await findReport(
      context.supabase,
      companyId,
      data.project_id,
      data.period_from,
      data.period_to,
    );
    assertRecomputable(existing);

    const [factors, activities, meteredKwh] = await Promise.all([
      loadCarbonFactors(context.supabase, companyId),
      loadPeriodActivities(
        context.supabase,
        data.project_id,
        data.period_from,
        data.period_to,
      ),
      sumMeteredEnergyKwh(
        context.supabase,
        data.project_id,
        data.period_from,
        data.period_to,
      ),
    ]);

    const emissions = computeEmissions(activities, factors);
    const gridFactor = resolveFactor("electricity_grid", data.period_from, factors);
    const avoided =
      meteredKwh === null
        ? null
        : computeAvoided(
            meteredKwh,
            gridFactor?.kg_co2e_per_unit ?? DEFAULT_GRID_FACTOR_KG_PER_KWH,
          ).avoided_kg;

    const totals = buildReportTotals({
      totals: emissions.totals,
      avoidedKg: avoided,
      unfactoredCount: emissions.unfactored.length,
    });

    const report = await upsertDraftReport(context.supabase, {
      existingId: existing?.id ?? null,
      companyId,
      projectId: data.project_id,
      periodFrom: data.period_from,
      periodTo: data.period_to,
      totals,
      rowCount: emissions.rows.length,
      methodologyNote: ESG_METHODOLOGY_NOTE,
      userId: context.user.id,
    });

    await audit(context.supabase, "esg.report_generated", "esg_reports", report.id, {
      report_id: report.id,
      totals,
      row_count: emissions.rows.length,
    });

    return {
      report,
      rows: emissions.rows,
      unfactored: emissions.unfactored,
      totals,
      metered_kwh: meteredKwh,
      grid_factor: gridFactor
        ? {
            kg_co2e_per_unit: gridFactor.kg_co2e_per_unit,
            factor_code: gridFactor.factor_code,
            factor_source: gridFactor.factor_source,
          }
        : { kg_co2e_per_unit: DEFAULT_GRID_FACTOR_KG_PER_KWH, factor_code: "JO-GRID-DEFAULT", factor_source: "Jordan default" },
      methodology_note: ESG_METHODOLOGY_NOTE,
    };
  });

export const getEsgReport = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => periodSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    return findReport(
      context.supabase,
      companyId,
      data.project_id,
      data.period_from,
      data.period_to,
    );
  });
