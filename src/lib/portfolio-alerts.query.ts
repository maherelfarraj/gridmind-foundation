// GC-10 — Query options for portfolio finance alerts.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioAlertAppendix, getPortfolioAlerts } from "@/lib/portfolio-alerts.functions";
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

export function portfolioAlertAppendixQueryOptions(period: string) {
  return queryOptions({
    queryKey: ["portfolio", "alerts", "appendix", period],
    queryFn: () => getPortfolioAlertAppendix({ data: { period } }),
    staleTime: 30_000,
  });
}
