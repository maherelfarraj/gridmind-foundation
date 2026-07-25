// P-074 — TanStack Query wrappers for the risk register.
import { queryOptions } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getRisksAccess, listProjectMembers, listRisks } from "@/lib/risks.functions";

export function risksAccessQueryOptions(fn: ReturnType<typeof useServerFn<typeof getRisksAccess>>) {
  return queryOptions({
    queryKey: ["risks", "access"],
    queryFn: () => fn({}),
  });
}

export function risksListQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listRisks>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["risks", "list", projectId],
    queryFn: () => fn({ data: { projectId } }),
  });
}

export function projectMembersQueryOptions(
  fn: ReturnType<typeof useServerFn<typeof listProjectMembers>>,
  projectId: string,
) {
  return queryOptions({
    queryKey: ["risks", "members", projectId],
    queryFn: () => fn({ data: { projectId } }),
    staleTime: 60_000,
  });
}

export function riskErrorMessage(err: unknown): string {
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
