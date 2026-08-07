// GC-09 — Query options for the portfolio audit trail and saved views.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioAudit } from "@/lib/portfolio-audit.functions";
import type { AuditFilter } from "@/lib/portfolio-audit.rules";
import { getSavedViews } from "@/lib/portfolio-views.functions";

export function portfolioAuditQueryOptions(filter: AuditFilter) {
  return queryOptions({
    queryKey: ["portfolio", "audit", filter],
    queryFn: () => getPortfolioAudit({ data: filter }),
    staleTime: 10_000,
  });
}

export function savedViewsQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "saved-views"],
    queryFn: () => getSavedViews(),
    staleTime: 30_000,
  });
}
