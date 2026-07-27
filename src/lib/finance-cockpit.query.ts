// P-196 — TanStack Query options for the finance cockpit.
import { queryOptions } from "@tanstack/react-query";

import { getFinanceAccess, getFinanceCockpit } from "@/lib/finance-cockpit.functions";
import type { GetFinanceCockpitInput } from "@/lib/finance-cockpit.rules";

export function financeCockpitQueryOptions(filters: GetFinanceCockpitInput = {}) {
  return queryOptions({
    queryKey: ["finance-cockpit", filters],
    queryFn: () => getFinanceCockpit({ data: filters }),
    staleTime: 30_000,
  });
}

export function financeAccessQueryOptions() {
  return queryOptions({
    queryKey: ["finance-cockpit", "access"],
    queryFn: () => getFinanceAccess(),
    staleTime: 60_000,
  });
}
