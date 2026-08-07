// GC-08 — Portfolio Cost & Close server functions.
// Thin wrapper module: imports + createServerFn declarations only.
import { createServerFn } from "@tanstack/react-start";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { loadPortfolioCosting, type PortfolioCostingData } from "@/lib/portfolio-costing.server";
import { buildConsolidationCsv, portfolioCostingQuerySchema } from "@/lib/portfolio-costing.rules";

export type { PortfolioCostingData };

export const getPortfolioCosting = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioCostingQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<PortfolioCostingData> => {
    requireSupabaseAuth(context);
    return loadPortfolioCosting(context, data);
  });

export const getPortfolioCostingCsv = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) => portfolioCostingQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<{ filename: string; csv: string }> => {
    requireSupabaseAuth(context);
    const payload = await loadPortfolioCosting(context, data);
    return {
      filename: `portfolio-cost-${payload.period.slice(0, 7)}-${payload.reporting_currency}.csv`,
      csv: buildConsolidationCsv(payload.rows, payload.consolidation, payload.period),
    };
  });
