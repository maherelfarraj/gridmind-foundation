// P-199 — TanStack Query options for finance alerts.
import { queryOptions } from "@tanstack/react-query";

import { getFinanceAlertAccess, getFinanceAlerts } from "@/lib/finance-alerts.functions";
import type { ListAlertsInput } from "@/lib/finance-alerts.rules";

export function financeAlertsQueryOptions(filters: ListAlertsInput) {
  return queryOptions({
    queryKey: ["finance-alerts", "list", filters],
    queryFn: () => getFinanceAlerts({ data: filters }),
    staleTime: 10_000,
  });
}

export function financeAlertAccessQueryOptions() {
  return queryOptions({
    queryKey: ["finance-alerts", "access"],
    queryFn: () => getFinanceAlertAccess(),
    staleTime: 60_000,
  });
}
