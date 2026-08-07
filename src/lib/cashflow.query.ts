// GC-13 — Query options for the cash-flow cockpit and portfolio liquidity view.
import { queryOptions } from "@tanstack/react-query";

import type { BucketGranularity, PortfolioCashFilter } from "@/lib/cashflow.rules";
import {
  getCashflowAdjustments,
  getCashflowAppendix,
  getCashflowSettings,
  getCashflowWorkspace,
  getFundingFacilities,
  getFundingWorkspace,
  getPortfolioCashflow,
  getPortfolioCashflowAppendix,
} from "@/lib/cashflow.functions";

export function cashflowWorkspaceQueryOptions(
  projectId: string,
  period?: string,
  granularity?: BucketGranularity,
) {
  return queryOptions({
    queryKey: ["cashflow", "workspace", projectId, period ?? "current", granularity ?? "default"],
    queryFn: () =>
      getCashflowWorkspace({
        data: {
          project_id: projectId,
          ...(period ? { period } : {}),
          ...(granularity ? { granularity } : {}),
        },
      }),
    staleTime: 10_000,
  });
}

export function cashflowSettingsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["cashflow", "settings", projectId],
    queryFn: () => getCashflowSettings({ data: { project_id: projectId } }),
    staleTime: 60_000,
  });
}

export function cashflowAdjustmentsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["cashflow", "adjustments", projectId],
    queryFn: () => getCashflowAdjustments({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function fundingFacilitiesQueryOptions() {
  return queryOptions({
    queryKey: ["cashflow", "facilities"],
    queryFn: () => getFundingFacilities(),
    staleTime: 60_000,
  });
}

export function cashflowAppendixQueryOptions(projectId: string, period?: string) {
  return queryOptions({
    queryKey: ["cashflow", "appendix", projectId, period ?? "current"],
    queryFn: () =>
      getCashflowAppendix({
        data: { project_id: projectId, ...(period ? { period } : {}) },
      }),
    staleTime: 30_000,
  });
}

export function portfolioCashflowQueryOptions(filter: PortfolioCashFilter = {}) {
  return queryOptions({
    queryKey: ["cashflow", "portfolio", filter],
    queryFn: () => getPortfolioCashflow({ data: filter }),
    staleTime: 30_000,
  });
}

export function portfolioCashflowAppendixQueryOptions(filter: PortfolioCashFilter = {}) {
  return queryOptions({
    queryKey: ["cashflow", "portfolio-appendix", filter],
    queryFn: () => getPortfolioCashflowAppendix({ data: filter }),
    staleTime: 30_000,
  });
}

export function fundingWorkspaceQueryOptions() {
  return queryOptions({
    queryKey: ["cashflow", "funding-workspace"],
    queryFn: () => getFundingWorkspace(),
    staleTime: 15_000,
  });
}
