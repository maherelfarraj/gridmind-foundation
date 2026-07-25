// P-081 — TanStack Query options for change orders.
import { queryOptions } from "@tanstack/react-query";

import {
  getChangeOrderAccess,
  getChangeOrderDetail,
  listChangeOrders,
  listCoPickers,
} from "@/lib/change-orders.functions";

export function changeOrdersListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["change-orders", "list", projectId],
    queryFn: () => listChangeOrders({ data: { project_id: projectId } }),
    staleTime: 15_000,
  });
}

export function changeOrderDetailQueryOptions(id: string) {
  return queryOptions({
    queryKey: ["change-orders", "detail", id],
    queryFn: () => getChangeOrderDetail({ data: { id } }),
    staleTime: 5_000,
  });
}

export function changeOrderAccessQueryOptions() {
  return queryOptions({
    queryKey: ["change-orders", "access"],
    queryFn: () => getChangeOrderAccess(),
    staleTime: 60_000,
  });
}

export function coPickersQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["change-orders", "pickers", projectId],
    queryFn: () => listCoPickers({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}

export function changeOrderErrorMessage(err: unknown): string {
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
