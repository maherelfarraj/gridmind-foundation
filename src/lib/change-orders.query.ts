// P-079 — TanStack Query options for change orders.
import { queryOptions } from "@tanstack/react-query";
import { listChangeOrders } from "@/lib/change-orders.functions";

export function changeOrdersListQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: ["change-orders", "list", projectId],
    queryFn: () => listChangeOrders({ data: { project_id: projectId } }),
    staleTime: 30_000,
  });
}
