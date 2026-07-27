// Query options for the /admin/ops-alerts dashboard.
import { queryOptions } from "@tanstack/react-query";

import { getOpsAlerts } from "@/lib/ops-alerts.functions";

export type OpsAlertFilters = {
  status: "open" | "acknowledged" | "dismissed" | "all";
  rule_type: string;
  severity: "info" | "warning" | "critical" | "all";
};

export function opsAlertsQueryOptions(filters: OpsAlertFilters) {
  return queryOptions({
    queryKey: ["ops-alerts", "list", filters],
    queryFn: () => getOpsAlerts({ data: filters }),
    staleTime: 10_000,
  });
}
