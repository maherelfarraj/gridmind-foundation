// P-198 — TanStack Query options for bank reconciliation.
import { queryOptions } from "@tanstack/react-query";

import {
  getReconciliationAccess,
  getReconciliationMonth,
  listReconciliationMonths,
} from "@/lib/reconciliation.functions";
import type { ListReconciliationInput } from "@/lib/reconciliation.rules";

export function reconciliationQueryOptions(filters: ListReconciliationInput) {
  return queryOptions({
    queryKey: ["reconciliation", "month", filters],
    queryFn: () => getReconciliationMonth({ data: filters }),
    staleTime: 10_000,
  });
}

export function reconciliationAccessQueryOptions() {
  return queryOptions({
    queryKey: ["reconciliation", "access"],
    queryFn: () => getReconciliationAccess(),
    staleTime: 60_000,
  });
}

export function reconciliationMonthsQueryOptions() {
  return queryOptions({
    queryKey: ["reconciliation", "months"],
    queryFn: () => listReconciliationMonths({ data: {} }),
    staleTime: 60_000,
  });
}
