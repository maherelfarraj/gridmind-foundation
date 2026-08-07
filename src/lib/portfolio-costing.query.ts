// GC-08 — Query options for the Portfolio Cost & Close dashboard.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioCosting } from "@/lib/portfolio-costing.functions";
import type { PortfolioCostingQuery } from "@/lib/portfolio-costing.rules";

export function portfolioCostingQueryOptions(input: PortfolioCostingQuery) {
  return queryOptions({
    queryKey: [
      "portfolio",
      "costing",
      input.period ?? "current",
      input.currency ?? "auto",
      input.basis ?? "period_end",
    ],
    queryFn: () => getPortfolioCosting({ data: input }),
    staleTime: 15_000,
  });
}
