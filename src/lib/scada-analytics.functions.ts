// P-175 — Performance analytics server functions (thin wrapper module only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  computeAnalytics,
  listAnalyticsProjects,
  upsertDailyKpis,
  type AnalyticsResult,
} from "@/lib/scada-analytics.server";

const dayString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "day must be YYYY-MM-DD");

export const listAnalyticsProjectOptions = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .handler(async ({ context }) => {
    requireSupabaseAuth(context);
    return listAnalyticsProjects(context);
  });

export const getProjectAnalytics = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z
      .object({
        projectId: z.string().uuid(),
        day: dayString,
        excludeGrid: z.boolean().default(false),
      })
      .parse(raw),
  )
  .handler(async ({ context, data }): Promise<AnalyticsResult> => {
    requireSupabaseAuth(context);
    return computeAnalytics(context, data.projectId, data.day, data.excludeGrid);
  });

export const computeDailyKpis = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ projectId: z.string().uuid(), day: dayString }).parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return upsertDailyKpis(context, data.projectId, data.day);
  });
