// GC-09 — Query options for the portfolio audit trail and saved views.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioAudit } from "@/lib/portfolio-audit.functions";
import { auditFilterSchema, type AuditFilter } from "@/lib/portfolio-audit.rules";
import { getSavedViews } from "@/lib/portfolio-views.functions";

export function portfolioAuditQueryOptions(filter: AuditFilter) {
  // Normalise before hashing so `{page:1}` and `{page:1,page_size:50}` share a
  // cache entry instead of firing two identical requests.
  const normalized = auditFilterSchema.parse(filter);
  return queryOptions({
    queryKey: ["portfolio", "audit", normalized],
    queryFn: () => getPortfolioAudit({ data: normalized }),
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
