// P-068 — TanStack Query wrappers for expediting.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getExpeditingAccess,
  getLongLeadKpi,
  listExpediting,
  listOpenPosForExpediting,
} from "@/lib/expediting.functions";
import type { ExpeditingStatus } from "@/lib/expediting-rules";

export function expeditingListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listExpediting>>,
  filters: { projectId?: string | null; status?: ExpeditingStatus | null },
) {
  return queryOptions({
    queryKey: ["expediting", "list", filters],
    queryFn: () =>
      fn({
        data: {
          projectId: filters.projectId ?? null,
          status: filters.status ?? null,
        },
      }),
  });
}

export function longLeadKpiQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getLongLeadKpi>>,
  projectId?: string | null,
) {
  return queryOptions({
    queryKey: ["expediting", "kpi", projectId ?? null],
    queryFn: () => fn({ data: { projectId: projectId ?? null } }),
  });
}

export function expeditingAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getExpeditingAccess>>,
) {
  return queryOptions({
    queryKey: ["expediting", "access"],
    queryFn: () => fn({}),
  });
}

export function openPosForExpeditingQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listOpenPosForExpediting>>,
) {
  return queryOptions({
    queryKey: ["expediting", "open-pos"],
    queryFn: () => fn({}),
  });
}

export function errorMessage(err: unknown): string {
  const anyErr = err as any;
  const body = anyErr?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.message) return String(parsed.message);
      if (parsed?.error) return String(parsed.error);
    } catch {
      /* ignore */
    }
  }
  if (anyErr?.message) return String(anyErr.message);
  return "Something went wrong";
}
