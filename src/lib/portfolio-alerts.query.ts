// GC-10 — Query options for portfolio finance alerts.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioAlerts } from "@/lib/portfolio-alerts.functions";
import { alertFilterSchema, type AlertFilter } from "@/lib/portfolio-alerts.rules";

export function portfolioAlertsQueryOptions(filter: Partial<AlertFilter>) {
  // Normalise before hashing so partial filters and their defaulted twins
  // share one cache entry instead of firing duplicate requests.
  const normalized = alertFilterSchema.parse(filter);
  return queryOptions({
    queryKey: ["portfolio", "alerts", normalized],
    queryFn: () => getPortfolioAlerts({ data: normalized }),
    staleTime: 10_000,
  });
}
