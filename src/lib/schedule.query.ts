// P-073 — TanStack Query wrappers for schedule + baselines.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  getScheduleAccess,
  listBaselines,
  listScheduleTasks,
} from "@/lib/schedule.functions";

export function scheduleAccessQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof getScheduleAccess>>,
) {
  return queryOptions({
    queryKey: ["schedule", "access"],
    queryFn: () => fn({}),
  });
}

export function scheduleTasksQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listScheduleTasks>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["schedule", "tasks", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function baselinesQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listBaselines>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["schedule", "baselines", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function scheduleErrorMessage(err: unknown): string {
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
