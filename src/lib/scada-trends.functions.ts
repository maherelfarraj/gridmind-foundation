// P-174 — Time-series explorer server functions (thin wrappers only).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  buildTrendCsvExport,
  listTrendTags,
  loadTrendSeries,
  type TrendPayload,
  type TrendTagOption,
} from "@/lib/scada-trends.server";
import { trendQuerySchema } from "@/lib/scada/trends";

export const listScadaTrendTags = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({ search: z.string().trim().max(120).optional() }).parse(raw ?? {}),
  )
  .handler(async ({ context, data }): Promise<TrendTagOption[]> => {
    requireSupabaseAuth(context);
    return listTrendTags(context, data.search);
  });

export const getScadaTrendSeries = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) => trendQuerySchema.parse(raw))
  .handler(async ({ context, data }): Promise<TrendPayload> => {
    requireSupabaseAuth(context);
    return loadTrendSeries(context, data);
  });

export const exportScadaTrendCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((raw: unknown) =>
    trendQuerySchema
      .and(z.object({ projectId: z.string().uuid().nullable().optional() }))
      .parse(raw),
  )
  .handler(async ({ context, data }) => {
    requireSupabaseAuth(context);
    return buildTrendCsvExport(context, data);
  });
