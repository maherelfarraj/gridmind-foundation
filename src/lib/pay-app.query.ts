// P-079 — TanStack Query options for pay applications.
import { queryOptions } from "@tanstack/react-query";

import {
  getPayAppAccess,
  getPayApplication,
  listContractsForPayApp,
  listPayApplications,
} from "@/lib/pay-app.functions";

export function payAppListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pay-applications", "list", projectId],
    queryFn: () => listPayApplications({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function payAppDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["pay-applications", "detail", id],
    queryFn: () => getPayApplication({ data: { id } }),
    staleTime: 5_000,
  });
}

export function payAppAccessQueryOptions() {
  return queryOptions({
    queryKey: ["pay-applications", "access"],
    queryFn: () => getPayAppAccess(),
    staleTime: 60_000,
  });
}

export function payAppContractsPickerQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["pay-applications", "contracts-picker", projectId],
    queryFn: () => listContractsForPayApp({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}

export function payAppErrorMessage(err: unknown): string {
  const e = err as { message?: string; body?: string };
  if (e?.body) {
    try {
      const p = JSON.parse(e.body);
      if (p?.message) return p.message;
      if (p?.error) return p.error;
    } catch {
      /* noop */
    }
  }
  return e?.message ?? "Something went wrong";
}

export function payAppErrorExtra(err: unknown): unknown {
  const e = err as { body?: string };
  if (!e?.body) return null;
  try {
    const p = JSON.parse(e.body);
    return p?.extra ?? null;
  } catch {
    return null;
  }
}
