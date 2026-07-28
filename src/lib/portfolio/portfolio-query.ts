// P-252 — Query options for the portfolio dashboard.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioKpis, getPortfolioProjectCards } from "@/lib/portfolio.functions";

export function portfolioKpisQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "kpis"],
    queryFn: () => getPortfolioKpis(),
    staleTime: 30_000,
  });
}

export function portfolioProjectCardsQueryOptions() {
  return queryOptions({
    queryKey: ["portfolio", "project-cards"],
    queryFn: () => getPortfolioProjectCards(),
    staleTime: 30_000,
  });
}
