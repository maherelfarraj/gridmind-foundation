// P-261 — AP aging: the receivable aging engine, pointed at payables so
// subcontractor invoices land in the finance cockpit's AP view.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { attachSupabaseAuth, requireSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import {
  bucketBars,
  expectedCash,
  groupByProject,
  groupByClient,
  overdueOf,
  sumBuckets,
  totalOf,
} from "@/lib/ar-aging.rules";
import { loadAgingDataset } from "@/lib/ar-aging.server";
import type { ArAgingResult } from "@/lib/ar-aging.functions";

export const getApAging = createServerFn({ method: "GET" })
  .middleware([attachSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ project_id: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<Omit<ArAgingResult, "forecast">> => {
    requireSupabaseAuth(context);
    const ds = await loadAgingDataset(context, {
      project_id: data.project_id,
      direction: "payable",
    });
    const by_client = groupByClient(ds.rows);
    const by_project = groupByProject(ds.rows);
    const totals = sumBuckets(by_client);
    return {
      base_currency: ds.base_currency,
      today: ds.today,
      by_client,
      by_project,
      invoices: ds.rows,
      totals,
      total_ar: totalOf(totals),
      overdue_ar: overdueOf(totals),
      expected_cash: expectedCash(totals),
      bars: bucketBars(totals),
      fx_missing_currencies: ds.fx_missing_currencies,
    };
  });
