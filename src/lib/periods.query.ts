// P-200 — TanStack Query options for finance period close.
import { queryOptions } from "@tanstack/react-query";

import { getFinancePeriods, getPeriodComparison } from "@/lib/periods.functions";

export function financePeriodsQueryOptions() {
  return queryOptions({
    queryKey: ["finance-periods", "list"],
    queryFn: () => getFinancePeriods(),
    staleTime: 10_000,
  });
}

export function periodComparisonQueryOptions(periodMonth: string | null) {
  return queryOptions({
    queryKey: ["finance-periods", "comparison", periodMonth],
    queryFn: () => getPeriodComparison({ data: { period_month: periodMonth as string } }),
    enabled: Boolean(periodMonth),
    staleTime: 30_000,
  });
}
