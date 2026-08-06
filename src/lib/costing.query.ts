// GC-01 — TanStack Query options for the Costing workspace.
import { queryOptions } from "@tanstack/react-query";

import { getCostingAccess, getCostingWorkspace } from "@/lib/costing.functions";

export function costingWorkspaceQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["costing", "workspace", projectId],
    queryFn: () => getCostingWorkspace({ data: { projectId } }),
    staleTime: 15_000,
  });
}

export function costingAccessQueryOptions() {
  return queryOptions({
    queryKey: ["costing", "access"],
    queryFn: () => getCostingAccess(),
    staleTime: 60_000,
  });
}

export function costingErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return String(p.message);
      if (p?.error) return String(p.error);
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}
