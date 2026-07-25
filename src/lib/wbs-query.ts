// P-072 — TanStack Query wrappers for WBS + task alignment.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getWbsAccess,
  listCurrenciesForWbs,
  listWbsTree,
  proposeIfcPackages,
} from "@/lib/wbs.functions";
import {
  getScheduleTaskAssignAccess,
  listScheduleTasksForAlign,
} from "@/lib/schedule-tasks.functions";

export function wbsTreeQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listWbsTree>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["wbs", "tree", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function wbsAccessQueryOptions(fn: ReturnType<typeof useServerFn<typeof getWbsAccess>>) {
  return queryOptions({
    queryKey: ["wbs", "access"],
    queryFn: () => fn({}),
  });
}

export function wbsCurrenciesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listCurrenciesForWbs>>,
) {
  return queryOptions({
    queryKey: ["wbs", "currencies"],
    queryFn: () => fn({}),
    staleTime: 5 * 60_000,
  });
}

export function wbsIfcProposalsQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof proposeIfcPackages>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["wbs", "ifc-proposals", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function scheduleTasksAlignQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listScheduleTasksForAlign>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["schedule-tasks", "align", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function scheduleTaskAssignAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getScheduleTaskAssignAccess>>,
) {
  return queryOptions({
    queryKey: ["schedule-tasks", "assign-access"],
    queryFn: () => fn({}),
  });
}

export function wbsErrorMessage(err: unknown): string {
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
