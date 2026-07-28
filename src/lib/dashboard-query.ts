// POL-2 — Query options for the dashboard.
import { queryOptions } from "@tanstack/react-query";

import { getDashboard } from "@/lib/dashboard.functions";

export function dashboardQueryOptions() {
  return queryOptions({
    queryKey: ["dashboard", "overview"],
    queryFn: () => getDashboard(),
    staleTime: 30_000,
  });
}
