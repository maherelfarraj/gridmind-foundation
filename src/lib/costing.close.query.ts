// GC-03 — Query options for the costing close + forecast versions views.
import { queryOptions } from "@tanstack/react-query";

import {
  compareForecastVersions,
  getCostingClose,
  getForecastVersionDetail,
} from "@/lib/costing.close.functions";

export function costingCloseQueryOptions(projectId: string, period?: string) {
  return queryOptions({
    queryKey: ["costing", "close", projectId, period ?? "current"],
    queryFn: () => getCostingClose({ data: { projectId, ...(period ? { period } : {}) } }),
    staleTime: 10_000,
  });
}

export function forecastVersionDetailQueryOptions(versionId: string) {
  return queryOptions({
    queryKey: ["costing", "version", versionId],
    queryFn: () => getForecastVersionDetail({ data: { toVersionId: versionId } }),
    staleTime: Infinity,
  });
}

export function forecastCompareQueryOptions(
  projectId: string,
  fromVersionId: string | null,
  toVersionId: string | null,
) {
  return queryOptions({
    queryKey: ["costing", "compare", projectId, fromVersionId ?? "none", toVersionId ?? "none"],
    queryFn: () =>
      compareForecastVersions({
        data: { projectId, fromVersionId, toVersionId: toVersionId as string },
      }),
    enabled: Boolean(toVersionId),
    staleTime: Infinity,
  });
}
