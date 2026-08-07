// GC-16 — Query options for the contract & claims cockpits.
import { queryOptions } from "@tanstack/react-query";

import {
  getClaimsAccess,
  getClaimsAppendix,
  getClaimsWorkspace,
  getPortfolioClaims,
} from "@/lib/contracts-claims.functions";
import type { PortfolioClaimsQuery } from "@/lib/contracts-claims.rules";

export function claimsWorkspaceQueryOptions(projectId: string, periodMonth?: string) {
  return queryOptions({
    queryKey: ["contracts-claims", "workspace", projectId, periodMonth ?? "latest"],
    queryFn: () =>
      getClaimsWorkspace({
        data: { project_id: projectId, ...(periodMonth ? { period_month: periodMonth } : {}) },
      }),
    staleTime: 10_000,
  });
}

export function claimsAppendixQueryOptions(projectId: string, periodMonth?: string) {
  return queryOptions({
    queryKey: ["contracts-claims", "appendix", projectId, periodMonth ?? "latest"],
    queryFn: () =>
      getClaimsAppendix({
        data: { project_id: projectId, ...(periodMonth ? { period_month: periodMonth } : {}) },
      }),
    staleTime: 30_000,
  });
}

export function claimsAccessQueryOptions() {
  return queryOptions({
    queryKey: ["contracts-claims", "access"],
    queryFn: () => getClaimsAccess(),
    staleTime: 60_000,
  });
}

export function portfolioClaimsQueryOptions(query: Partial<PortfolioClaimsQuery> = {}) {
  return queryOptions({
    queryKey: [
      "contracts-claims",
      "portfolio",
      query.period_month ?? "latest",
      query.status ?? "all",
      query.search ?? "",
    ],
    queryFn: () => getPortfolioClaims({ data: { status: "all", ...query } }),
    staleTime: 15_000,
  });
}
