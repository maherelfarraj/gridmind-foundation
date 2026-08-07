// GC-11 — Query options for portfolio scenarios.
import { queryOptions } from "@tanstack/react-query";

import { getPortfolioScenario, getPortfolioScenarios } from "@/lib/portfolio-scenarios.functions";
import { scenarioListSchema, type ScenarioListFilter } from "@/lib/portfolio-scenarios.rules";

export function portfolioScenariosQueryOptions(filter: Partial<ScenarioListFilter> = {}) {
  const normalized = scenarioListSchema.parse(filter);
  return queryOptions({
    queryKey: ["portfolio", "scenarios", normalized],
    queryFn: () => getPortfolioScenarios({ data: normalized }),
    staleTime: 15_000,
  });
}

export function portfolioScenarioQueryOptions(id: string, compareTo: string | null = null) {
  return queryOptions({
    queryKey: ["portfolio", "scenario", id, compareTo],
    queryFn: () => getPortfolioScenario({ data: { id, compare_to: compareTo } }),
    staleTime: 10_000,
  });
}
