// P-218 — ESG dashboard read. Thin wrapper module: helpers live in *.server.ts.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { currentCompanyId } from "@/lib/cwp.server";
import { ESG_METHODOLOGY_NOTE } from "@/lib/esg/carbon";
import { loadCarbonFactors } from "@/lib/esg/carbon.server";
import {
  buildDashboard,
  diversionRate,
  kwhToMwh,
  monthKeysBetween,
  renewableShare,
} from "@/lib/esg/dashboard.rules";
import {
  listCompanyProjects,
  loadDashboardActivities,
  loadTrir,
  loadWasteSummary,
  monthlyAvoidedKg,
  monthlyMeteredKwh,
} from "@/lib/esg/dashboard.server";

const dashboardSchema = z.object({
  project_id: z.string().uuid().nullable().optional(),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const getEsgDashboard = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => dashboardSchema.parse(raw))
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    const companyId = await currentCompanyId(context.supabase, context.user.id);
    const projectId = data.project_id ?? null;

    const [projects, factors, activities, waste, hse] = await Promise.all([
      listCompanyProjects(context.supabase, companyId),
      loadCarbonFactors(context.supabase, companyId),
      loadDashboardActivities(
        context.supabase,
        companyId,
        projectId,
        data.period_from,
        data.period_to,
      ),
      loadWasteSummary(
        context.supabase,
        companyId,
        projectId,
        data.period_from,
        data.period_to,
      ),
      loadTrir(context.supabase, companyId, projectId, data.period_from, data.period_to),
    ]);

    const allIds = projects.map((p) => p.id);
    const [scopedKwh, portfolioKwh] = await Promise.all([
      monthlyMeteredKwh(
        context.supabase,
        projectId ? [projectId] : allIds,
        data.period_from,
        data.period_to,
      ),
      projectId
        ? monthlyMeteredKwh(context.supabase, allIds, data.period_from, data.period_to)
        : Promise.resolve(null),
    ]);

    const months = monthKeysBetween(data.period_from, data.period_to);
    const avoidedByMonth = monthlyAvoidedKg(scopedKwh, factors);
    const meteredKwh = scopedKwh
      ? Object.values(scopedKwh).reduce((s, v) => s + v, 0)
      : null;
    const portfolioTotalKwh = portfolioKwh
      ? Object.values(portfolioKwh).reduce((s, v) => s + v, 0)
      : projectId
        ? null
        : meteredKwh;

    const core = buildDashboard({
      activities: activities.rows,
      factors,
      months,
      monthlyAvoidedKg: avoidedByMonth,
      meteredKwh,
    });

    const renewableMwh = kwhToMwh(meteredKwh);
    const portfolioMwh = kwhToMwh(portfolioTotalKwh);
    const share = renewableShare(
      renewableMwh,
      portfolioMwh,
      projectId ? projects.length : 1,
    );
    const diversion = waste.available
      ? diversionRate(waste.recyclable_kg, waste.total_kg)
      : { pct: null, reason: "table_missing" as const };

    return {
      period: { from: data.period_from, to: data.period_to },
      project_id: projectId,
      projects,
      activities_available: activities.available,
      telemetry_available: scopedKwh !== null,
      metered_kwh: meteredKwh,
      renewable_mwh: renewableMwh,
      portfolio_mwh: portfolioMwh,
      renewable_share_pct: share.pct,
      renewable_share_reason: share.reason ?? null,
      waste: {
        available: waste.available,
        recyclable_kg: waste.recyclable_kg,
        total_kg: waste.total_kg,
        diversion_pct: diversion.pct,
        diversion_reason: diversion.reason ?? null,
      },
      hse: {
        available: hse.available,
        trir: hse.trir,
        recordables: hse.recordables,
        hours: hse.hours,
      },
      methodology_note: ESG_METHODOLOGY_NOTE,
      ...core,
    };
  });

export type EsgDashboardData = Awaited<ReturnType<typeof getEsgDashboard>>;
