// GC-15 — Query options for the revenue / WIP recognition cockpits.
import { queryOptions } from "@tanstack/react-query";

import {
  getPortfolioRecognition,
  getRecognitionAccess,
  getRecognitionAppendix,
  getRecognitionWorkspace,
} from "@/lib/recognition.functions";
import type { PortfolioRecognitionQuery } from "@/lib/recognition.rules";

export function recognitionWorkspaceQueryOptions(projectId: string, periodMonth?: string) {
  return queryOptions({
    queryKey: ["recognition", "workspace", projectId, periodMonth ?? "latest"],
    queryFn: () =>
      getRecognitionWorkspace({
        data: { project_id: projectId, ...(periodMonth ? { period_month: periodMonth } : {}) },
      }),
    staleTime: 10_000,
  });
}

export function recognitionAppendixQueryOptions(projectId: string, periodMonth?: string) {
  return queryOptions({
    queryKey: ["recognition", "appendix", projectId, periodMonth ?? "latest"],
    queryFn: () =>
      getRecognitionAppendix({
        data: { project_id: projectId, ...(periodMonth ? { period_month: periodMonth } : {}) },
      }),
    staleTime: 30_000,
  });
}

export function recognitionAccessQueryOptions() {
  return queryOptions({
    queryKey: ["recognition", "access"],
    queryFn: () => getRecognitionAccess(),
    staleTime: 60_000,
  });
}

export function portfolioRecognitionQueryOptions(query: Partial<PortfolioRecognitionQuery> = {}) {
  return queryOptions({
    queryKey: ["recognition", "portfolio", query.period_month ?? "latest", query.status ?? "all"],
    queryFn: () => getPortfolioRecognition({ data: { status: "all", ...query } }),
    staleTime: 15_000,
  });
}
